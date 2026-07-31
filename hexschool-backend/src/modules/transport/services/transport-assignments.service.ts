import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  EnrollmentStatus,
  TransportAssignmentStatus,
  UserType,
} from '../../../common/constants';
import { dhakaToday } from '../../../common/utils/clock.util';
import { isoDate, parseDate } from '../../academic/calendar/date.util';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { EnrollmentsRepository } from '../../enrollment/repositories/enrollments.repository';
import { PermissionsService } from '../../rbac/services/permissions.service';
import { capacityVerdict, type CapacityVerdict } from '../calc/capacity.engine';
import type {
  AssignmentQueryDto,
  BulkAssignDto,
  CreateAssignmentDto,
  EndAssignmentDto,
  ReassignRouteDto,
  ResumeAssignmentDto,
  SuspendAssignmentDto,
  UpdateAssignmentDto,
} from '../dto';
import {
  RoutesRepository,
  RouteStopsRepository,
  type RouteWithRelations,
} from '../repositories/routes.repository';
import {
  TransportAssignmentsRepository,
  type AssignmentWithRelations,
} from '../repositories/transport-assignments.repository';
import { routeCanCarry } from './routes.service';
import { TransportNotificationsService } from './transport-notifications.service';
import { TransportSettingsService } from './transport-settings.service';

export interface AssignmentResult {
  assignment: AssignmentWithRelations;
  warnings: string[];
}

export interface BulkAssignResult {
  assigned: number;
  skipped: Array<{ enrollmentId: string; reason: string }>;
  warnings: string[];
}

/**
 * Riders: who is on which bus, from which stop, and from when.
 *
 * **The one rule everything else hangs off:** an assignment is a service
 * *window*, not a flag. Suspending stamps a date, resuming stamps
 * another, ending stamps a third, and M16 reads those three columns to
 * decide what a family owes. That is why every mutation here writes a
 * date rather than only a status — a status change with no date cannot
 * answer "how much of March does this rider owe" (the M21 `exit_date`
 * lesson, which cost a whole migration to learn).
 *
 * **Capacity is a policy refusal, never a structural one** (roadmap §6):
 * a 40-seat bus carrying 41 children is a real thing that happens, and a
 * system that made it impossible to record would simply be lied to. Over
 * capacity therefore warns by default, refuses only when a school turns
 * `transport.capacity_hard_block` on, and `transport.assign.override`
 * pushes past that — the M13/M14/M23 two-tier split.
 */
@Injectable()
export class TransportAssignmentsService {
  private readonly logger = new Logger(TransportAssignmentsService.name);

  constructor(
    private readonly assignments: TransportAssignmentsRepository,
    private readonly routes: RoutesRepository,
    private readonly stops: RouteStopsRepository,
    private readonly enrollments: EnrollmentsRepository,
    private readonly permissions: PermissionsService,
    private readonly config: TransportSettingsService,
    private readonly notifications: TransportNotificationsService,
    private readonly audit: AuditContextService,
  ) {}

  // ── reads ───────────────────────────────────────────────────────────

  async list(query: AssignmentQueryDto, actor: AccessTokenPayload) {
    const { rows, total } = await this.assignments.findMany(
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

  async get(id: string, actor: AccessTokenPayload) {
    const assignment = await this.assignments.findDetail(id, actor.schoolId);
    if (!assignment) {
      throw new NotFoundException(`Transport assignment ${id} not found`);
    }
    return assignment;
  }

  /** For the student profile: the live assignment, or `null`. */
  async forStudent(
    studentId: string,
    schoolId: string,
    sessionId?: string,
  ): Promise<AssignmentWithRelations | null> {
    return this.assignments.findForStudent(schoolId, studentId, sessionId);
  }

  // ── assign ──────────────────────────────────────────────────────────

  async create(
    dto: CreateAssignmentDto,
    actor: AccessTokenPayload,
  ): Promise<AssignmentResult> {
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
        `That enrollment is ${enrollment.status} — only an active student can be put on a bus`,
      );
    }

    const existing = await this.assignments.findLive(dto.enrollmentId);
    if (existing) {
      throw new ConflictException(
        `${enrollment.student.firstName} is already on "${existing.route.name}" from ${existing.stop.name} — move that assignment rather than adding a second`,
      );
    }

    const { route, stop } = await this.resolveRouteAndStop(
      dto.routeId,
      dto.stopId,
      actor.schoolId,
    );
    const verdict = await this.checkCapacity(
      route,
      actor,
      cfg.capacityHardBlock,
      dto.override === true,
      1,
    );

    const startDate = dto.startDate ? parseDate(dto.startDate) : today();
    const created = await this.assignments.create({
      schoolId: actor.schoolId,
      enrollmentId: dto.enrollmentId,
      routeId: route.id,
      stopId: stop.id,
      startDate,
      status: TransportAssignmentStatus.ACTIVE,
      remarks: dto.remarks?.trim() || null,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'TransportAssignment',
      entityId: created.id,
      newValues: {
        enrollmentId: dto.enrollmentId,
        route: route.name,
        stop: stop.name,
        monthlyFee: Number(stop.monthlyFee),
        startDate: isoDate(startDate),
        ...(verdict.warn ? { capacityOverride: verdict.reason } : {}),
      },
    });

    const assignment = await this.get(created.id, actor);
    if (cfg.notifyGuardianOnAssign) {
      await this.notifications.announceAssignment(assignment, cfg);
    }
    return { assignment, warnings: warningsFrom(verdict) };
  }

  /** Roadmap §5's "bulk assign by section". */
  async bulkAssign(
    dto: BulkAssignDto,
    actor: AccessTokenPayload,
  ): Promise<BulkAssignResult> {
    const cfg = await this.config.load(actor.schoolId);
    this.assertEnabled(cfg.enabled);

    const { route, stop } = await this.resolveRouteAndStop(
      dto.routeId,
      dto.stopId,
      actor.schoolId,
    );

    const skipped: BulkAssignResult['skipped'] = [];
    const candidates: string[] = [];
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
      const live = await this.assignments.findLive(enrollmentId);
      if (live) {
        skipped.push({
          enrollmentId,
          reason: `Already riding "${live.route.name}" from ${live.stop.name}`,
        });
        continue;
      }
      candidates.push(enrollmentId);
    }

    // The capacity question is asked ONCE for the whole batch, not per
    // rider: adding thirty children to a forty-seat bus one at a time
    // would pass twenty-nine times and refuse the thirtieth, which tells
    // the office nothing useful about the decision it is making.
    const verdict = await this.checkCapacity(
      route,
      actor,
      cfg.capacityHardBlock,
      dto.override === true,
      candidates.length,
    );

    const startDate = dto.startDate ? parseDate(dto.startDate) : today();
    await this.assignments.withTransaction(async (tx) => {
      for (const enrollmentId of candidates) {
        await this.assignments.create(
          {
            schoolId: actor.schoolId,
            enrollmentId,
            routeId: route.id,
            stopId: stop.id,
            startDate,
            status: TransportAssignmentStatus.ACTIVE,
            createdBy: actor.sub,
            updatedBy: actor.sub,
          },
          tx,
        );
      }
    });

    this.audit.set({
      entityType: 'TransportAssignment',
      entityId: route.id,
      newValues: {
        action: 'BULK_ASSIGN',
        route: route.name,
        stop: stop.name,
        assigned: candidates.length,
        skipped: skipped.length,
      },
    });

    return {
      assigned: candidates.length,
      skipped,
      warnings: warningsFrom(verdict),
    };
  }

  /** Move a rider to another route or stop. */
  async update(
    id: string,
    dto: UpdateAssignmentDto,
    actor: AccessTokenPayload,
  ): Promise<AssignmentResult> {
    const cfg = await this.config.load(actor.schoolId);
    const existing = await this.get(id, actor);
    if (existing.status === TransportAssignmentStatus.ENDED) {
      throw new ConflictException(
        'That assignment has ended — create a new one rather than editing history',
      );
    }

    const routeId = dto.routeId ?? existing.routeId;
    const stopId = dto.stopId ?? existing.stopId;
    const { route, stop } = await this.resolveRouteAndStop(
      routeId,
      stopId,
      actor.schoolId,
    );

    let verdict: CapacityVerdict | null = null;
    if (routeId !== existing.routeId) {
      verdict = await this.checkCapacity(
        route,
        actor,
        cfg.capacityHardBlock,
        dto.override === true,
        1,
      );
    }

    await this.assignments.update(id, {
      routeId: route.id,
      stopId: stop.id,
      ...(dto.remarks !== undefined
        ? { remarks: dto.remarks.trim() || null }
        : {}),
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'TransportAssignment',
      entityId: id,
      oldValues: { route: existing.route.name, stop: existing.stop.name },
      newValues: { route: route.name, stop: stop.name },
    });

    return {
      assignment: await this.get(id, actor),
      warnings: verdict ? warningsFrom(verdict) : [],
    };
  }

  // ── the lifecycle ───────────────────────────────────────────────────

  async suspend(
    id: string,
    dto: SuspendAssignmentDto,
    actor: AccessTokenPayload,
  ) {
    const existing = await this.get(id, actor);
    if (existing.status !== TransportAssignmentStatus.ACTIVE) {
      throw new ConflictException(
        `Only an ACTIVE assignment can be suspended — this one is ${existing.status}`,
      );
    }
    const effective = dto.effectiveDate
      ? parseDate(dto.effectiveDate)
      : today();
    if (effective < existing.startDate) {
      throw new BadRequestException(
        'A suspension cannot start before the assignment did',
      );
    }

    await this.assignments.update(id, {
      status: TransportAssignmentStatus.SUSPENDED,
      suspendedAt: effective,
      statusReason: dto.reason.trim(),
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'TransportAssignment',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: {
        status: TransportAssignmentStatus.SUSPENDED,
        suspendedAt: isoDate(effective),
        reason: dto.reason,
      },
    });
    return this.get(id, actor);
  }

  async resume(
    id: string,
    dto: ResumeAssignmentDto,
    actor: AccessTokenPayload,
  ) {
    const existing = await this.get(id, actor);
    if (existing.status !== TransportAssignmentStatus.SUSPENDED) {
      throw new ConflictException(
        `Only a SUSPENDED assignment can be resumed — this one is ${existing.status}`,
      );
    }
    const effective = dto.effectiveDate
      ? parseDate(dto.effectiveDate)
      : today();
    if (existing.suspendedAt && effective < existing.suspendedAt) {
      throw new BadRequestException(
        'A rider cannot come back before they stopped travelling',
      );
    }

    // `suspended_at` is CLEARED and `resumed_at` set: the window is
    // `[resumed_at, ∞)` again, and `chk_transport_assignments_status_
    // evidence` refuses an ACTIVE row that still carries a suspension.
    await this.assignments.update(id, {
      status: TransportAssignmentStatus.ACTIVE,
      suspendedAt: null,
      resumedAt: effective,
      statusReason: null,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'TransportAssignment',
      entityId: id,
      oldValues: {
        status: existing.status,
        suspendedAt: existing.suspendedAt
          ? isoDate(existing.suspendedAt)
          : null,
      },
      newValues: {
        status: TransportAssignmentStatus.ACTIVE,
        resumedAt: isoDate(effective),
      },
    });
    return this.get(id, actor);
  }

  /**
   * Roadmap §6: "ending an assignment stops future transport invoicing
   * (current month per proration rule)" — which is exactly what writing
   * `end_date` does, because M16 reads the window rather than the status.
   */
  async end(id: string, dto: EndAssignmentDto, actor: AccessTokenPayload) {
    const existing = await this.get(id, actor);
    if (existing.status === TransportAssignmentStatus.ENDED) {
      throw new ConflictException('That assignment has already ended');
    }
    const endDate = dto.endDate ? parseDate(dto.endDate) : today();
    if (endDate < existing.startDate) {
      throw new BadRequestException(
        'An assignment cannot end before it started',
      );
    }

    await this.assignments.update(id, {
      status: TransportAssignmentStatus.ENDED,
      endDate,
      // A rider who was suspended and then left, left. The window's
      // upper bound becomes the end date (see `serviceWindow`), and
      // leaving the suspension date behind would be a second, contradictory
      // boundary.
      suspendedAt: null,
      statusReason: dto.reason.trim(),
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'TransportAssignment',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: {
        status: TransportAssignmentStatus.ENDED,
        endDate: isoDate(endDate),
        reason: dto.reason,
      },
    });
    return this.get(id, actor);
  }

  /**
   * Roadmap §8's "route split/merge mid-year → bulk reassignment tool
   * preserving fee continuity".
   *
   * **Fee continuity is the whole point**, so the destination stop is
   * resolved by NAME when none is given: a split moves "Kazipara" from
   * one route to another and the family keeps paying the Kazipara fare.
   * A rider whose stop has no counterpart on the destination is reported
   * rather than silently dropped onto the first stop of the new route,
   * which would change what they pay without anybody deciding to.
   */
  async reassign(dto: ReassignRouteDto, actor: AccessTokenPayload) {
    const cfg = await this.config.load(actor.schoolId);
    if (dto.fromRouteId === dto.toRouteId) {
      throw new BadRequestException(
        'The source and destination routes are the same',
      );
    }

    const from = await this.routes.findDetail(dto.fromRouteId, actor.schoolId);
    if (!from) throw new NotFoundException('Source route not found');
    const to = await this.routes.findDetail(dto.toRouteId, actor.schoolId);
    if (!to) throw new NotFoundException('Destination route not found');

    const carry = routeCanCarry(to);
    if (!carry.ok) throw new ConflictException(carry.reason);

    const riders = await this.assignments.findAllFor(actor.schoolId, {
      routeId: dto.fromRouteId,
      status: TransportAssignmentStatus.ACTIVE,
    });
    const selected = dto.assignmentIds
      ? riders.filter((rider) => dto.assignmentIds?.includes(rider.id))
      : riders;

    if (selected.length === 0) {
      throw new BadRequestException(
        'No active riders on the source route match that selection',
      );
    }

    const explicitStop = dto.toStopId
      ? await this.stops.findByIdOrFail(dto.toStopId, actor.schoolId)
      : null;
    if (explicitStop && explicitStop.routeId !== to.id) {
      throw new BadRequestException(
        'The destination stop is not on the destination route',
      );
    }

    const byName = new Map(
      to.stops.map((stop) => [stop.name.trim().toLowerCase(), stop]),
    );

    const moves: Array<{ id: string; stopId: string }> = [];
    const unmatched: Array<{ assignmentId: string; reason: string }> = [];
    for (const rider of selected) {
      const target =
        explicitStop ?? byName.get(rider.stop.name.trim().toLowerCase());
      if (!target) {
        unmatched.push({
          assignmentId: rider.id,
          reason: `"${to.name}" has no stop called "${rider.stop.name}" — create it (with its fare) or pass toStopId`,
        });
        continue;
      }
      moves.push({ id: rider.id, stopId: target.id });
    }

    const verdict = await this.checkCapacity(
      to,
      actor,
      cfg.capacityHardBlock,
      dto.override === true,
      moves.length,
    );

    await this.assignments.withTransaction(async (tx) => {
      for (const move of moves) {
        await this.assignments.update(
          move.id,
          { routeId: to.id, stopId: move.stopId, updatedBy: actor.sub },
          tx,
        );
      }
    });

    this.audit.set({
      entityType: 'TransportAssignment',
      entityId: to.id,
      oldValues: { route: from.name },
      newValues: {
        action: 'REASSIGN_ROUTE',
        route: to.name,
        moved: moves.length,
        unmatched: unmatched.length,
        reason: dto.reason,
      },
    });

    return {
      moved: moves.length,
      unmatched,
      warnings: warningsFrom(verdict),
    };
  }

  // ── internals ───────────────────────────────────────────────────────

  private async resolveRouteAndStop(
    routeId: string,
    stopId: string,
    schoolId: string,
  ): Promise<{
    route: RouteWithRelations;
    stop: RouteWithRelations['stops'][number];
  }> {
    const route = await this.routes.findDetail(routeId, schoolId);
    if (!route) throw new NotFoundException(`Route ${routeId} not found`);

    const carry = routeCanCarry(route);
    if (!carry.ok) throw new ConflictException(carry.reason);

    // The composite FK would refuse this anyway — this check exists to
    // say *why* rather than surfacing a constraint name to an office
    // clerk.
    const stop = route.stops.find((candidate) => candidate.id === stopId);
    if (!stop) {
      throw new BadRequestException(
        `That stop is not on "${route.name}" — pick one of its ${route.stops.length} stop(s)`,
      );
    }
    return { route, stop };
  }

  private async checkCapacity(
    route: RouteWithRelations,
    actor: AccessTokenPayload,
    hardBlock: boolean,
    requestedOverride: boolean,
    incoming: number,
  ): Promise<CapacityVerdict> {
    const riders = await this.routes.riderCounts(route.schoolId, [route.id]);
    const override = requestedOverride ? await this.hasOverride(actor) : false;

    const verdict = capacityVerdict({
      capacity: route.vehicle?.capacity ?? null,
      assigned: riders.get(route.id) ?? 0,
      incoming,
      hardBlock,
      override,
    });

    if (!verdict.allowed) {
      if (requestedOverride && !override) {
        throw new ForbiddenException(
          'Putting more children on a full bus needs transport.assign.override',
        );
      }
      throw new ConflictException(
        `${verdict.reason} Ask somebody with transport.assign.override to approve it, or attach a larger vehicle.`,
      );
    }
    return verdict;
  }

  private async hasOverride(actor: AccessTokenPayload): Promise<boolean> {
    if (actor.userType === UserType.SUPER_ADMIN) return true;
    const codes = await this.permissions.getUserPermissionCodes(actor.sub);
    return codes.includes('transport.assign.override');
  }

  private assertEnabled(enabled: boolean): void {
    if (!enabled) {
      throw new ConflictException(
        'Transport is switched off for this school (transport.enabled)',
      );
    }
  }
}

function warningsFrom(verdict: CapacityVerdict): string[] {
  return verdict.warn && verdict.reason ? [verdict.reason] : [];
}

function today(): Date {
  return parseDate(dhakaToday());
}

/** Re-exported for the reports service's typing. */
export type { Prisma };
