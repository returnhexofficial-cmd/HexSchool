import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BonusRun, PayrollRunStatus } from '@prisma/client';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { CreateBonusDto, UpdateBonusDto } from '../dto';
import {
  BonusRunsRepository,
  PayrollRunsRepository,
} from '../repositories/payroll.repository';
import { HrSettingsService } from './hr-settings.service';
import { monthStart } from './payroll.service';

/**
 * Bonus rounds — the festival bonus a BD school pays with a chosen
 * month's salary (roadmap M21 §3/§6).
 *
 * A round is a *rule*, not a set of amounts: it names a basis (a
 * percentage of basic, or a flat figure), a minimum service length, and
 * whether somebody short of that gets a prorated share. Payroll
 * generation resolves it per person, so adding a teacher in March and
 * regenerating gets their Eid bonus right without anyone re-entering it.
 */
@Injectable()
export class BonusService {
  constructor(
    private readonly bonuses: BonusRunsRepository,
    private readonly runs: PayrollRunsRepository,
    private readonly config: HrSettingsService,
    private readonly auditContext: AuditContextService,
  ) {}

  async list(schoolId: string): Promise<BonusRun[]> {
    return this.bonuses.findAllForSchool(schoolId);
  }

  async getOrFail(id: string, schoolId: string): Promise<BonusRun> {
    const row = await this.bonuses.findById(id, schoolId);
    if (!row) throw new NotFoundException(`Bonus run ${id} not found`);
    return row;
  }

  async create(
    dto: CreateBonusDto,
    actor: AccessTokenPayload,
  ): Promise<BonusRun> {
    const schoolId = actor.schoolId;
    const config = await this.config.load(schoolId);
    const month = dto.monthPaidWith ? monthStart(dto.monthPaidWith) : null;
    if (month) await this.assertMonthOpen(schoolId, month);

    const created = await this.bonuses.create({
      schoolId,
      name: dto.name.trim(),
      ...(dto.type ? { type: dto.type } : {}),
      ...(dto.basis ? { basis: dto.basis } : {}),
      value: dto.value,
      monthPaidWith: month,
      // The school-wide defaults are the starting point, so a round
      // created without thinking about eligibility still follows the
      // policy the settings screen states.
      minServiceMonths:
        dto.minServiceMonths ?? config.festivalBonusMinServiceMonths,
      prorate: dto.prorate ?? config.festivalBonusProrate,
      ...(dto.applicableTo ? { applicableTo: dto.applicableTo } : {}),
      isActive: dto.isActive ?? true,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'BonusRun',
      entityId: created.id,
      newValues: {
        name: created.name,
        basis: created.basis,
        value: Number(created.value),
        monthPaidWith: dto.monthPaidWith ?? null,
      },
    });
    return created;
  }

  async update(
    id: string,
    dto: UpdateBonusDto,
    actor: AccessTokenPayload,
  ): Promise<BonusRun> {
    const existing = await this.getOrFail(id, actor.schoolId);
    const month =
      dto.monthPaidWith !== undefined
        ? dto.monthPaidWith
          ? monthStart(dto.monthPaidWith)
          : null
        : existing.monthPaidWith;

    // Editing a round whose month is already approved would change what a
    // frozen payslip says it paid. The month has to be reopened (or the
    // run cancelled) first — the same rule that freezes an APPROVED run.
    if (month) await this.assertMonthOpen(actor.schoolId, month);
    if (existing.monthPaidWith) {
      await this.assertMonthOpen(actor.schoolId, existing.monthPaidWith);
    }

    const updated = await this.bonuses.update(id, {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.type !== undefined ? { type: dto.type } : {}),
      ...(dto.basis !== undefined ? { basis: dto.basis } : {}),
      ...(dto.value !== undefined ? { value: dto.value } : {}),
      ...(dto.monthPaidWith !== undefined ? { monthPaidWith: month } : {}),
      ...(dto.minServiceMonths !== undefined
        ? { minServiceMonths: dto.minServiceMonths }
        : {}),
      ...(dto.prorate !== undefined ? { prorate: dto.prorate } : {}),
      ...(dto.applicableTo !== undefined
        ? { applicableTo: dto.applicableTo }
        : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'BonusRun',
      entityId: id,
      oldValues: { name: existing.name, value: Number(existing.value) },
      newValues: { name: updated.name, value: Number(updated.value) },
    });
    return updated;
  }

  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.getOrFail(id, actor.schoolId);
    if (existing.monthPaidWith) {
      await this.assertMonthOpen(actor.schoolId, existing.monthPaidWith);
    }
    await this.bonuses.softDelete(id);
    this.auditContext.set({
      entityType: 'BonusRun',
      entityId: id,
      oldValues: { name: existing.name, value: Number(existing.value) },
    });
  }

  private async assertMonthOpen(schoolId: string, month: Date): Promise<void> {
    const run = await this.runs.findForMonth(schoolId, month);
    if (
      run &&
      run.status !== PayrollRunStatus.DRAFT &&
      run.status !== PayrollRunStatus.GENERATED
    ) {
      throw new ConflictException(
        `The payroll for that month is already ${run.status} — a bonus attached to it can no longer change`,
      );
    }
  }
}
