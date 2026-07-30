import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AcademicSession,
  AttendancePersonType,
  LeaveApplication,
  LeaveStatus,
  LeaveType,
  Prisma,
} from '@prisma/client';
import { HolidayAppliesTo, UserType } from '../../../common/constants';
import { isoDate, parseDate } from '../../academic/calendar/date.util';
import { CalendarService } from '../../academic/services/calendar.service';
import { AcademicSessionsRepository } from '../../academic/repositories/academic-sessions.repository';
import { SessionsService } from '../../academic/services/sessions.service';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { PermissionsService } from '../../rbac/services/permissions.service';
import {
  BalanceFacts,
  availableDays,
  leaveDays,
  overlappingRanges,
  quotaVerdict,
  remainingDays,
} from '../calc/leave.engine';
import {
  CreateLeaveDto,
  LeaveDecisionDto,
  LeaveQueryDto,
  UpdateLeaveDto,
} from '../dto';
import { HR_EVENTS, LeaveApprovedEvent } from '../events/hr.events';
import {
  LeaveApplicationWithType,
  LeaveApplicationsRepository,
  LeaveBalancesRepository,
  LeaveTypesRepository,
} from '../repositories/leave.repository';
import {
  Employee,
  EmployeesRepository,
} from '../repositories/employees.repository';
import { HrSettingsService } from './hr-settings.service';

export interface LeaveListItem {
  application: LeaveApplicationWithType;
  employee: Employee | null;
}

/**
 * Leave applications for the whole workforce — the M08 `teacher_leaves`
 * successor (roadmap M21 §3: "supersedes Module 08 interim table").
 *
 * Three rules distinguish it from what it replaces:
 *
 *   1. **It counts working days.** A leave spanning a weekend must not
 *      burn quota for days nobody was expected to work, so the M05
 *      calendar decides how much a request costs.
 *   2. **It moves a balance.** Approving decrements `leave_balances.used`
 *      inside the same transaction that flips the status, and cancelling
 *      an approved leave gives the days back — otherwise a school's quota
 *      accounting drifts one withdrawal at a time.
 *   3. **It covers staff.** The approval event carries a `personType`, so
 *      an office assistant's approved leave marks their attendance the
 *      same way a teacher's always has.
 */
@Injectable()
export class LeaveService {
  constructor(
    private readonly applications: LeaveApplicationsRepository,
    private readonly balances: LeaveBalancesRepository,
    private readonly types: LeaveTypesRepository,
    private readonly employees: EmployeesRepository,
    private readonly calendar: CalendarService,
    private readonly sessions: SessionsService,
    private readonly sessionRows: AcademicSessionsRepository,
    private readonly config: HrSettingsService,
    private readonly permissions: PermissionsService,
    private readonly auditContext: AuditContextService,
    private readonly events: EventEmitter2,
  ) {}

  // ── read ────────────────────────────────────────────────────────────

  async list(
    query: LeaveQueryDto,
    schoolId: string,
  ): Promise<{
    rows: LeaveListItem[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { rows, total } = await this.applications.findMany(
      schoolId,
      {
        personType: query.personType,
        personId: query.personId,
        leaveTypeId: query.leaveTypeId,
        status: query.status,
        from: query.from ? parseDate(query.from) : undefined,
        to: query.to ? parseDate(query.to) : undefined,
      },
      page,
      limit,
    );

    const people = await this.employees.findManyByKeys(
      schoolId,
      rows.map((row) => ({
        personType: row.personType,
        personId: row.personId,
      })),
    );
    const byKey = new Map(
      people.map((person) => [
        `${person.personType}:${person.personId}`,
        person,
      ]),
    );

    return {
      rows: rows.map((application) => ({
        application,
        employee:
          byKey.get(`${application.personType}:${application.personId}`) ??
          null,
      })),
      total,
      page,
      limit,
    };
  }

  async getDetail(
    id: string,
    schoolId: string,
  ): Promise<LeaveApplicationWithType> {
    const application = await this.applications.findDetail(id, schoolId);
    if (!application) {
      throw new NotFoundException(`Leave application ${id} not found`);
    }
    return application;
  }

  /**
   * An employee's balances for a session, with the derived figures the
   * apply form shows. Types the employee has no row for are returned with
   * a zero allocation rather than omitted — "you have no casual leave
   * left" and "casual leave was never allocated to you" look identical on
   * a form that simply drops the line.
   */
  async balancesFor(
    schoolId: string,
    personType: AttendancePersonType,
    personId: string,
    sessionId?: string,
  ): Promise<
    Array<{
      leaveType: LeaveType;
      allocated: number;
      used: number;
      carried: number;
      available: number;
    }>
  > {
    const session = await this.resolveSession(schoolId, sessionId);
    const [rows, allTypes] = await Promise.all([
      this.balances.findForPerson(schoolId, session.id, personType, personId),
      this.types.findAllForSchool(schoolId, { activeOnly: true }),
    ]);

    const byType = new Map(rows.map((row) => [row.leaveTypeId, row]));
    return allTypes
      .filter((type) => appliesTo(type, personType))
      .map((type) => {
        const row = byType.get(type.id);
        const facts: BalanceFacts = {
          allocated: Number(row?.allocated ?? 0),
          used: Number(row?.used ?? 0),
          carried: Number(row?.carried ?? 0),
        };
        return {
          leaveType: type,
          ...facts,
          available: availableDays(facts),
        };
      });
  }

  // ── write ───────────────────────────────────────────────────────────

  async create(
    dto: CreateLeaveDto,
    actor: AccessTokenPayload,
  ): Promise<LeaveApplicationWithType> {
    const schoolId = actor.schoolId;
    const employee = await this.requireEmployee(
      schoolId,
      dto.personType,
      dto.personId,
    );
    const type = await this.requireType(
      schoolId,
      dto.leaveTypeId,
      dto.personType,
    );
    const { from, to, session, days } = await this.resolveRange(
      schoolId,
      dto.fromDate,
      dto.toDate,
      dto.halfDay ?? false,
    );

    await this.assertNoOverlap(
      schoolId,
      dto.personType,
      dto.personId,
      from,
      to,
    );

    const created = await this.applications.create({
      schoolId,
      personType: dto.personType,
      personId: dto.personId,
      leaveTypeId: type.id,
      sessionId: session.id,
      fromDate: from,
      toDate: to,
      halfDay: dto.halfDay ?? false,
      days,
      reason: dto.reason.trim(),
      attachmentUrl: dto.attachmentUrl?.trim() || null,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'LeaveApplication',
      entityId: created.id,
      newValues: {
        employee: employee.name,
        leaveType: type.name,
        fromDate: dto.fromDate,
        toDate: dto.toDate,
        days,
      },
    });

    return this.getDetail(created.id, schoolId);
  }

  async update(
    id: string,
    dto: UpdateLeaveDto,
    actor: AccessTokenPayload,
  ): Promise<LeaveApplicationWithType> {
    const schoolId = actor.schoolId;
    const existing = await this.getPending(id, schoolId, 'edited');

    const type = dto.leaveTypeId
      ? await this.requireType(schoolId, dto.leaveTypeId, existing.personType)
      : existing.leaveType;
    const halfDay = dto.halfDay ?? existing.halfDay;
    const { from, to, session, days } = await this.resolveRange(
      schoolId,
      dto.fromDate ?? isoDate(existing.fromDate),
      dto.toDate ?? isoDate(existing.toDate),
      halfDay,
    );

    await this.assertNoOverlap(
      schoolId,
      existing.personType,
      existing.personId,
      from,
      to,
      id,
    );

    const data: Prisma.LeaveApplicationUncheckedUpdateInput = {
      leaveTypeId: type.id,
      sessionId: session.id,
      fromDate: from,
      toDate: to,
      halfDay,
      days,
      ...(dto.reason !== undefined ? { reason: dto.reason.trim() } : {}),
      ...(dto.attachmentUrl !== undefined
        ? { attachmentUrl: dto.attachmentUrl?.trim() || null }
        : {}),
      updatedBy: actor.sub,
    };

    await this.applications.update(id, data);
    this.auditContext.set({
      entityType: 'LeaveApplication',
      entityId: id,
      oldValues: snapshot(existing),
      newValues: { fromDate: isoDate(from), toDate: isoDate(to), days },
    });
    return this.getDetail(id, schoolId);
  }

  /**
   * Approve — the only path that moves a balance.
   *
   * The quota check and the `used` increment happen inside one
   * transaction with the status flip, so an approval either consumes
   * quota or does not happen. Approving past the balance is possible but
   * needs `leave.approve.override` (a runtime permission check, the M08
   * assignment-override convention: one route serves both cases and only
   * the elevated branch asks for the extra code).
   */
  async approve(
    id: string,
    dto: LeaveDecisionDto,
    actor: AccessTokenPayload,
  ): Promise<LeaveApplicationWithType> {
    const schoolId = actor.schoolId;
    const existing = await this.getPending(id, schoolId, 'approved');
    const config = await this.config.load(schoolId);
    const days = Number(existing.days);

    // Re-checked at approval, not only at filing: another leave may have
    // been approved for the same person while this one waited (the M13
    // publish-re-runs-the-engine rule).
    await this.assertNoOverlap(
      schoolId,
      existing.personType,
      existing.personId,
      existing.fromDate,
      existing.toDate,
      id,
      [LeaveStatus.APPROVED],
    );

    const session = await this.resolveSession(
      schoolId,
      existing.sessionId ?? undefined,
    );
    const balance = await this.balances.findOneFor(
      schoolId,
      session.id,
      existing.personType,
      existing.personId,
      existing.leaveTypeId,
    );
    const facts: BalanceFacts = {
      allocated: Number(balance?.allocated ?? 0),
      used: Number(balance?.used ?? 0),
      carried: Number(balance?.carried ?? 0),
    };
    const verdict = quotaVerdict(days, facts, {
      // An unpaid type has no entitlement to overdraw — the days come out
      // of pay instead, which is a payroll matter, not a quota one.
      unlimited: !existing.leaveType.isPaid,
    });

    if (verdict.exceeded && config.leaveRequiresBalance) {
      if (!dto.override) {
        throw new ConflictException(
          `${existing.leaveType.name}: ${days} day(s) requested but only ${verdict.remaining} left — approve with override to allow it`,
        );
      }
      await this.assertPermission(
        actor,
        'leave.approve.override',
        `Approving ${verdict.shortfall} day(s) beyond the balance requires leave.approve.override`,
      );
    }

    const approvedAt = new Date();
    await this.applications.withTransaction(async (tx) => {
      const row = await this.balances.upsertBalance(
        {
          schoolId,
          sessionId: session.id,
          personType: existing.personType,
          personId: existing.personId,
          leaveTypeId: existing.leaveTypeId,
        },
        {},
        actor.sub,
        tx,
      );
      await this.balances.addUsed(row.id, days, tx);
      await this.applications.update(
        id,
        {
          status: LeaveStatus.APPROVED,
          approvedBy: actor.sub,
          approvedAt,
          sessionId: session.id,
          decisionNote: dto.note?.trim() || null,
          approverChain: appendApprover(
            existing,
            actor,
            'APPROVED',
            approvedAt,
          ),
          updatedBy: actor.sub,
        },
        tx,
      );
    });

    // M12 subscribes and marks those days LEAVE in `staff_attendances`.
    // Emitted AFTER the transaction: a listener that reads the row must
    // find it committed (the M08 → M12 pattern).
    this.events.emit(HR_EVENTS.LEAVE_APPROVED, {
      leaveId: id,
      schoolId,
      personType: existing.personType,
      personId: existing.personId,
      fromDate: isoDate(existing.fromDate),
      toDate: isoDate(existing.toDate),
      leaveTypeName: existing.leaveType.name,
      isPaid: existing.leaveType.isPaid,
    } satisfies LeaveApprovedEvent);

    this.auditContext.set({
      entityType: 'LeaveApplication',
      entityId: id,
      oldValues: { status: LeaveStatus.PENDING },
      newValues: {
        status: LeaveStatus.APPROVED,
        days,
        override: verdict.exceeded ? true : undefined,
      },
    });

    return this.getDetail(id, schoolId);
  }

  async reject(
    id: string,
    dto: LeaveDecisionDto,
    actor: AccessTokenPayload,
  ): Promise<LeaveApplicationWithType> {
    const schoolId = actor.schoolId;
    const existing = await this.getPending(id, schoolId, 'rejected');
    const decidedAt = new Date();

    await this.applications.update(id, {
      status: LeaveStatus.REJECTED,
      approvedBy: actor.sub,
      approvedAt: decidedAt,
      decisionNote: dto.note?.trim() || null,
      approverChain: appendApprover(existing, actor, 'REJECTED', decidedAt),
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'LeaveApplication',
      entityId: id,
      oldValues: { status: LeaveStatus.PENDING },
      newValues: { status: LeaveStatus.REJECTED, note: dto.note },
    });
    return this.getDetail(id, schoolId);
  }

  /**
   * Cancel — and hand the days back.
   *
   * A withdrawn leave is not a refused one (which is why M21 added
   * CANCELLED to the status enum), and the difference matters to the
   * balance: rejecting never consumed quota, cancelling an APPROVED leave
   * has to release what it took. Forgetting that is how a school's leave
   * accounting drifts one withdrawal at a time.
   */
  async cancel(
    id: string,
    dto: LeaveDecisionDto,
    actor: AccessTokenPayload,
  ): Promise<LeaveApplicationWithType> {
    const schoolId = actor.schoolId;
    const existing = await this.getDetail(id, schoolId);

    if (
      existing.status === LeaveStatus.CANCELLED ||
      existing.status === LeaveStatus.REJECTED
    ) {
      throw new ConflictException(
        `This application is already ${existing.status.toLowerCase()}`,
      );
    }

    const wasApproved = existing.status === LeaveStatus.APPROVED;
    const days = Number(existing.days);

    await this.applications.withTransaction(async (tx) => {
      if (wasApproved && existing.sessionId) {
        const balance = await this.balances.findOneFor(
          schoolId,
          existing.sessionId,
          existing.personType,
          existing.personId,
          existing.leaveTypeId,
          tx,
        );
        if (balance) await this.balances.addUsed(balance.id, -days, tx);
      }
      await this.applications.update(
        id,
        {
          status: LeaveStatus.CANCELLED,
          decisionNote: dto.note?.trim() || null,
          updatedBy: actor.sub,
        },
        tx,
      );
    });

    this.auditContext.set({
      entityType: 'LeaveApplication',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: {
        status: LeaveStatus.CANCELLED,
        daysReturned: wasApproved ? days : 0,
      },
    });
    return this.getDetail(id, schoolId);
  }

  /** Remove a PENDING application outright (nothing has happened yet). */
  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.getPending(id, actor.schoolId, 'deleted');
    await this.applications.softDelete(id);
    this.auditContext.set({
      entityType: 'LeaveApplication',
      entityId: id,
      oldValues: snapshot(existing),
    });
  }

  // ── internals ───────────────────────────────────────────────────────

  private async getPending(
    id: string,
    schoolId: string,
    verb: string,
  ): Promise<LeaveApplicationWithType> {
    const application = await this.getDetail(id, schoolId);
    if (application.status !== LeaveStatus.PENDING) {
      throw new ConflictException(
        `Only PENDING applications can be ${verb} — this one is ${application.status}`,
      );
    }
    return application;
  }

  private async requireEmployee(
    schoolId: string,
    personType: AttendancePersonType,
    personId: string,
  ): Promise<Employee> {
    const employee = await this.employees.findOne(
      schoolId,
      personType,
      personId,
    );
    if (!employee) {
      throw new NotFoundException(
        `No ${personType.toLowerCase()} found for ${personId}`,
      );
    }
    return employee;
  }

  private async requireType(
    schoolId: string,
    leaveTypeId: string,
    personType: AttendancePersonType,
  ): Promise<LeaveType> {
    const type = await this.types.findById(leaveTypeId, schoolId);
    if (!type) {
      throw new NotFoundException(`Leave type ${leaveTypeId} not found`);
    }
    if (!type.isActive) {
      throw new ConflictException(`${type.name} is no longer offered`);
    }
    if (!appliesTo(type, personType)) {
      throw new ConflictException(
        `${type.name} is offered to ${type.applicableTo} only`,
      );
    }
    return type;
  }

  /**
   * Resolve a request's range: strict dates, the session it falls in, and
   * how many WORKING days it actually costs.
   */
  private async resolveRange(
    schoolId: string,
    fromDate: string,
    toDate: string,
    halfDay: boolean,
  ): Promise<{ from: Date; to: Date; session: AcademicSession; days: number }> {
    const from = parseDate(fromDate);
    const to = parseDate(toDate);
    if (from.getTime() > to.getTime()) {
      throw new BadRequestException('fromDate must be on or before toDate');
    }
    if (halfDay && from.getTime() !== to.getTime()) {
      throw new BadRequestException(
        'A half-day leave covers exactly one date — half of a fortnight is not a half day',
      );
    }

    const session = await this.sessionCovering(schoolId, from, to);
    const workingDays = await this.calendar.workingDays(
      schoolId,
      from,
      to,
      HolidayAppliesTo.STAFF,
    );
    const days = leaveDays({ workingDays, halfDay });

    if (days <= 0) {
      throw new ConflictException(
        `${fromDate} – ${toDate} contains no working day — there is nothing to take leave from`,
      );
    }
    return { from, to, session, days };
  }

  /**
   * The session a leave belongs to — **the one that covers its dates**,
   * not simply the current one.
   *
   * M08 pinned every leave to the current session, which was fine while
   * leave was a note on a teacher's record. M21 makes it consume a
   * per-session balance, and then the current session is the wrong
   * answer twice over: a leave taken in the last weeks of an outgoing
   * session (before the head activates the new one) would be refused
   * outright, and a leave dated into the next session would silently
   * consume this session's quota.
   *
   * The current session still wins when it covers the range, so the
   * ordinary case is unchanged.
   */
  private async sessionCovering(
    schoolId: string,
    from: Date,
    to: Date,
  ): Promise<AcademicSession> {
    const covers = (session: AcademicSession): boolean =>
      from.getTime() >= session.startDate.getTime() &&
      to.getTime() <= session.endDate.getTime();

    const current = await this.sessions.getCurrent(schoolId);
    if (current && covers(current)) return current;

    const all = await this.sessionRows.findAll({}, schoolId);
    const covering = all.filter(covers);
    if (covering.length > 0) {
      // Deterministic when two sessions overlap (they should not — M05
      // refuses it — but a corrected date range can leave a window).
      return covering.sort(
        (a, b) => a.startDate.getTime() - b.startDate.getTime(),
      )[0];
    }

    if (!current) {
      throw new BadRequestException(
        'No academic session covers those dates — create one before recording leave there',
      );
    }
    throw new BadRequestException(
      `${isoDate(from)} – ${isoDate(to)} falls outside every academic session (the current one runs ${isoDate(current.startDate)} – ${isoDate(current.endDate)})`,
    );
  }

  private async resolveSession(
    schoolId: string,
    sessionId?: string,
  ): Promise<AcademicSession> {
    if (sessionId) return this.sessions.getById(sessionId, schoolId);
    const current = await this.sessions.getCurrent(schoolId);
    if (!current) {
      throw new BadRequestException('No current academic session');
    }
    return current;
  }

  private async assertNoOverlap(
    schoolId: string,
    personType: AttendancePersonType,
    personId: string,
    from: Date,
    to: Date,
    excludeId?: string,
    statuses: LeaveStatus[] = [LeaveStatus.PENDING, LeaveStatus.APPROVED],
  ): Promise<void> {
    const existing = await this.applications.findOverlapping(
      schoolId,
      personType,
      personId,
      from,
      to,
      statuses,
    );
    const clashes = overlappingRanges(
      { from: isoDate(from), to: isoDate(to) },
      existing.map((row) => ({
        id: row.id,
        from: isoDate(row.fromDate),
        to: isoDate(row.toDate),
      })),
      excludeId,
    );
    if (clashes.length > 0) {
      throw new ConflictException({
        message: `This range overlaps ${clashes.length} existing leave application(s) for the same person`,
        details: { conflicts: clashes },
      });
    }
  }

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

/** ALL matches everybody; otherwise the audience must be the person's. */
export function appliesTo(
  type: Pick<LeaveType, 'applicableTo'>,
  personType: AttendancePersonType,
): boolean {
  return (
    type.applicableTo === 'ALL' || String(type.applicableTo) === personType
  );
}

/**
 * Append this decision to the approver chain (roadmap §3). One entry
 * today; the column is a JSON array so a multi-step chain — head of
 * department, then principal — needs no migration.
 */
function appendApprover(
  application: LeaveApplication,
  actor: AccessTokenPayload,
  decision: 'APPROVED' | 'REJECTED',
  at: Date,
): Prisma.InputJsonValue {
  const chain = Array.isArray(application.approverChain)
    ? (application.approverChain as unknown[])
    : [];
  return [
    ...chain,
    { userId: actor.sub, decision, at: at.toISOString() },
  ] as Prisma.InputJsonValue;
}

function snapshot(application: LeaveApplication) {
  return {
    personType: application.personType,
    personId: application.personId,
    fromDate: isoDate(application.fromDate),
    toDate: isoDate(application.toDate),
    days: Number(application.days),
    status: application.status,
    reason: application.reason,
  };
}

/** Re-exported for the balance service, which shares the shape. */
export { remainingDays };
