import { Injectable } from '@nestjs/common';
import {
  Prisma,
  Route,
  RouteStop,
  TransportAssignmentStatus,
} from '@prisma/client';
import {
  BaseRepository,
  PrismaClientLike,
} from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

const ROUTE_INCLUDE = {
  vehicle: {
    select: { id: true, regNo: true, capacity: true, status: true, type: true },
  },
  driver: { select: { id: true, name: true, phone: true, status: true } },
  substituteDriver: { select: { id: true, name: true, phone: true } },
  stops: {
    where: { deletedAt: null },
    orderBy: { displayOrder: 'asc' },
  },
} satisfies Prisma.RouteInclude;

export type RouteWithRelations = Prisma.RouteGetPayload<{
  include: typeof ROUTE_INCLUDE;
}>;

/** Riders that occupy a seat — ACTIVE and SUSPENDED, never ENDED. */
export const OCCUPYING_STATUSES: TransportAssignmentStatus[] = [
  TransportAssignmentStatus.ACTIVE,
  TransportAssignmentStatus.SUSPENDED,
];

@Injectable()
export class RoutesRepository extends BaseRepository<
  Route,
  Prisma.RouteWhereInput,
  Prisma.RouteUncheckedCreateInput,
  Prisma.RouteUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.route, 'Route');
  }

  async findDetail(
    id: string,
    schoolId: string,
  ): Promise<RouteWithRelations | null> {
    return this.prisma.route.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: ROUTE_INCLUDE,
    });
  }

  async findMany(
    schoolId: string,
    filter: { status?: Route['status']; vehicleId?: string; search?: string },
  ): Promise<RouteWithRelations[]> {
    return this.prisma.route.findMany({
      where: {
        schoolId,
        deletedAt: null,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.vehicleId ? { vehicleId: filter.vehicleId } : {}),
        ...(filter.search
          ? { name: { contains: filter.search, mode: 'insensitive' } }
          : {}),
      },
      include: ROUTE_INCLUDE,
      orderBy: [{ name: 'asc' }],
    });
  }

  async findByName(
    schoolId: string,
    name: string,
    excludeId?: string,
  ): Promise<Route | null> {
    return this.prisma.route.findFirst({
      where: {
        schoolId,
        deletedAt: null,
        name: { equals: name.trim(), mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  /**
   * Riders per route, in one query. A SUSPENDED rider still holds a seat
   * — see `capacity.engine.ts`.
   */
  async riderCounts(
    schoolId: string,
    routeIds?: string[],
  ): Promise<Map<string, number>> {
    const rows = await this.prisma.transportAssignment.groupBy({
      by: ['routeId'],
      where: {
        schoolId,
        deletedAt: null,
        status: { in: OCCUPYING_STATUSES },
        ...(routeIds ? { routeId: { in: routeIds } } : {}),
      },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.routeId, row._count._all]));
  }

  async riderCountsByStop(routeId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.transportAssignment.groupBy({
      by: ['stopId'],
      where: {
        routeId,
        deletedAt: null,
        status: { in: OCCUPYING_STATUSES },
      },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.stopId, row._count._all]));
  }
}

@Injectable()
export class RouteStopsRepository extends BaseRepository<
  RouteStop,
  Prisma.RouteStopWhereInput,
  Prisma.RouteStopUncheckedCreateInput,
  Prisma.RouteStopUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.routeStop, 'RouteStop');
  }

  async findForRoute(routeId: string): Promise<RouteStop[]> {
    return this.prisma.routeStop.findMany({
      where: { routeId, deletedAt: null },
      orderBy: [{ displayOrder: 'asc' }],
    });
  }

  async findByName(
    routeId: string,
    name: string,
    excludeId?: string,
  ): Promise<RouteStop | null> {
    return this.prisma.routeStop.findFirst({
      where: {
        routeId,
        deletedAt: null,
        name: { equals: name.trim(), mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  async countRiders(stopId: string): Promise<number> {
    return this.prisma.transportAssignment.count({
      where: {
        stopId,
        deletedAt: null,
        status: { in: OCCUPYING_STATUSES },
      },
    });
  }

  async setOrder(
    stopId: string,
    displayOrder: number,
    tx?: PrismaClientLike,
  ): Promise<void> {
    const client = (tx ?? this.prisma) as PrismaService;
    await client.routeStop.update({
      where: { id: stopId },
      data: { displayOrder },
    });
  }
}
