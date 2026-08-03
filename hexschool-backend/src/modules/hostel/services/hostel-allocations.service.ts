import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EnrollmentStatus,
  HostelAllocationStatus,
  UserType,
} from '../../../common/constants';
import { dhakaToday } from '../../../common/utils/clock.util';
import { isoDate, parseDate } from '../../academic/calendar/date.util';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { EnrollmentsRepository } from '../../enrollment/repositories/enrollments.repository';
import { LedgerService } from '../../fee/services/ledger.service';
import { PermissionsService } from '../../rbac/services/permissions.service';
import { checkClearance, computeRefund } from '../calc/deposit.engine';
import { canAllocate, type AllocationVerdict } from '../calc/occupancy.engine';
// No `as StudentGender` cast is needed on `enrollment.student.gender`:
// `eslint --fix` removed every one of them as unnecessary, which is proof
// that `calc/types.ts`'s hand-written union matches `gender_enum` exactly
// rather than a nuisance (the M24 lesson).
import type {
  AllocationQueryDto,
  BulkAllocateDto,
  CreateAllocationDto,
  RefundDepositDto,
  ResumeAllocationDto,
  SuspendAllocationDto,
  TransferAllocationDto,
  UpdateAllocationDto,
  VacateAllocationDto,
} from '../dto';
import {
  HostelAllocationsRepository,
  type AllocationWithRelations,
} from '../repositories/hostel-allocations.repository';
import {
  HostelBedsRepository,
  HostelsRepository,
} from '../repositories/hostels.repository';
import {
  MealOffsRepository,
  MessEnrollmentsRepository,
  MessPlansRepository,
} from '../repositories/mess.repository';
import { HostelNotificationsService } from './hostel-notifications.service';
import { HostelPostingService } from './hostel-posting.service';
import { HostelSettingsService } from './hostel-settings.service';

export interface AllocationResult {
  allocation: AllocationWithRelations;
  warnings: string[];
}

export interface BulkAllocateResult {
  allocated: number;
  skipped: Array<{ enrollmentId: string; reason: string }>;
  warnings: string[];
}

/**
 * Boarders: who sleeps where, from when, and what happens to their
 * deposit when they leave.
 *
 * **The one rule everything else hangs off:** an allocation is a
 * residency *window*, not a flag. Suspending stamps a date, resuming
 * stamps another, vacating stamps a third, and M16 reads those columns to
 * decide what a family owes. A status change with no date cannot answer
 * "how much of March does this boarder owe" — the M21 `exit_date` lesson,
 * which M25 applied to a bus seat and this applies to a bed.
 *
 * **The two-tier refusal split** (M13/M14/M23/M25) lives in
 * `occupancy.engine.ts` and is called from exactly one place here, so the
 * greyed-out chip on the occupancy grid, the 409 and the transfer
 * wizard's blocked reason are three renderings of one verdict.
 */
@Injectable()
export class HostelAllocationsService {
  private readonly logger = new Logger(HostelAllocationsService.name);

  constructor(
    private readonly allocations: HostelAllocationsRepository,
    private readonly hostels: HostelsRepository,
    private readonly beds: HostelBedsRepository,
    private readonly messPlans: MessPlansRepository,
    private readonly messEnrollments: MessEnrollmentsRepository,
    private readonly mealOffs: MealOffsRepository,
    private readonly enrollments: EnrollmentsRepository,
    private readonly ledger: LedgerService,
    private readonly permissions: PermissionsService,
    private readonly config: HostelSettingsService,
    private readonly notifications: HostelNotificationsService,
    private readonly posting: HostelPostingService,
    private readonly audit: AuditContextService,
  ) {}

  // ── reads ───────────────────────────────────────────────────────────

  async list(query: AllocationQueryDto, actor: AccessTokenPayload) {
    const { rows, total } = await this.allocations.findMany(
      actor.schoolId,
      query,
      query.page,
      query.limit,
    );
    return {
      data: rows,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async get(
    id: string,
    actor: AccessTokenPayload,
  ): Promise<AllocationWithRelations> {
    const allocation = await this.allocations.findDetail(id, actor.schoolId);
    if (!allocation) {
      throw new NotFoundException(`Hostel allocation ${id} not found`);
    }
    return allocation;
  }

  /** For the student profile: the live allocation, or `null`. */
  async forStudent(
    studentId: string,
    schoolId: string,
    sessionId?: string,
  ): Promise<AllocationWithRelations | null> {
    return this.allocations.findForStudent(schoolId, studentId, sessionId);
  }

  // ── allocate ────────────────────────────────────────────────────────

  async create(
    dto: CreateAllocationDto,
    actor: AccessTokenPayload,
  ): Promise<AllocationResult> {
    const cfg = await this.config.load(actor.schoolId);
    this.assertEnabled(cfg.enabled);

    const enrollment = await this.enrollments.findDetail(
      dto.enrollmentId,
      actor.schoolId,
    );
    if (!enrollment) {
      throw new NotFoundException(`Enrollment ${dto.enrollmentId} not found`);
    }
    if (enrollment.status !== EnrollmentStatus.ACTIVE) {
      throw new ConflictException(
        `That enrollment is ${enrollment.status} — only an active student can be given a bed.`,
      );
    }

    const bed = await this.beds.findDetail(dto.bedId, actor.schoolId);
    if (!bed) throw new NotFoundException(`Bed ${dto.bedId} not found`);

    const holder = await this.allocations.findLiveForBed(dto.bedId);
    const resident = await this.allocations.findLive(dto.enrollmentId);
    const override =
      dto.override === true ? await this.hasOverride(actor) : false;
    if (dto.override === true && !override) {
      throw new ForbiddenException(
        'That allocation needs hostel.allocate.override.',
      );
    }

    const verdict = canAllocate({
      bedStatus: bed.status,
      bedHeld: holder !== null,
      roomStatus: bed.room.status,
      hostelActive: bed.hostel.status === 'ACTIVE',
      hostelType: bed.hostel.type,
      studentGender: enrollment.student.gender,
      alreadyResident: resident !== null,
      override,
    });
    this.assertVerdict(verdict);

    const startDate = dto.startDate ? parseDate(dto.startDate) : today();
    const deposit = dto.securityDeposit ?? cfg.defaultSecurityDeposit;

    // The allocation, the bed's shadow and the optional mess enrolment
    // commit together. A bed left VACANT beside a live allocation would
    // make the occupancy grid offer it to the next student, and the
    // partial unique would then refuse a write the UI had promised.
    const created = await this.allocations.withTransaction(async (tx) => {
      const row = await this.allocations.create(
        {
          schoolId: actor.schoolId,
          enrollmentId: dto.enrollmentId,
          hostelId: bed.hostelId,
          bedId: bed.id,
          startDate,
          status: HostelAllocationStatus.ACTIVE,
          securityDeposit: deposit,
          remarks: dto.remarks?.trim() || null,
          createdBy: actor.sub,
          updatedBy: actor.sub,
        },
        tx,
      );
      await this.beds.setOccupancyShadow(bed.id, true, tx);

      if (dto.messPlanId) {
        const plan = await tx.messPlan.findFirst({
          where: {
            id: dto.messPlanId,
            schoolId: actor.schoolId,
            deletedAt: null,
          },
        });
        if (!plan) {
          throw new NotFoundException(`Mess plan ${dto.messPlanId} not found`);
        }
        // The composite FK would refuse a plan from another building
        // anyway — this says *why* rather than surfacing a constraint
        // name to a duty clerk.
        if (plan.hostelId !== bed.hostelId) {
          throw new BadRequestException(
            `"${plan.name}" is a mess plan of a different hostel.`,
          );
        }
        await tx.messEnrollment.create({
          data: {
            schoolId: actor.schoolId,
            hostelId: bed.hostelId,
            allocationId: row.id,
            planId: plan.id,
            startDate,
            createdBy: actor.sub,
            updatedBy: actor.sub,
          },
        });
      }
      return row;
    });

    this.audit.set({
      entityType: 'HostelAllocation',
      entityId: created.id,
      newValues: {
        enrollmentId: dto.enrollmentId,
        hostel: bed.hostel.name,
        room: bed.room.roomNo,
        bed: bed.bedNo,
        startDate: isoDate(startDate),
        securityDeposit: deposit,
        ...(verdict.warn ? { override: verdict.reason } : {}),
      },
    });

    if (cfg.autoPostAccounting && deposit > 0) {
      const voucherId = await this.posting.postDepositTaken({
        schoolId: actor.schoolId,
        allocationId: created.id,
        studentName: studentName(enrollment),
        amount: deposit,
        date: startDate,
        actorId: actor.sub,
      });
      if (voucherId) {
        await this.allocations.update(created.id, {
          depositVoucherId: voucherId,
        });
      }
    }

    const allocation = await this.get(created.id, actor);
    if (cfg.notifyGuardianOnAllocation) {
      await this.notifications.announceAllocation(allocation, cfg);
    }
    return { allocation, warnings: warningsFrom(verdict) };
  }

  /**
   * Fill a hostel from a list of students — the roadmap §5 bulk path.
   *
   * Beds are taken in room-and-bed order, so a section allocated together
   * lands together, which is what a warden actually wants. A student who
   * cannot be placed is **reported, never silently skipped onto some
   * other floor**: the office asked for a specific building and needs to
   * know it ran out.
   */
  async bulkAllocate(
    dto: BulkAllocateDto,
    actor: AccessTokenPayload,
  ): Promise<BulkAllocateResult> {
    const cfg = await this.config.load(actor.schoolId);
    this.assertEnabled(cfg.enabled);

    const hostel = await this.hostels.findDetail(dto.hostelId, actor.schoolId);
    if (!hostel)
      throw new NotFoundException(`Hostel ${dto.hostelId} not found`);

    const override =
      dto.override === true ? await this.hasOverride(actor) : false;
    if (dto.override === true && !override) {
      throw new ForbiddenException(
        'That allocation needs hostel.allocate.override.',
      );
    }

    const beds = await this.hostels.bedsWithHolders(
      actor.schoolId,
      dto.hostelId,
    );
    const free = beds.filter((bed) => !bed.held && bed.status === 'VACANT');

    const skipped: BulkAllocateResult['skipped'] = [];
    const warnings: string[] = [];
    const startDate = dto.startDate ? parseDate(dto.startDate) : today();
    const deposit = dto.securityDeposit ?? cfg.defaultSecurityDeposit;
    let allocated = 0;

    for (const enrollmentId of dto.enrollmentIds) {
      const enrollment = await this.enrollments.findDetail(
        enrollmentId,
        actor.schoolId,
      );
      if (!enrollment) {
        skipped.push({ enrollmentId, reason: 'Enrollment not found' });
        continue;
      }
      if (enrollment.status !== EnrollmentStatus.ACTIVE) {
        skipped.push({
          enrollmentId,
          reason: `Enrollment is ${enrollment.status}`,
        });
        continue;
      }
      if (await this.allocations.findLive(enrollmentId)) {
        skipped.push({ enrollmentId, reason: 'Already has a bed' });
        continue;
      }

      const gender = enrollment.student.gender;
      const verdict = canAllocate({
        bedStatus: 'VACANT',
        bedHeld: false,
        roomStatus: 'ACTIVE',
        hostelActive: hostel.status === 'ACTIVE',
        hostelType: hostel.type,
        studentGender: gender,
        alreadyResident: false,
        override,
      });
      if (!verdict.allowed) {
        skipped.push({ enrollmentId, reason: verdict.reason ?? 'Refused' });
        continue;
      }
      if (verdict.warn && verdict.reason) warnings.push(verdict.reason);

      const bed = free.shift();
      if (!bed) {
        skipped.push({
          enrollmentId,
          reason: `"${hostel.name}" has no free beds left`,
        });
        continue;
      }

      await this.allocations.withTransaction(async (tx) => {
        await this.allocations.create(
          {
            schoolId: actor.schoolId,
            enrollmentId,
            hostelId: dto.hostelId,
            bedId: bed.id,
            startDate,
            status: HostelAllocationStatus.ACTIVE,
            securityDeposit: deposit,
            createdBy: actor.sub,
            updatedBy: actor.sub,
          },
          tx,
        );
        await this.beds.setOccupancyShadow(bed.id, true, tx);
      });
      allocated++;
    }

    this.audit.set({
      entityType: 'HostelAllocation',
      entityId: dto.hostelId,
      newValues: {
        action: 'BULK_ALLOCATE',
        hostel: hostel.name,
        allocated,
        skipped: skipped.length,
      },
    });

    return { allocated, skipped, warnings: [...new Set(warnings)] };
  }

  async update(
    id: string,
    dto: UpdateAllocationDto,
    actor: AccessTokenPayload,
  ) {
    const existing = await this.get(id, actor);
    if (existing.status === HostelAllocationStatus.VACATED) {
      throw new ConflictException(
        'That boarder has left — allocate a new bed rather than editing history.',
      );
    }
    await this.allocations.update(id, {
      remarks: dto.remarks?.trim() || null,
      updatedBy: actor.sub,
    });
    this.audit.set({ entityType: 'HostelAllocation', entityId: id });
    return this.get(id, actor);
  }

  /**
   * Roadmap §4's "transfer bed/room" — and roadmap §8's answer to a room
   * going under maintenance with people in it.
   *
   * **The residency is not restarted.** The boarder has been here since
   * March; moving them from B2 to B5 does not make them a new arrival,
   * and restarting the window would re-bill them for the month. The bed
   * changes, the dates do not — which is also why a transfer between
   * hostels is refused: the mess enrolment is pinned to the building by a
   * composite FK, and moving the bed without the plan would leave a
   * boarder eating on another hostel's kitchen.
   */
  async transfer(
    id: string,
    dto: TransferAllocationDto,
    actor: AccessTokenPayload,
  ): Promise<AllocationResult> {
    const cfg = await this.config.load(actor.schoolId);
    const existing = await this.get(id, actor);
    if (existing.status === HostelAllocationStatus.VACATED) {
      throw new ConflictException('That boarder has already left.');
    }
    if (existing.bedId === dto.bedId) {
      throw new BadRequestException('That is the bed they are already in.');
    }

    const bed = await this.beds.findDetail(dto.bedId, actor.schoolId);
    if (!bed) throw new NotFoundException(`Bed ${dto.bedId} not found`);

    if (bed.hostelId !== existing.hostelId) {
      throw new ConflictException(
        `Bed ${bed.bedNo} is in "${bed.hostel.name}", not "${existing.hostel.name}". Vacate this boarder and allocate them into the other building, so their mess plan and deposit move with them.`,
      );
    }

    const holder = await this.allocations.findLiveForBed(dto.bedId);
    const override =
      dto.override === true ? await this.hasOverride(actor) : false;
    if (dto.override === true && !override) {
      throw new ForbiddenException(
        'That transfer needs hostel.allocate.override.',
      );
    }

    const verdict = canAllocate({
      bedStatus: bed.status,
      bedHeld: holder !== null,
      roomStatus: bed.room.status,
      hostelActive: bed.hostel.status === 'ACTIVE',
      hostelType: bed.hostel.type,
      studentGender: existing.enrollment.student.gender,
      // The boarder IS already resident — that is the point of a
      // transfer, so the check is told to expect it.
      alreadyResident: false,
      override,
    });
    this.assertVerdict(verdict);
    void cfg;

    const previousBedId = existing.bedId;
    await this.allocations.withTransaction(async (tx) => {
      await this.allocations.update(
        id,
        { bedId: bed.id, updatedBy: actor.sub },
        tx,
      );
      await this.beds.setOccupancyShadow(previousBedId, false, tx);
      await this.beds.setOccupancyShadow(bed.id, true, tx);
    });

    this.audit.set({
      entityType: 'HostelAllocation',
      entityId: id,
      oldValues: {
        room: existing.bed.room.roomNo,
        bed: existing.bed.bedNo,
      },
      newValues: {
        room: bed.room.roomNo,
        bed: bed.bedNo,
        reason: dto.reason,
      },
    });

    return {
      allocation: await this.get(id, actor),
      warnings: warningsFrom(verdict),
    };
  }

  // ── the lifecycle ───────────────────────────────────────────────────

  async suspend(
    id: string,
    dto: SuspendAllocationDto,
    actor: AccessTokenPayload,
  ) {
    const existing = await this.get(id, actor);
    if (existing.status !== HostelAllocationStatus.ACTIVE) {
      throw new ConflictException(
        `Only an ACTIVE residency can be suspended — this one is ${existing.status}.`,
      );
    }
    const effective = dto.effectiveDate
      ? parseDate(dto.effectiveDate)
      : today();
    if (effective < existing.startDate) {
      throw new BadRequestException(
        'A suspension cannot start before the residency did.',
      );
    }

    // **The bed is NOT released.** That is the whole point of suspending
    // rather than vacating: the boarder has gone home for a term and the
    // school is holding their place. `uq_hostel_allocations_live_bed`
    // agrees — it excludes only VACATED.
    await this.allocations.update(id, {
      status: HostelAllocationStatus.SUSPENDED,
      suspendedAt: effective,
      statusReason: dto.reason.trim(),
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'HostelAllocation',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: {
        status: HostelAllocationStatus.SUSPENDED,
        suspendedAt: isoDate(effective),
        reason: dto.reason,
      },
    });
    return this.get(id, actor);
  }

  async resume(
    id: string,
    dto: ResumeAllocationDto,
    actor: AccessTokenPayload,
  ) {
    const existing = await this.get(id, actor);
    if (existing.status !== HostelAllocationStatus.SUSPENDED) {
      throw new ConflictException(
        `Only a SUSPENDED residency can be resumed — this one is ${existing.status}.`,
      );
    }
    const effective = dto.effectiveDate
      ? parseDate(dto.effectiveDate)
      : today();
    if (existing.suspendedAt && effective < existing.suspendedAt) {
      throw new BadRequestException(
        'A boarder cannot come back before they left.',
      );
    }

    // `suspended_at` is CLEARED and `resumed_at` set: the window is
    // `[resumed_at, ∞)` again, and
    // `chk_hostel_allocations_status_evidence` refuses an ACTIVE row that
    // still carries a suspension.
    await this.allocations.update(id, {
      status: HostelAllocationStatus.ACTIVE,
      suspendedAt: null,
      resumedAt: effective,
      statusReason: null,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'HostelAllocation',
      entityId: id,
      oldValues: {
        status: existing.status,
        suspendedAt: existing.suspendedAt
          ? isoDate(existing.suspendedAt)
          : null,
      },
      newValues: {
        status: HostelAllocationStatus.ACTIVE,
        resumedAt: isoDate(effective),
      },
    });
    return this.get(id, actor);
  }

  /**
   * Roadmap §6's vacate: the dues clearance check, the bed released and
   * the mess enrolment closed — all in one transaction, because a bed
   * freed while the kitchen keeps billing is the worst of the three
   * possible half-states.
   *
   * The deposit is **not** refunded here. Recording money going back is
   * `hostel.deposit.refund`, which the office deliberately does not hold
   * (see the permission registry): the warden records that a boarder has
   * gone, the accountant records that the deposit went with them.
   */
  async vacate(
    id: string,
    dto: VacateAllocationDto,
    actor: AccessTokenPayload,
  ): Promise<AllocationResult> {
    const cfg = await this.config.load(actor.schoolId);
    const existing = await this.get(id, actor);
    if (existing.status === HostelAllocationStatus.VACATED) {
      throw new ConflictException('That boarder has already left.');
    }
    const endDate = dto.endDate ? parseDate(dto.endDate) : today();
    if (endDate < existing.startDate) {
      throw new BadRequestException(
        'A residency cannot end before it started.',
      );
    }

    const override =
      dto.override === true
        ? await this.hasOverride(actor, 'hostel.vacate.override')
        : false;
    if (dto.override === true && !override) {
      throw new ForbiddenException(
        'Releasing a bed over unpaid fees needs hostel.vacate.override.',
      );
    }

    // The single dues source for every gate in the system — the M16 rule
    // (`EXAM_DUES_GATE`, the M09 exit warning, and now this).
    const dues = await this.ledger.outstandingFor(
      [existing.enrollmentId],
      actor.schoolId,
    );
    const pending = await this.mealOffs.countPending(id);

    const clearance = checkClearance({
      outstandingFees: Number(dues.get(existing.enrollmentId) ?? 0),
      pendingMealOffs: pending,
      blockOnDues: cfg.vacateBlockDues,
      override,
    });
    if (!clearance.allowed) {
      throw new ConflictException(clearance.reason ?? 'Clearance failed');
    }

    await this.allocations.withTransaction(async (tx) => {
      await this.allocations.update(
        id,
        {
          status: HostelAllocationStatus.VACATED,
          endDate,
          // A boarder who was suspended and then left, left. The window's
          // upper bound becomes the end date, and leaving the suspension
          // date behind would be a second, contradictory boundary.
          suspendedAt: null,
          statusReason: dto.reason.trim(),
          updatedBy: actor.sub,
        },
        tx,
      );
      await this.beds.setOccupancyShadow(existing.bedId, false, tx);
      // Close the kitchen too. A mess enrolment left open against a
      // vacated allocation would be bounded by the residency window when
      // billing runs (roadmap §8's precedence saves us), but leaving it
      // open would still show the boarder on the mess roster.
      await tx.messEnrollment.updateMany({
        where: { allocationId: id, deletedAt: null, endDate: null },
        data: { endDate, updatedBy: actor.sub },
      });
    });

    this.audit.set({
      entityType: 'HostelAllocation',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: {
        status: HostelAllocationStatus.VACATED,
        endDate: isoDate(endDate),
        reason: dto.reason,
        cleared: clearance.cleared,
      },
    });

    return {
      allocation: await this.get(id, actor),
      warnings: clearance.warnings,
    };
  }

  /**
   * Handing the deposit back, in whole or in part.
   *
   * `chk_hostel_allocations_deposit` refuses this on a boarder who has
   * not left, refuses a refund larger than the deposit, and refuses a
   * `deposit_refunded` flag with no amount and no date behind it — so the
   * three things a "mark as refunded" button could break are pinned at
   * the database rather than remembered here.
   */
  async refundDeposit(
    id: string,
    dto: RefundDepositDto,
    actor: AccessTokenPayload,
  ) {
    const cfg = await this.config.load(actor.schoolId);
    const existing = await this.get(id, actor);

    if (existing.status !== HostelAllocationStatus.VACATED) {
      throw new ConflictException(
        'The deposit secures a bed that is still occupied. Vacate the boarder first.',
      );
    }
    if (existing.depositRefunded) {
      throw new ConflictException(
        'That deposit has already been returned — a correction is an accounting entry, not a second refund.',
      );
    }

    const result = computeRefund({
      securityDeposit: Number(existing.securityDeposit),
      deductions: dto.deductions ?? [],
    });
    if (!result.ok) {
      throw new BadRequestException(result.reason ?? 'Refund refused');
    }

    const refundedAt = dto.refundedAt ? parseDate(dto.refundedAt) : today();
    const note = [
      dto.note?.trim(),
      ...(dto.deductions ?? [])
        .filter((d) => d.amount > 0)
        .map((d) => `${d.reason}: ${d.amount}`),
    ]
      .filter(Boolean)
      .join(' · ');

    await this.allocations.update(id, {
      depositRefunded: true,
      depositRefundAmount: result.refund,
      depositRefundedAt: refundedAt,
      depositRefundNote: note || null,
      updatedBy: actor.sub,
    });

    if (cfg.autoPostAccounting && result.refund > 0) {
      const voucherId = await this.posting.postDepositRefund({
        schoolId: actor.schoolId,
        allocationId: id,
        studentName: studentName(existing.enrollment),
        amount: result.refund,
        date: refundedAt,
        actorId: actor.sub,
      });
      if (voucherId) {
        await this.allocations.update(id, { refundVoucherId: voucherId });
      }
    }

    this.audit.set({
      entityType: 'HostelAllocation',
      entityId: id,
      oldValues: { securityDeposit: Number(existing.securityDeposit) },
      newValues: {
        depositRefunded: true,
        refund: result.refund,
        withheld: result.withheld,
        refundedAt: isoDate(refundedAt),
      },
    });

    return {
      allocation: await this.get(id, actor),
      refund: result.refund,
      withheld: result.withheld,
      warnings: result.reason ? [result.reason] : [],
    };
  }

  // ── internals ───────────────────────────────────────────────────────

  private assertVerdict(verdict: AllocationVerdict): void {
    if (verdict.allowed) return;
    throw new ConflictException(
      verdict.overridable
        ? `${verdict.reason} Ask somebody with hostel.allocate.override to approve it.`
        : (verdict.reason ?? 'That allocation is not possible.'),
    );
  }

  private async hasOverride(
    actor: AccessTokenPayload,
    code = 'hostel.allocate.override',
  ): Promise<boolean> {
    if (actor.userType === UserType.SUPER_ADMIN) return true;
    const codes = await this.permissions.getUserPermissionCodes(actor.sub);
    return codes.includes(code);
  }

  private assertEnabled(enabled: boolean): void {
    if (!enabled) {
      throw new ConflictException(
        'The hostel is switched off for this school (hostel.enabled).',
      );
    }
  }
}

function warningsFrom(verdict: AllocationVerdict): string[] {
  return verdict.warn && verdict.reason ? [verdict.reason] : [];
}

function studentName(enrollment: {
  student: { firstName: string; lastName: string };
}): string {
  return `${enrollment.student.firstName} ${enrollment.student.lastName}`.trim();
}

function today(): Date {
  return parseDate(dhakaToday());
}
