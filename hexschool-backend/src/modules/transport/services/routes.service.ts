import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RouteStop } from '@prisma/client';
import { RouteStatus, VehicleStatus } from '../../../common/constants';
import { timeColumnMinutes } from '../../../common/utils/clock.util';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import {
  capacityStatus,
  stopLoads,
  type CapacityStatus,
} from '../calc/capacity.engine';
import {
  formatClock,
  nextDisplayOrder,
  parseClock,
  reorderPlan,
  routeWindow,
  stopSequenceIssues,
  type PlannedStop,
  type StopSequenceIssue,
} from '../calc/route-plan.util';
import type {
  ReorderStopsDto,
  RouteQueryDto,
  UpsertRouteDto,
  UpsertStopDto,
} from '../dto';
import {
  RoutesRepository,
  RouteStopsRepository,
  type RouteWithRelations,
} from '../repositories/routes.repository';

export interface RouteView extends RouteWithRelations {
  capacity: CapacityStatus;
  window: { firstPickup: string | null; lastDrop: string | null };
  issues: StopSequenceIssue[];
  stopLoads: Array<{ stopId: string; stopName: string; riders: number }>;
}

/**
 * Routes and their stops (roadmap §4 "CRUD everything; route-stop
 * ordering; capacity tracking").
 *
 * Two things here are more than CRUD:
 *
 *   - **Reordering goes through `reorderPlan`.** `uq_route_stops_order`
 *     is a live-rows unique over `(route_id, display_order)`, so writing
 *     the new positions straight over the old ones collides halfway
 *     down — the M11 renumber lesson exactly. Every stop is parked above
 *     the route's range first, then written down into place, inside one
 *     transaction.
 *   - **A stop with riders on it may not be deleted.** Deleting it would
 *     leave the composite FK pointing at a soft-deleted row and, more to
 *     the point, would silently stop billing those families — the fee
 *     lives on the stop.
 */
@Injectable()
export class RoutesService {
  constructor(
    private readonly routes: RoutesRepository,
    private readonly stops: RouteStopsRepository,
    private readonly audit: AuditContextService,
  ) {}

  // ── routes ──────────────────────────────────────────────────────────

  async list(query: RouteQueryDto, actor: AccessTokenPayload) {
    const routes = await this.routes.findMany(actor.schoolId, query);
    const riders = await this.routes.riderCounts(
      actor.schoolId,
      routes.map((route) => route.id),
    );
    return routes.map((route) =>
      this.decorate(route, riders.get(route.id) ?? 0),
    );
  }

  async get(id: string, actor: AccessTokenPayload): Promise<RouteView> {
    const route = await this.routes.findDetail(id, actor.schoolId);
    if (!route) throw new NotFoundException(`Route ${id} not found`);
    const riders = await this.routes.riderCounts(actor.schoolId, [id]);
    const byStop = await this.routes.riderCountsByStop(id);
    return {
      ...this.decorate(route, riders.get(id) ?? 0),
      stopLoads: stopLoads(
        route.stops.map((stop) => ({
          id: stop.id,
          name: stop.name,
          displayOrder: stop.displayOrder,
        })),
        byStop,
      ),
    };
  }

  async create(dto: UpsertRouteDto, actor: AccessTokenPayload) {
    await this.assertNameFree(dto.name, actor.schoolId);
    this.assertDistinctDrivers(dto);

    const created = await this.routes.create({
      schoolId: actor.schoolId,
      name: dto.name.trim(),
      nameBn: dto.nameBn?.trim() || null,
      description: dto.description?.trim() || null,
      vehicleId: dto.vehicleId ?? null,
      driverId: dto.driverId ?? null,
      substituteDriverId: dto.substituteDriverId ?? null,
      helperName: dto.helperName?.trim() || null,
      helperPhone: dto.helperPhone?.trim() || null,
      status: dto.status,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'Route',
      entityId: created.id,
      newValues: { name: created.name, vehicleId: created.vehicleId },
    });
    return this.get(created.id, actor);
  }

  async update(id: string, dto: UpsertRouteDto, actor: AccessTokenPayload) {
    const existing = await this.routes.findByIdOrFail(id, actor.schoolId);
    if (dto.name.trim().toLowerCase() !== existing.name.toLowerCase()) {
      await this.assertNameFree(dto.name, actor.schoolId, id);
    }
    this.assertDistinctDrivers(dto);

    // Roadmap §6: a vehicle in MAINTENANCE keeps its route — the route
    // still runs tomorrow, and hiding it is how a school forgets that it
    // has no bus for it today. The flag is on the read, not a refusal.
    const updated = await this.routes.update(id, {
      name: dto.name.trim(),
      nameBn: dto.nameBn?.trim() || null,
      description: dto.description?.trim() || null,
      vehicleId: dto.vehicleId ?? null,
      driverId: dto.driverId ?? null,
      substituteDriverId: dto.substituteDriverId ?? null,
      helperName: dto.helperName?.trim() || null,
      helperPhone: dto.helperPhone?.trim() || null,
      status: dto.status,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'Route',
      entityId: id,
      oldValues: {
        name: existing.name,
        vehicleId: existing.vehicleId,
        driverId: existing.driverId,
        substituteDriverId: existing.substituteDriverId,
        status: existing.status,
      },
      newValues: {
        name: updated.name,
        vehicleId: updated.vehicleId,
        driverId: updated.driverId,
        substituteDriverId: updated.substituteDriverId,
        status: updated.status,
      },
    });
    return this.get(id, actor);
  }

  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.routes.findByIdOrFail(id, actor.schoolId);
    const riders = await this.routes.riderCounts(actor.schoolId, [id]);
    const count = riders.get(id) ?? 0;
    if (count > 0) {
      throw new ConflictException(
        `${count} student(s) are still riding "${existing.name}" — move them to another route, or end their assignments first`,
      );
    }
    await this.routes.softDelete(id);
    this.audit.set({
      entityType: 'Route',
      entityId: id,
      oldValues: { name: existing.name },
    });
  }

  // ── stops ───────────────────────────────────────────────────────────

  async addStop(
    routeId: string,
    dto: UpsertStopDto,
    actor: AccessTokenPayload,
  ) {
    const route = await this.routes.findByIdOrFail(routeId, actor.schoolId);
    await this.assertStopNameFree(routeId, dto.name);

    const existing = await this.stops.findForRoute(routeId);
    const created = await this.stops.create({
      schoolId: actor.schoolId,
      routeId: route.id,
      name: dto.name.trim(),
      landmark: dto.landmark?.trim() || null,
      pickupTime: toTime(dto.pickupTime),
      dropTime: toTime(dto.dropTime),
      monthlyFee: dto.monthlyFee,
      displayOrder:
        dto.displayOrder ?? nextDisplayOrder(existing.map(toPlanned)),
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'RouteStop',
      entityId: created.id,
      newValues: {
        routeId,
        name: created.name,
        monthlyFee: Number(created.monthlyFee),
      },
    });
    return this.get(routeId, actor);
  }

  async updateStop(
    routeId: string,
    stopId: string,
    dto: UpsertStopDto,
    actor: AccessTokenPayload,
  ) {
    await this.routes.findByIdOrFail(routeId, actor.schoolId);
    const existing = await this.stops.findByIdOrFail(stopId, actor.schoolId);
    if (existing.routeId !== routeId) {
      throw new NotFoundException(`Stop ${stopId} is not on that route`);
    }
    if (dto.name.trim().toLowerCase() !== existing.name.toLowerCase()) {
      await this.assertStopNameFree(routeId, dto.name, stopId);
    }

    const updated = await this.stops.update(stopId, {
      name: dto.name.trim(),
      landmark: dto.landmark?.trim() || null,
      pickupTime: toTime(dto.pickupTime),
      dropTime: toTime(dto.dropTime),
      monthlyFee: dto.monthlyFee,
      ...(dto.displayOrder !== undefined
        ? { displayOrder: dto.displayOrder }
        : {}),
      updatedBy: actor.sub,
    });

    // A fee edit is the one change here that moves money, so it is
    // audited as a value rather than as "the stop changed". Riders
    // already billed are untouched: an invoice line is history (M16).
    this.audit.set({
      entityType: 'RouteStop',
      entityId: stopId,
      oldValues: {
        name: existing.name,
        monthlyFee: Number(existing.monthlyFee),
      },
      newValues: { name: updated.name, monthlyFee: Number(updated.monthlyFee) },
    });
    return this.get(routeId, actor);
  }

  async removeStop(
    routeId: string,
    stopId: string,
    actor: AccessTokenPayload,
  ): Promise<void> {
    await this.routes.findByIdOrFail(routeId, actor.schoolId);
    const stop = await this.stops.findByIdOrFail(stopId, actor.schoolId);
    if (stop.routeId !== routeId) {
      throw new NotFoundException(`Stop ${stopId} is not on that route`);
    }
    const riders = await this.stops.countRiders(stopId);
    if (riders > 0) {
      throw new ConflictException(
        `${riders} student(s) board at "${stop.name}" — move them to another stop first (deleting it would stop their transport billing silently)`,
      );
    }
    await this.stops.softDelete(stopId);
    this.audit.set({
      entityType: 'RouteStop',
      entityId: stopId,
      oldValues: { routeId, name: stop.name },
    });
  }

  /**
   * Roadmap §5's draggable stops. Two passes inside one transaction — see
   * the class doc and `reorderPlan`.
   */
  async reorderStops(
    routeId: string,
    dto: ReorderStopsDto,
    actor: AccessTokenPayload,
  ) {
    await this.routes.findByIdOrFail(routeId, actor.schoolId);
    const existing = await this.stops.findForRoute(routeId);
    if (existing.length === 0) {
      throw new BadRequestException('That route has no stops to reorder');
    }

    const known = new Set(existing.map((stop) => stop.id));
    const unknown = dto.stopIds.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `${unknown.length} of the stop ids are not on this route`,
      );
    }

    const plan = reorderPlan(dto.stopIds, existing.map(toPlanned));
    await this.stops.withTransaction(async (tx) => {
      for (const step of plan.park) {
        await this.stops.setOrder(step.stopId, step.displayOrder, tx);
      }
      for (const step of plan.apply) {
        await this.stops.setOrder(step.stopId, step.displayOrder, tx);
      }
    });

    this.audit.set({
      entityType: 'Route',
      entityId: routeId,
      newValues: { action: 'REORDER_STOPS', order: dto.stopIds },
    });
    return this.get(routeId, actor);
  }

  // ── internals ───────────────────────────────────────────────────────

  private decorate(route: RouteWithRelations, riders: number): RouteView {
    const planned = route.stops.map(toPlanned);
    return {
      ...route,
      capacity: capacityStatus({
        capacity: route.vehicle?.capacity ?? null,
        assigned: riders,
      }),
      window: routeWindow(planned),
      issues: stopSequenceIssues(planned),
      stopLoads: [],
    };
  }

  private assertDistinctDrivers(dto: UpsertRouteDto): void {
    if (
      dto.driverId &&
      dto.substituteDriverId &&
      dto.driverId === dto.substituteDriverId
    ) {
      throw new BadRequestException(
        'The substitute cannot be the same person as the driver — the substitute exists because the driver is away',
      );
    }
  }

  private async assertNameFree(
    name: string,
    schoolId: string,
    excludeId?: string,
  ): Promise<void> {
    const clash = await this.routes.findByName(schoolId, name, excludeId);
    if (clash) {
      throw new ConflictException(
        `A route called "${name.trim()}" already exists`,
      );
    }
  }

  private async assertStopNameFree(
    routeId: string,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const clash = await this.stops.findByName(routeId, name, excludeId);
    if (clash) {
      throw new ConflictException(
        `"${name.trim()}" is already a stop on this route`,
      );
    }
  }
}

/** Roadworthiness, as the assignment guard asks it (roadmap §6). */
export function routeCanCarry(route: RouteWithRelations): {
  ok: boolean;
  reason: string | null;
} {
  if (route.status !== RouteStatus.ACTIVE) {
    return { ok: false, reason: `Route "${route.name}" is ${route.status}` };
  }
  if (!route.vehicle) {
    return {
      ok: false,
      reason: `Route "${route.name}" has no vehicle attached — assign one before putting children on it`,
    };
  }
  if (route.vehicle.status === VehicleStatus.INACTIVE) {
    return {
      ok: false,
      reason: `${route.vehicle.regNo} is INACTIVE — attach a working vehicle to "${route.name}" first`,
    };
  }
  // MAINTENANCE deliberately passes: the bus is back on Monday, and the
  // route still needs its riders on the list (roadmap §6).
  return { ok: true, reason: null };
}

function toPlanned(stop: RouteStop): PlannedStop {
  return {
    id: stop.id,
    name: stop.name,
    displayOrder: stop.displayOrder,
    pickupTime: fromTime(stop.pickupTime),
    dropTime: fromTime(stop.dropTime),
  };
}

/** `HH:MM` → the epoch-day Date a Postgres `TIME` column round-trips. */
function toTime(value: string | undefined): Date | null {
  const minutes = parseClock(value ?? null);
  if (minutes === null) return null;
  return new Date(Date.UTC(1970, 0, 1, Math.floor(minutes / 60), minutes % 60));
}

function fromTime(value: Date | null): string | null {
  return value === null ? null : formatClock(timeColumnMinutes(value));
}
