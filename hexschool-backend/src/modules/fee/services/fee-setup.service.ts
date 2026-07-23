import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FeeHead, FeeStructure } from '@prisma/client';
import { FeeOverrideType, UserType } from '../../../common/constants';
import { parseDate } from '../../academic/calendar/date.util';
import { ClassesRepository } from '../../academic/repositories/classes.repository';
import { SessionsService } from '../../academic/services/sessions.service';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { EnrollmentsRepository } from '../../enrollment/repositories/enrollments.repository';
import { PermissionsService } from '../../rbac/services/permissions.service';
import { money } from '../calc/money.util';
import {
  CloneFeeStructuresDto,
  CreateFeeHeadDto,
  CreateFeeOverrideDto,
  FeeStructureQueryDto,
  SaveFeeStructuresDto,
  UpdateFeeHeadDto,
  UpdateFeeOverrideDto,
} from '../dto';
import { FeeHeadsRepository } from '../repositories/fee-heads.repository';
import {
  FeeOverrideWithRelations,
  FeeOverridesRepository,
} from '../repositories/fee-overrides.repository';
import {
  FeeStructuresRepository,
  FeeStructureWithRelations,
} from '../repositories/fee-structures.repository';

export interface CloneResult {
  created: number;
  skipped: number;
  dryRun: boolean;
  rows: Array<{ classId: string; feeHeadId: string; amount: number }>;
}

/**
 * Fee heads, the class × head amount matrix, and per-student
 * concessions (roadmap M16 §4).
 *
 * Two rules worth calling out:
 *
 *   - **A billed head is history.** A fee head that has never appeared on
 *     an invoice can be deleted; once it has, it can only be retired —
 *     deleting it would orphan the line on a receipt someone holds.
 *   - **A waiver needs a second signature.** Recording any concession
 *     needs `fee.override.manage`; a WAIVER (or a 100 % discount, which
 *     is the same thing spelled differently) additionally needs
 *     `fee.override.approve`. That separation is the whole reason the
 *     Accountant role deliberately lacks the approve code.
 */
@Injectable()
export class FeeSetupService {
  constructor(
    private readonly heads: FeeHeadsRepository,
    private readonly structures: FeeStructuresRepository,
    private readonly overrides: FeeOverridesRepository,
    private readonly classes: ClassesRepository,
    private readonly enrollments: EnrollmentsRepository,
    private readonly sessions: SessionsService,
    private readonly permissions: PermissionsService,
    private readonly auditContext: AuditContextService,
  ) {}

  // ── fee heads ───────────────────────────────────────────────────────

  async listHeads(schoolId: string): Promise<FeeHead[]> {
    return this.heads.findAllOrdered(schoolId);
  }

  async createHead(
    dto: CreateFeeHeadDto,
    actor: AccessTokenPayload,
  ): Promise<FeeHead> {
    const clash = await this.heads.findByName(actor.schoolId, dto.name);
    if (clash) {
      throw new ConflictException(
        `A fee head named "${dto.name.trim()}" already exists`,
      );
    }

    const created = await this.heads.create({
      schoolId: actor.schoolId,
      name: dto.name.trim(),
      code: dto.code?.trim() || null,
      ...(dto.type ? { type: dto.type } : {}),
      ...(dto.isRefundable !== undefined
        ? { isRefundable: dto.isRefundable }
        : {}),
      displayOrder: dto.displayOrder ?? 0,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'FeeHead',
      entityId: created.id,
      newValues: { name: created.name, type: created.type },
    });
    return created;
  }

  async updateHead(
    id: string,
    dto: UpdateFeeHeadDto,
    actor: AccessTokenPayload,
  ): Promise<FeeHead> {
    const existing = await this.heads.findByIdOrFail(id, actor.schoolId);

    if (dto.name && dto.name.trim().toLowerCase() !== existing.name.toLowerCase()) {
      const clash = await this.heads.findByName(actor.schoolId, dto.name, id);
      if (clash) {
        throw new ConflictException(
          `A fee head named "${dto.name.trim()}" already exists`,
        );
      }
    }

    const updated = await this.heads.update(id, {
      ...(dto.name ? { name: dto.name.trim() } : {}),
      ...(dto.code !== undefined ? { code: dto.code?.trim() || null } : {}),
      ...(dto.type ? { type: dto.type } : {}),
      ...(dto.isRefundable !== undefined
        ? { isRefundable: dto.isRefundable }
        : {}),
      ...(dto.displayOrder !== undefined
        ? { displayOrder: dto.displayOrder }
        : {}),
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'FeeHead',
      entityId: id,
      oldValues: { name: existing.name, type: existing.type },
      newValues: { name: updated.name, type: updated.type },
    });
    return updated;
  }

  async removeHead(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.heads.findByIdOrFail(id, actor.schoolId);

    // A head that has been billed is part of someone's receipt.
    const billed = await this.heads.countInvoiceItems(id);
    if (billed > 0) {
      throw new ConflictException(
        `"${existing.name}" appears on ${billed} invoice line(s) and cannot be deleted — remove its fee structures instead so it stops being billed`,
      );
    }
    const structures = await this.heads.countStructures(id);
    if (structures > 0) {
      throw new ConflictException(
        `"${existing.name}" is used by ${structures} fee structure(s) — remove those first`,
      );
    }

    await this.heads.softDelete(id);
    this.auditContext.set({
      entityType: 'FeeHead',
      entityId: id,
      oldValues: { name: existing.name },
    });
  }

  // ── structures ──────────────────────────────────────────────────────

  async listStructures(
    query: FeeStructureQueryDto,
    schoolId: string,
  ): Promise<FeeStructureWithRelations[]> {
    const sessionId = await this.resolveSession(query.sessionId, schoolId);
    return this.structures.findForSession(schoolId, sessionId, {
      classId: query.classId,
      feeHeadId: query.feeHeadId,
    });
  }

  /**
   * Bulk save of the matrix. Rows absent from the payload are left
   * alone — clearing a cell is an explicit delete, so a partially
   * loaded grid can never wipe structures it did not display.
   */
  async saveStructures(
    dto: SaveFeeStructuresDto,
    actor: AccessTokenPayload,
  ): Promise<{ created: number; updated: number }> {
    const schoolId = actor.schoolId;
    const sessionId = await this.resolveSession(dto.sessionId, schoolId);
    await this.assertSessionWritable(sessionId, schoolId);

    // Validate the whole payload before writing any of it.
    for (const row of dto.structures) {
      const klass = await this.classes.findById(row.classId, schoolId);
      if (!klass) {
        throw new BadRequestException(`Class ${row.classId} not found`);
      }
      const head = await this.heads.findById(row.feeHeadId, schoolId);
      if (!head) {
        throw new BadRequestException(`Fee head ${row.feeHeadId} not found`);
      }
    }

    let created = 0;
    let updated = 0;

    await this.structures.withTransaction(async (tx) => {
      for (const row of dto.structures) {
        const existing = await this.structures.findIdentity(
          sessionId,
          row.classId,
          row.feeHeadId,
          row.groupId ?? null,
        );

        if (existing) {
          await this.structures.update(
            existing.id,
            {
              amount: money(row.amount),
              dueDay: row.dueDay ?? null,
              updatedBy: actor.sub,
            },
            tx,
          );
          updated += 1;
        } else {
          await this.structures.create(
            {
              schoolId,
              sessionId,
              classId: row.classId,
              groupId: row.groupId ?? null,
              feeHeadId: row.feeHeadId,
              amount: money(row.amount),
              dueDay: row.dueDay ?? null,
              createdBy: actor.sub,
              updatedBy: actor.sub,
            },
            tx,
          );
          created += 1;
        }
      }
    });

    this.auditContext.set({
      entityType: 'FeeStructure',
      entityId: sessionId,
      newValues: { sessionId, created, updated, rows: dto.structures.length },
    });

    return { created, updated };
  }

  async removeStructure(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.structures.findById(id, actor.schoolId);
    if (!existing) throw new NotFoundException(`Fee structure ${id} not found`);

    await this.structures.softDelete(id, actor.sub);
    this.auditContext.set({
      entityType: 'FeeStructure',
      entityId: id,
      oldValues: {
        classId: existing.classId,
        feeHeadId: existing.feeHeadId,
        amount: Number(existing.amount),
      },
    });
  }

  /**
   * Copy a session's whole structure into another, optionally raising
   * every amount (the annual increment). Additive and idempotent — a
   * head already priced in the target session is skipped, never
   * overwritten, which is the M06 clone contract.
   */
  async cloneStructures(
    dto: CloneFeeStructuresDto,
    actor: AccessTokenPayload,
  ): Promise<CloneResult> {
    const schoolId = actor.schoolId;
    if (dto.fromSessionId === dto.toSessionId) {
      throw new BadRequestException('Pick two different sessions');
    }
    await this.sessions.getById(dto.fromSessionId, schoolId);
    await this.assertSessionWritable(dto.toSessionId, schoolId);

    const source = await this.structures.findForSession(
      schoolId,
      dto.fromSessionId,
    );
    if (source.length === 0) {
      throw new BadRequestException(
        'The source session has no fee structures to copy',
      );
    }

    const factor = 1 + (dto.adjustPercent ?? 0) / 100;
    const rows: CloneResult['rows'] = [];
    let created = 0;
    let skipped = 0;

    const plan: Array<{ row: FeeStructureWithRelations; amount: number }> = [];
    for (const row of source) {
      const existing = await this.structures.findIdentity(
        dto.toSessionId,
        row.classId,
        row.feeHeadId,
        row.groupId,
      );
      if (existing) {
        skipped += 1;
        continue;
      }
      const amount = money(Number(row.amount) * factor);
      plan.push({ row, amount });
      rows.push({
        classId: row.classId,
        feeHeadId: row.feeHeadId,
        amount,
      });
    }

    if (dto.dryRun) {
      return { created: plan.length, skipped, dryRun: true, rows };
    }

    await this.structures.withTransaction(async (tx) => {
      for (const { row, amount } of plan) {
        await this.structures.create(
          {
            schoolId,
            sessionId: dto.toSessionId,
            classId: row.classId,
            groupId: row.groupId,
            feeHeadId: row.feeHeadId,
            amount,
            dueDay: row.dueDay,
            createdBy: actor.sub,
            updatedBy: actor.sub,
          },
          tx,
        );
        created += 1;
      }
    });

    this.auditContext.set({
      entityType: 'FeeStructure',
      entityId: dto.toSessionId,
      newValues: {
        action: 'CLONE',
        from: dto.fromSessionId,
        to: dto.toSessionId,
        adjustPercent: dto.adjustPercent ?? 0,
        created,
        skipped,
      },
    });

    return { created, skipped, dryRun: false, rows };
  }

  // ── overrides ───────────────────────────────────────────────────────

  async listOverrides(
    enrollmentId: string,
  ): Promise<FeeOverrideWithRelations[]> {
    return this.overrides.findForEnrollment(enrollmentId);
  }

  async createOverride(
    dto: CreateFeeOverrideDto,
    actor: AccessTokenPayload,
  ): Promise<FeeOverrideWithRelations> {
    const schoolId = actor.schoolId;

    const enrollment = await this.enrollments.findById(
      dto.enrollmentId,
      schoolId,
    );
    if (!enrollment) {
      throw new BadRequestException(`Enrollment ${dto.enrollmentId} not found`);
    }
    const head = await this.heads.findById(dto.feeHeadId, schoolId);
    if (!head) {
      throw new BadRequestException(`Fee head ${dto.feeHeadId} not found`);
    }

    // A waiver — or a 100 % discount, which is the same thing spelled
    // differently — needs a second signature.
    const needsApproval =
      dto.type === FeeOverrideType.WAIVER ||
      (dto.type === FeeOverrideType.DISCOUNT_PERCENT && dto.value >= 100);
    if (needsApproval) {
      await this.assertPermission(
        actor,
        'fee.override.approve',
        'A full waiver needs fee.override.approve',
      );
    }

    if (dto.type === FeeOverrideType.DISCOUNT_PERCENT && dto.value > 100) {
      throw new BadRequestException('A percentage discount cannot exceed 100');
    }

    const validFrom = dto.validFrom ? parseDate(dto.validFrom) : null;
    const validTo = dto.validTo ? parseDate(dto.validTo) : null;
    if (validFrom && validTo && validFrom > validTo) {
      throw new BadRequestException('validFrom must be on or before validTo');
    }

    const created = await this.overrides.create({
      schoolId,
      enrollmentId: dto.enrollmentId,
      feeHeadId: dto.feeHeadId,
      type: dto.type,
      value: money(dto.value),
      reason: dto.reason.trim(),
      validFrom,
      validTo,
      ...(needsApproval
        ? { approvedBy: actor.sub, approvedAt: new Date() }
        : {}),
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'StudentFeeOverride',
      entityId: created.id,
      newValues: {
        enrollmentId: dto.enrollmentId,
        feeHead: head.name,
        type: dto.type,
        value: dto.value,
        reason: dto.reason,
        approved: needsApproval,
      },
    });

    const detail = await this.overrides.findById(created.id, schoolId);
    return detail!;
  }

  async updateOverride(
    id: string,
    dto: UpdateFeeOverrideDto,
    actor: AccessTokenPayload,
  ): Promise<FeeOverrideWithRelations> {
    const existing = await this.overrides.findById(id, actor.schoolId);
    if (!existing) throw new NotFoundException(`Override ${id} not found`);

    await this.overrides.update(id, {
      ...(dto.value !== undefined ? { value: money(dto.value) } : {}),
      ...(dto.reason ? { reason: dto.reason.trim() } : {}),
      ...(dto.validFrom !== undefined
        ? { validFrom: dto.validFrom ? parseDate(dto.validFrom) : null }
        : {}),
      ...(dto.validTo !== undefined
        ? { validTo: dto.validTo ? parseDate(dto.validTo) : null }
        : {}),
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'StudentFeeOverride',
      entityId: id,
      oldValues: { value: Number(existing.value), reason: existing.reason },
      newValues: { value: dto.value, reason: dto.reason },
    });

    const detail = await this.overrides.findById(id, actor.schoolId);
    return detail!;
  }

  async removeOverride(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.overrides.findById(id, actor.schoolId);
    if (!existing) throw new NotFoundException(`Override ${id} not found`);

    await this.overrides.softDelete(id, actor.sub);
    this.auditContext.set({
      entityType: 'StudentFeeOverride',
      entityId: id,
      oldValues: {
        type: existing.type,
        value: Number(existing.value),
        reason: existing.reason,
      },
    });
  }

  // ── internals ───────────────────────────────────────────────────────

  /** Runtime permission check — the M08/M12/M14 override convention. */
  private async assertPermission(
    actor: AccessTokenPayload,
    code: string,
    message: string,
  ): Promise<void> {
    if (actor.userType === UserType.SUPER_ADMIN) return;
    const codes = await this.permissions.getUserPermissionCodes(actor.sub);
    if (!codes.includes(code)) throw new ForbiddenException(message);
  }

  private async resolveSession(
    sessionId: string | undefined,
    schoolId: string,
  ): Promise<string> {
    if (sessionId) return sessionId;
    const current = await this.sessions.getCurrent(schoolId);
    if (!current) {
      throw new BadRequestException(
        'No current academic session — pass sessionId explicitly',
      );
    }
    return current.id;
  }

  /** The M05 read-only rule, as enforced by M12/M13/M14/M15. */
  private async assertSessionWritable(
    sessionId: string,
    schoolId: string,
  ): Promise<void> {
    const session = await this.sessions.getById(sessionId, schoolId);
    if (session.status === 'COMPLETED' || session.status === 'ARCHIVED') {
      throw new BadRequestException(
        `Session ${session.name} is ${session.status} — fee setup is read-only`,
      );
    }
  }

  /** Exposed for the invoice generator, which needs the same lookup. */
  async structuresFor(
    schoolId: string,
    sessionId: string,
    classId: string,
    groupId: string | null,
  ): Promise<FeeStructureWithRelations[]> {
    return this.structures.findBillable(schoolId, sessionId, classId, groupId);
  }

  async headById(id: string, schoolId: string): Promise<FeeHead | null> {
    return this.heads.findById(id, schoolId);
  }

  async structureById(
    id: string,
    schoolId: string,
  ): Promise<FeeStructure | null> {
    return this.structures.findById(id, schoolId);
  }
}
