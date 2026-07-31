import { Injectable } from '@nestjs/common';
import {
  Driver,
  DriverStatus,
  Prisma,
  Vehicle,
  VehicleStatus,
} from '@prisma/client';
import {
  BaseRepository,
  PrismaClientLike,
} from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

export type DriverWithStaff = Prisma.DriverGetPayload<{
  include: {
    staff: { select: { id: true; employeeId: true; designation: true } };
  };
}>;

@Injectable()
export class VehiclesRepository extends BaseRepository<
  Vehicle,
  Prisma.VehicleWhereInput,
  Prisma.VehicleUncheckedCreateInput,
  Prisma.VehicleUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.vehicle, 'Vehicle');
  }

  /**
   * A plate matches on the NORMALIZED form, because "Dhaka Metro Ga
   * 11-2345" and "DHAKA METRO GA 11-2345" are one bus and the unique
   * index that will refuse the second one compares them that way.
   */
  async findByRegNo(
    schoolId: string,
    regNo: string,
    excludeId?: string,
  ): Promise<Vehicle | null> {
    const wanted = regNo.trim().replace(/\s+/g, ' ').toUpperCase();
    const matches = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "vehicles"
      WHERE "school_id" = ${schoolId}::uuid
        AND "deleted_at" IS NULL
        AND upper(btrim("reg_no")) = ${wanted}
        ${excludeId ? Prisma.sql`AND "id" <> ${excludeId}::uuid` : Prisma.empty}
      LIMIT 1`;
    if (matches.length === 0) return null;
    return this.prisma.vehicle.findUnique({ where: { id: matches[0].id } });
  }

  async findAllLive(schoolId: string): Promise<Vehicle[]> {
    return this.prisma.vehicle.findMany({
      where: { schoolId, deletedAt: null },
      orderBy: [{ regNo: 'asc' }],
    });
  }

  /** Vehicles whose routes still exist — the delete guard's question. */
  async countRoutes(vehicleId: string): Promise<number> {
    return this.prisma.route.count({
      where: { vehicleId, deletedAt: null },
    });
  }

  async countExpenses(vehicleId: string): Promise<number> {
    return this.prisma.vehicleExpense.count({
      where: { vehicleId, deletedAt: null },
    });
  }

  async countByStatus(
    schoolId: string,
  ): Promise<Array<{ status: VehicleStatus; count: number }>> {
    const rows = await this.prisma.vehicle.groupBy({
      by: ['status'],
      where: { schoolId, deletedAt: null },
      _count: { _all: true },
    });
    return rows.map((row) => ({ status: row.status, count: row._count._all }));
  }

  /** Stamps the expiry-alert dedupe window (the M12/M23 column pattern). */
  async markNotified(ids: string[], at: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.vehicle.updateMany({
      where: { id: { in: ids } },
      data: { expiryNotifiedAt: at },
    });
  }
}

@Injectable()
export class DriversRepository extends BaseRepository<
  Driver,
  Prisma.DriverWhereInput,
  Prisma.DriverUncheckedCreateInput,
  Prisma.DriverUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.driver, 'Driver');
  }

  async findDetail(
    id: string,
    schoolId: string,
  ): Promise<DriverWithStaff | null> {
    return this.prisma.driver.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: {
        staff: { select: { id: true, employeeId: true, designation: true } },
      },
    });
  }

  async findAllLive(schoolId: string): Promise<DriverWithStaff[]> {
    return this.prisma.driver.findMany({
      where: { schoolId, deletedAt: null },
      include: {
        staff: { select: { id: true, employeeId: true, designation: true } },
      },
      orderBy: [{ name: 'asc' }],
    });
  }

  async findByLicense(
    schoolId: string,
    licenseNo: string,
    excludeId?: string,
  ): Promise<Driver | null> {
    const wanted = licenseNo.trim().toUpperCase();
    const matches = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "drivers"
      WHERE "school_id" = ${schoolId}::uuid
        AND "deleted_at" IS NULL
        AND upper(btrim("license_no")) = ${wanted}
        ${excludeId ? Prisma.sql`AND "id" <> ${excludeId}::uuid` : Prisma.empty}
      LIMIT 1`;
    if (matches.length === 0) return null;
    return this.prisma.driver.findUnique({ where: { id: matches[0].id } });
  }

  async findByStaff(
    schoolId: string,
    staffId: string,
    excludeId?: string,
  ): Promise<Driver | null> {
    return this.prisma.driver.findFirst({
      where: {
        schoolId,
        staffId,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  /** Routes this driver is on, as driver OR as substitute. */
  async countRoutes(driverId: string): Promise<number> {
    return this.prisma.route.count({
      where: {
        deletedAt: null,
        OR: [{ driverId }, { substituteDriverId: driverId }],
      },
    });
  }

  async countByStatus(
    schoolId: string,
  ): Promise<Array<{ status: DriverStatus; count: number }>> {
    const rows = await this.prisma.driver.groupBy({
      by: ['status'],
      where: { schoolId, deletedAt: null },
      _count: { _all: true },
    });
    return rows.map((row) => ({ status: row.status, count: row._count._all }));
  }

  async markNotified(ids: string[], at: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.driver.updateMany({
      where: { id: { in: ids } },
      data: { expiryNotifiedAt: at },
    });
  }

  async transaction<R>(fn: (tx: PrismaClientLike) => Promise<R>): Promise<R> {
    return this.prisma.$transaction(fn);
  }
}
