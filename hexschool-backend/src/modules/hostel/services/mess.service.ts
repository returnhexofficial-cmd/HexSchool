import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  HostelAllocationStatus,
  MealOffStatus,
} from '../../../common/constants';
import { dhakaToday } from '../../../common/utils/clock.util';
import { isoDate, parseDate } from '../../academic/calendar/date.util';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import {
  checkMealOff,
  isLiveMealOff,
  mealOffDays,
  rangesOverlap,
} from '../calc/mess.engine';
import { residencyWindow } from '../calc/residency.engine';
import { firstOfMonth, monthOf, nextMonth } from '../calc/types';
import type {
  CreateMealOffDto,
  CreateMessEnrollmentDto,
  DecideMealOffDto,
  EndMessEnrollmentDto,
  MealOffQueryDto,
  MessEnrollmentQueryDto,
  MessPlanQueryDto,
  UpdateMealOffDto,
  UpsertMessPlanDto,
} from '../dto';
import { HostelAllocationsRepository } from '../repositories/hostel-allocations.repository';
import { HostelsRepository } from '../repositories/hostels.repository';
import {
  MealOffsRepository,
  MessEnrollmentsRepository,
  MessPlansRepository,
} from '../repositories/mess.repository';
import { HostelNotificationsService } from './hostel-notifications.service';
import { HostelSettingsService } from './hostel-settings.service';

/**
 * The kitchen: what it charges, who is on which plan, and who is away.
 *
 * **`credit_month` is decided here and nowhere else.** Roadmap §4 puts
 * the meal-off credit on the *next* invoice, so approving a request
 * computes which month's bill will carry it — the month after the later
 * of the last day off and the day the decision was made — and stores it.
 * Billing then reads a plain equality.
 *
 * The alternative (a "credited" flag the invoice run consumes) breaks on
 * the first invoice **preview**: a preview would eat the credit without
 * raising a bill, and the real run a minute later would find nothing to
 * apply. Deciding the month once, at approval, makes the credit
 * deterministic — regenerating a month produces the same number — and
 * means a request approved late is credited late rather than lost.
 */
@Injectable()
export class MessService {
  constructor(
    private readonly plans: MessPlansRepository,
    private readonly enrollments: MessEnrollmentsRepository,
    private readonly mealOffs: MealOffsRepository,
    private readonly allocations: HostelAllocationsRepository,
    private readonly hostels: HostelsRepository,
    private readonly config: HostelSettingsService,
    private readonly notifications: HostelNotificationsService,
    private readonly audit: AuditContextService,
  ) {}

  // ── plans ───────────────────────────────────────────────────────────

  async listPlans(query: MessPlanQueryDto, actor: AccessTokenPayload) {
    const rows = await this.plans.findMany(actor.schoolId, query);
    return Promise.all(
      rows.map(async (plan) => ({
        ...plan,
        monthlyCharge: Number(plan.monthlyCharge),
        subscribers: await this.plans.countSubscribers(plan.id),
      })),
    );
  }

  async createPlan(dto: UpsertMessPlanDto, actor: AccessTokenPayload) {
    const hostel = await this.hostels.findDetail(dto.hostelId, actor.schoolId);
    if (!hostel)
      throw new NotFoundException(`Hostel ${dto.hostelId} not found`);

    const clash = await this.plans.findByName(dto.hostelId, dto.name);
    if (clash) {
      throw new ConflictException(
        `"${hostel.name}" already has a plan called "${dto.name}".`,
      );
    }

    const created = await this.plans.create({
      schoolId: actor.schoolId,
      hostelId: dto.hostelId,
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      monthlyCharge: dto.monthlyCharge,
      status: dto.status ?? 'ACTIVE',
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'MessPlan',
      entityId: created.id,
      newValues: { name: created.name, monthlyCharge: dto.monthlyCharge },
    });
    return { ...created, monthlyCharge: Number(created.monthlyCharge) };
  }

  async updatePlan(
    id: string,
    dto: UpsertMessPlanDto,
    actor: AccessTokenPayload,
  ) {
    const existing = await this.plans.findByIdOrFail(id, actor.schoolId);

    // Moving a plan between hostels would orphan every subscriber's
    // composite FK — and the FK would refuse it anyway.
    if (dto.hostelId !== existing.hostelId) {
      throw new BadRequestException(
        'A mess plan belongs to one building. Create a plan in the other hostel instead.',
      );
    }

    const clash = await this.plans.findByName(existing.hostelId, dto.name, id);
    if (clash) {
      throw new ConflictException(`That hostel already has a "${dto.name}".`);
    }

    await this.plans.update(id, {
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      monthlyCharge: dto.monthlyCharge,
      status: dto.status ?? existing.status,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'MessPlan',
      entityId: id,
      oldValues: {
        name: existing.name,
        monthlyCharge: Number(existing.monthlyCharge),
      },
      newValues: { name: dto.name, monthlyCharge: dto.monthlyCharge },
    });
    const updated = await this.plans.findByIdOrFail(id, actor.schoolId);
    return { ...updated, monthlyCharge: Number(updated.monthlyCharge) };
  }

  async removePlan(id: string, actor: AccessTokenPayload): Promise<void> {
    const plan = await this.plans.findByIdOrFail(id, actor.schoolId);
    const subscribers = await this.plans.countSubscribers(id);
    if (subscribers > 0) {
      // The M25 stop rule: deleting a priced thing with people attached
      // to it stops those families being billed *silently*.
      throw new ConflictException(
        `${subscribers} boarder(s) are on "${plan.name}". Move them to another plan first — deleting it would stop billing them without anybody noticing.`,
      );
    }
    await this.plans.softDelete(id);
    this.audit.set({
      entityType: 'MessPlan',
      entityId: id,
      oldValues: { name: plan.name },
    });
  }

  // ── mess enrolments ─────────────────────────────────────────────────

  async listEnrollments(
    query: MessEnrollmentQueryDto,
    actor: AccessTokenPayload,
  ) {
    return this.enrollments.findMany(actor.schoolId, query);
  }

  async enroll(dto: CreateMessEnrollmentDto, actor: AccessTokenPayload) {
    const allocation = await this.allocations.findDetail(
      dto.allocationId,
      actor.schoolId,
    );
    if (!allocation) {
      throw new NotFoundException(`Allocation ${dto.allocationId} not found`);
    }
    if (allocation.status === HostelAllocationStatus.VACATED) {
      throw new ConflictException(
        'That boarder has left the hostel — they cannot be put on a mess plan.',
      );
    }

    const plan = await this.plans.findByIdOrFail(dto.planId, actor.schoolId);
    if (plan.hostelId !== allocation.hostelId) {
      throw new BadRequestException(
        `"${plan.name}" belongs to a different hostel from the one this boarder lives in.`,
      );
    }
    if (plan.status !== 'ACTIVE') {
      throw new ConflictException(`"${plan.name}" is not currently offered.`);
    }

    const startDate = dto.startDate ? parseDate(dto.startDate) : today();
    if (startDate < allocation.startDate) {
      throw new BadRequestException(
        'A boarder cannot start eating before they moved in.',
      );
    }

    // Changing plan closes the old window rather than editing it: the
    // boarder ate full board for eleven days and lunch-only for twenty,
    // and both halves have to be billable (the M21 salary-history rule).
    const live = await this.enrollments.findLive(dto.allocationId);
    const created = await this.enrollments.withTransaction(async (tx) => {
      if (live) {
        if (live.planId === dto.planId) {
          throw new ConflictException(
            `That boarder is already on "${plan.name}".`,
          );
        }
        await tx.messEnrollment.update({
          where: { id: live.id },
          data: { endDate: startDate, updatedBy: actor.sub },
        });
      }
      return this.enrollments.create(
        {
          schoolId: actor.schoolId,
          hostelId: allocation.hostelId,
          allocationId: dto.allocationId,
          planId: dto.planId,
          startDate,
          createdBy: actor.sub,
          updatedBy: actor.sub,
        },
        tx,
      );
    });

    this.audit.set({
      entityType: 'MessEnrollment',
      entityId: created.id,
      ...(live ? { oldValues: { plan: live.plan.name } } : {}),
      newValues: { plan: plan.name, startDate: isoDate(startDate) },
    });
    return this.enrollments.findDetail(created.id, actor.schoolId);
  }

  async endEnrollment(
    id: string,
    dto: EndMessEnrollmentDto,
    actor: AccessTokenPayload,
  ) {
    const existing = await this.enrollments.findDetail(id, actor.schoolId);
    if (!existing) {
      throw new NotFoundException(`Mess enrolment ${id} not found`);
    }
    if (existing.endDate) {
      throw new ConflictException('That mess enrolment has already ended.');
    }

    const endDate = dto.endDate ? parseDate(dto.endDate) : today();
    if (endDate < existing.startDate) {
      throw new BadRequestException(
        'A mess enrolment cannot end before it started.',
      );
    }

    await this.enrollments.update(id, { endDate, updatedBy: actor.sub });
    this.audit.set({
      entityType: 'MessEnrollment',
      entityId: id,
      newValues: { endDate: isoDate(endDate) },
    });
    return this.enrollments.findDetail(id, actor.schoolId);
  }

  // ── meal-offs ───────────────────────────────────────────────────────

  async listMealOffs(query: MealOffQueryDto, actor: AccessTokenPayload) {
    const { rows, total } = await this.mealOffs.findMany(
      actor.schoolId,
      {
        hostelId: query.hostelId,
        allocationId: query.allocationId,
        status: query.status,
        from: query.from ? parseDate(query.from) : undefined,
        to: query.to ? parseDate(query.to) : undefined,
      },
      query.page,
      query.limit,
    );
    return {
      data: rows.map((row) => ({
        ...row,
        days: mealOffDays(isoDate(row.fromDate), isoDate(row.toDate)),
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async requestMealOff(dto: CreateMealOffDto, actor: AccessTokenPayload) {
    const cfg = await this.config.load(actor.schoolId);
    const allocation = await this.allocations.findDetail(
      dto.allocationId,
      actor.schoolId,
    );
    if (!allocation) {
      throw new NotFoundException(`Allocation ${dto.allocationId} not found`);
    }

    const verdict = checkMealOff({
      fromDate: dto.fromDate.slice(0, 10),
      toDate: dto.toDate.slice(0, 10),
      minDays: cfg.mealOffMinDays,
      residency: residencyWindow({
        startDate: isoDate(allocation.startDate),
        endDate: allocation.endDate ? isoDate(allocation.endDate) : null,
        suspendedAt: allocation.suspendedAt
          ? isoDate(allocation.suspendedAt)
          : null,
        resumedAt: allocation.resumedAt ? isoDate(allocation.resumedAt) : null,
        status: allocation.status,
      }),
    });
    if (!verdict.ok) {
      throw new BadRequestException(verdict.reason ?? 'Meal-off refused');
    }

    await this.assertNoOverlap(dto.allocationId, dto.fromDate, dto.toDate);

    const created = await this.mealOffs.create({
      schoolId: actor.schoolId,
      allocationId: dto.allocationId,
      fromDate: parseDate(dto.fromDate),
      toDate: parseDate(dto.toDate),
      reason: dto.reason.trim(),
      status: MealOffStatus.PENDING,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'MealOff',
      entityId: created.id,
      newValues: {
        from: dto.fromDate.slice(0, 10),
        to: dto.toDate.slice(0, 10),
        days: verdict.days,
      },
    });
    return this.mealOffs.findDetail(created.id, actor.schoolId);
  }

  async updateMealOff(
    id: string,
    dto: UpdateMealOffDto,
    actor: AccessTokenPayload,
  ) {
    const cfg = await this.config.load(actor.schoolId);
    const existing = await this.mealOffs.findDetail(id, actor.schoolId);
    if (!existing) throw new NotFoundException(`Meal-off ${id} not found`);
    if (existing.status !== MealOffStatus.PENDING) {
      throw new ConflictException(
        `That request has already been ${existing.status.toLowerCase()} — it cannot be edited.`,
      );
    }

    const fromDate = dto.fromDate?.slice(0, 10) ?? isoDate(existing.fromDate);
    const toDate = dto.toDate?.slice(0, 10) ?? isoDate(existing.toDate);

    const verdict = checkMealOff({
      fromDate,
      toDate,
      minDays: cfg.mealOffMinDays,
      residency: residencyWindow({
        startDate: isoDate(existing.allocation.startDate),
        endDate: existing.allocation.endDate
          ? isoDate(existing.allocation.endDate)
          : null,
        suspendedAt: existing.allocation.suspendedAt
          ? isoDate(existing.allocation.suspendedAt)
          : null,
        resumedAt: existing.allocation.resumedAt
          ? isoDate(existing.allocation.resumedAt)
          : null,
        status: existing.allocation.status,
      }),
    });
    if (!verdict.ok) {
      throw new BadRequestException(verdict.reason ?? 'Meal-off refused');
    }

    await this.assertNoOverlap(existing.allocationId, fromDate, toDate, id);

    await this.mealOffs.update(id, {
      fromDate: parseDate(fromDate),
      toDate: parseDate(toDate),
      ...(dto.reason ? { reason: dto.reason.trim() } : {}),
      updatedBy: actor.sub,
    });
    this.audit.set({ entityType: 'MealOff', entityId: id });
    return this.mealOffs.findDetail(id, actor.schoolId);
  }

  /**
   * Approve or refuse. **This is where `credit_month` is decided.**
   *
   * The month is the one after the *later* of the last day off and today,
   * so a request approved before the boarder has even gone still lands on
   * the bill after they come back, and one approved three weeks late
   * lands on the next bill rather than on a month already invoiced.
   */
  async decideMealOff(
    id: string,
    dto: DecideMealOffDto,
    actor: AccessTokenPayload,
  ) {
    const cfg = await this.config.load(actor.schoolId);
    const existing = await this.mealOffs.findDetail(id, actor.schoolId);
    if (!existing) throw new NotFoundException(`Meal-off ${id} not found`);
    if (existing.status !== MealOffStatus.PENDING) {
      throw new ConflictException(
        `That request has already been ${existing.status.toLowerCase()}.`,
      );
    }

    const lastDay = isoDate(existing.toDate);
    const decidedOn = dhakaToday();
    const anchor = lastDay > decidedOn ? lastDay : decidedOn;
    const creditMonth = firstOfMonth(nextMonth(monthOf(anchor)));

    await this.mealOffs.update(id, {
      status: dto.approve ? MealOffStatus.APPROVED : MealOffStatus.REJECTED,
      approvedBy: actor.sub,
      approvedAt: new Date(),
      decisionNote: dto.note?.trim() || null,
      creditMonth: dto.approve ? parseDate(creditMonth) : null,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'MealOff',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: {
        status: dto.approve ? MealOffStatus.APPROVED : MealOffStatus.REJECTED,
        ...(dto.approve ? { creditMonth } : {}),
        note: dto.note,
      },
    });

    const decided = await this.mealOffs.findDetail(id, actor.schoolId);
    if (decided) await this.notifications.announceMealOffDecision(decided, cfg);
    return decided;
  }

  /**
   * A boarder withdrawing their own request. CANCELLED rather than
   * REJECTED, because a family that changed its plans is not a school
   * that refused — the M21 leave rule, and collapsing the two would make
   * the mess manager's refusal rate a lie.
   */
  async cancelMealOff(id: string, actor: AccessTokenPayload) {
    const existing = await this.mealOffs.findDetail(id, actor.schoolId);
    if (!existing) throw new NotFoundException(`Meal-off ${id} not found`);
    if (existing.status !== MealOffStatus.PENDING) {
      throw new ConflictException(
        `Only a pending request can be withdrawn — this one is ${existing.status.toLowerCase()}.`,
      );
    }

    await this.mealOffs.update(id, {
      status: MealOffStatus.CANCELLED,
      updatedBy: actor.sub,
    });
    this.audit.set({
      entityType: 'MealOff',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: { status: MealOffStatus.CANCELLED },
    });
    return this.mealOffs.findDetail(id, actor.schoolId);
  }

  // ── internals ───────────────────────────────────────────────────────

  /**
   * A second claim over days already claimed would be credited twice, and
   * the duplicate looks exactly like a legitimate request. REJECTED and
   * CANCELLED rows release their dates.
   */
  private async assertNoOverlap(
    allocationId: string,
    fromDate: string,
    toDate: string,
    excludeId?: string,
  ): Promise<void> {
    const live = await this.mealOffs.findLiveInRange(allocationId, excludeId);
    const candidate = {
      fromDate: fromDate.slice(0, 10),
      toDate: toDate.slice(0, 10),
    };

    for (const row of live) {
      if (!isLiveMealOff(row.status)) continue;
      if (
        rangesOverlap(candidate, {
          fromDate: isoDate(row.fromDate),
          toDate: isoDate(row.toDate),
        })
      ) {
        throw new ConflictException(
          `Those dates overlap a ${row.status.toLowerCase()} meal-off from ${isoDate(row.fromDate)} to ${isoDate(row.toDate)}.`,
        );
      }
    }
  }
}

function today(): Date {
  return parseDate(dhakaToday());
}
