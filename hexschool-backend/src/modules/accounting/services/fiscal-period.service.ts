import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FiscalPeriod, FiscalPeriodStatus } from '@prisma/client';
import { UserType } from '../../../common/constants';
import { isoDate, parseDate } from '../../academic/calendar/date.util';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { PermissionsService } from '../../rbac/services/permissions.service';
import {
  ClosePeriodDto,
  CreateFiscalPeriodDto,
  ReopenPeriodDto,
  UpdateFiscalPeriodDto,
} from '../dto';
import { AccountingConfigRepository } from '../repositories/accounting-config.repository';
import { VouchersRepository } from '../repositories/vouchers.repository';
import { AccountingSettingsService } from './accounting-settings.service';

/** What `resolvePeriodFor` decided about a voucher's date. */
export interface PeriodVerdict {
  period: FiscalPeriod | null;
  /** Set when the date's own period was CLOSED and the voucher moved. */
  redirectedFrom?: FiscalPeriod;
  note?: string;
}

/**
 * Fiscal periods and the close (roadmap M20 §4/§6).
 *
 * The close is the module's one irreversible-feeling act: everything
 * dated inside a CLOSED period stops accepting new postings, which is
 * what makes last year's trial balance a fixed number rather than a
 * moving one. Reopening is deliberately a separate permission
 * (`accounting.period.reopen`, named in roadmap §6) and demands a reason.
 */
@Injectable()
export class FiscalPeriodService {
  constructor(
    private readonly config: AccountingConfigRepository,
    private readonly vouchers: VouchersRepository,
    private readonly settings: AccountingSettingsService,
    private readonly permissions: PermissionsService,
    private readonly auditContext: AuditContextService,
  ) {}

  async list(schoolId: string): Promise<FiscalPeriod[]> {
    return this.config.findPeriods(schoolId);
  }

  async getById(id: string, schoolId: string): Promise<FiscalPeriod> {
    const period = await this.config.findPeriodById(id, schoolId);
    if (!period) throw new NotFoundException(`Fiscal period ${id} not found`);
    return period;
  }

  async create(
    dto: CreateFiscalPeriodDto,
    actor: AccessTokenPayload,
  ): Promise<FiscalPeriod> {
    const start = parseDate(dto.startDate);
    const end = parseDate(dto.endDate);
    if (end < start) {
      throw new BadRequestException('The end date is before the start date');
    }
    await this.assertNoOverlap(actor.schoolId, start, end);

    const created = await this.config.createPeriod({
      schoolId: actor.schoolId,
      name: dto.name.trim(),
      startDate: start,
      endDate: end,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'FiscalPeriod',
      entityId: created.id,
      newValues: { name: created.name, from: dto.startDate, to: dto.endDate },
    });
    return created;
  }

  async update(
    id: string,
    dto: UpdateFiscalPeriodDto,
    actor: AccessTokenPayload,
  ): Promise<FiscalPeriod> {
    const period = await this.getById(id, actor.schoolId);
    if (period.status === FiscalPeriodStatus.CLOSED) {
      throw new ConflictException(
        `${period.name} is closed — reopen it before changing its dates`,
      );
    }

    const start = dto.startDate ? parseDate(dto.startDate) : period.startDate;
    const end = dto.endDate ? parseDate(dto.endDate) : period.endDate;
    if (end < start) {
      throw new BadRequestException('The end date is before the start date');
    }
    if (dto.startDate || dto.endDate) {
      await this.assertNoOverlap(actor.schoolId, start, end, id);
    }

    const updated = await this.config.updatePeriod(id, {
      ...(dto.name ? { name: dto.name.trim() } : {}),
      startDate: start,
      endDate: end,
      updatedBy: actor.sub,
    });
    this.auditContext.set({
      entityType: 'FiscalPeriod',
      entityId: id,
      oldValues: {
        from: isoDate(period.startDate),
        to: isoDate(period.endDate),
      },
      newValues: { from: isoDate(start), to: isoDate(end) },
    });
    return updated;
  }

  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const period = await this.getById(id, actor.schoolId);
    const attached = await this.vouchers.countInPeriod(actor.schoolId, id);
    if (attached > 0) {
      throw new ConflictException(
        `${period.name} holds ${attached} voucher(s) and cannot be deleted`,
      );
    }
    await this.config.softDeletePeriod(id);
    this.auditContext.set({
      entityType: 'FiscalPeriod',
      entityId: id,
      oldValues: { name: period.name },
    });
  }

  /**
   * Close a period. A DRAFT voucher inside the range blocks it: a draft
   * is somebody's unfinished work, and closing over it would either strand
   * it forever or force it into the next period under a date it does not
   * carry. Naming the count tells the accountant exactly what to go and
   * finish.
   */
  async close(
    id: string,
    dto: ClosePeriodDto,
    actor: AccessTokenPayload,
  ): Promise<FiscalPeriod> {
    const period = await this.getById(id, actor.schoolId);
    if (period.status === FiscalPeriodStatus.CLOSED) {
      throw new ConflictException(`${period.name} is already closed`);
    }

    const drafts = await this.vouchers.countDraftsInRange(
      actor.schoolId,
      period.startDate,
      period.endDate,
    );
    if (drafts > 0) {
      throw new ConflictException(
        `${drafts} draft voucher(s) are dated inside ${period.name} — post or delete them before closing`,
      );
    }

    const closed = await this.config.updatePeriod(id, {
      status: FiscalPeriodStatus.CLOSED,
      closedBy: actor.sub,
      closedAt: new Date(),
      closingNote: dto.note?.trim() || null,
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'FiscalPeriod',
      entityId: id,
      oldValues: { status: FiscalPeriodStatus.OPEN },
      newValues: { status: FiscalPeriodStatus.CLOSED, note: dto.note ?? null },
    });
    return closed;
  }

  /** Roadmap §6: reopening needs `accounting.period.reopen` + an audit row. */
  async reopen(
    id: string,
    dto: ReopenPeriodDto,
    actor: AccessTokenPayload,
  ): Promise<FiscalPeriod> {
    const period = await this.getById(id, actor.schoolId);
    if (period.status !== FiscalPeriodStatus.CLOSED) {
      throw new ConflictException(`${period.name} is already open`);
    }
    await this.assertPermission(
      actor,
      'accounting.period.reopen',
      'Reopening a closed accounting period requires accounting.period.reopen',
    );

    const reopened = await this.config.updatePeriod(id, {
      status: FiscalPeriodStatus.OPEN,
      reopenedBy: actor.sub,
      reopenedAt: new Date(),
      closingNote: dto.reason.trim(),
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'FiscalPeriod',
      entityId: id,
      oldValues: { status: FiscalPeriodStatus.CLOSED },
      newValues: { status: FiscalPeriodStatus.OPEN, reason: dto.reason },
    });
    return reopened;
  }

  // ── the rule every posting consults ─────────────────────────────────

  /**
   * Which period a voucher dated `date` belongs to — and what to do when
   * that period is closed.
   *
   * Roadmap §8 documents the BD practice explicitly: *a backdated fee
   * payment arriving after a close posts to the open period with a note.*
   * That is deliberately not a refusal, because the money genuinely
   * arrived and refusing it would leave real cash outside the books; and
   * it is deliberately not a silent re-date, because the note is what
   * lets next year's auditor see why a July receipt sits in August.
   *
   * A school that wants the strict behaviour turns
   * `accounting.backdate_after_close` off, and then a closed period
   * refuses outright.
   */
  async resolvePeriodFor(schoolId: string, date: Date): Promise<PeriodVerdict> {
    const period = await this.config.findPeriodForDate(schoolId, date);

    // A school that never defined periods is not blocked from keeping
    // books — the period machinery is opt-in until it is set up.
    if (!period) return { period: null };
    if (period.status === FiscalPeriodStatus.OPEN) return { period };

    const config = await this.settings.load(schoolId);
    if (!config.backdateAfterClose) {
      throw new ConflictException(
        `${isoDate(date)} falls in ${period.name}, which is closed. Reopen the period (accounting.period.reopen) or date the voucher inside an open one.`,
      );
    }

    const open = await this.config.findEarliestOpenPeriodFrom(schoolId, date);
    if (!open) {
      throw new ConflictException(
        `${isoDate(date)} falls in ${period.name}, which is closed, and there is no open period after it to post into`,
      );
    }

    return {
      period: open,
      redirectedFrom: period,
      note: `Backdated to ${isoDate(date)}; ${period.name} was closed, so this is recorded in ${open.name}`,
    };
  }

  // ── internals ───────────────────────────────────────────────────────

  private async assertNoOverlap(
    schoolId: string,
    from: Date,
    to: Date,
    excludeId?: string,
  ): Promise<void> {
    const clash = await this.config.findOverlappingPeriod({
      schoolId,
      from,
      to,
      excludeId,
    });
    if (clash) {
      throw new ConflictException(
        `That range overlaps "${clash.name}" (${isoDate(clash.startDate)} → ${isoDate(clash.endDate)}) — every date belongs to exactly one period`,
      );
    }
  }

  /** Runtime permission check, the M08/M12/M16 override convention. */
  private async assertPermission(
    actor: AccessTokenPayload,
    code: string,
    message: string,
  ): Promise<void> {
    if (actor.userType === UserType.SUPER_ADMIN) return;
    const codes = await this.permissions.getUserPermissionCodes(actor.sub);
    if (!codes.includes(code)) throw new ForbiddenException(message);
  }
}
