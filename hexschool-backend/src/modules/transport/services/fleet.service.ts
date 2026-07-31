import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Driver, Vehicle } from '@prisma/client';
import { DriverStatus, VehicleStatus } from '../../../common/constants';
import { isoDate, parseDate } from '../../academic/calendar/date.util';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { dhakaToday } from '../../../common/utils/clock.util';
import {
  alertable,
  expiryItems,
  pastDateWarnings,
  worstState,
  type ExpiryItem,
  type ExpiryState,
} from '../calc/expiry.engine';
import { normalizeRegNo } from '../calc/route-plan.util';
import type {
  DriverQueryDto,
  UpsertDriverDto,
  UpsertVehicleDto,
  VehicleQueryDto,
} from '../dto';
import {
  DriversRepository,
  VehiclesRepository,
  type DriverWithStaff,
} from '../repositories/fleet.repository';
import { TransportSettingsService } from './transport-settings.service';

export interface VehicleView extends Vehicle {
  documents: ExpiryItem[];
  documentState: ExpiryState;
  routes: number;
}

export interface DriverView extends Omit<DriverWithStaff, 'staff'> {
  staff: DriverWithStaff['staff'];
  documents: ExpiryItem[];
  documentState: ExpiryState;
  routes: number;
}

/**
 * The fleet: what the school drives and who drives it.
 *
 * Both halves carry the same shape — a row, its papers, and how close
 * those papers are to lapsing — because that is the question the office
 * actually asks about a vehicle or a driver, and answering it in the list
 * rather than only in a nightly job is what makes the alert believable.
 *
 * Both halves also refuse a delete that would strand a route: the M06
 * rule (a master in use is refused **with a count**, never cascaded), and
 * here it matters more than usual, because the cascade would silently
 * leave children waiting at a stop with no bus assigned to it.
 */
@Injectable()
export class FleetService {
  constructor(
    private readonly vehicles: VehiclesRepository,
    private readonly drivers: DriversRepository,
    private readonly config: TransportSettingsService,
    private readonly audit: AuditContextService,
  ) {}

  // ── vehicles ────────────────────────────────────────────────────────

  async listVehicles(query: VehicleQueryDto, actor: AccessTokenPayload) {
    const cfg = await this.config.load(actor.schoolId);
    const page = await this.vehicles.paginate(query, {
      searchColumns: ['regNo', 'makeModel'],
      sortableColumns: ['regNo', 'capacity', 'createdAt'],
      schoolId: actor.schoolId,
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { type: query.type } : {}),
      },
    });

    const today = dhakaToday();
    const data: VehicleView[] = [];
    for (const vehicle of page.data) {
      data.push({
        ...vehicle,
        ...this.vehicleDocuments(vehicle, today, cfg.expiryAlertDays),
        routes: await this.vehicles.countRoutes(vehicle.id),
      });
    }
    return { ...page, data };
  }

  async getVehicle(
    id: string,
    actor: AccessTokenPayload,
  ): Promise<VehicleView> {
    const vehicle = await this.vehicles.findByIdOrFail(id, actor.schoolId);
    const cfg = await this.config.load(actor.schoolId);
    return {
      ...vehicle,
      ...this.vehicleDocuments(vehicle, dhakaToday(), cfg.expiryAlertDays),
      routes: await this.vehicles.countRoutes(vehicle.id),
    };
  }

  async createVehicle(dto: UpsertVehicleDto, actor: AccessTokenPayload) {
    await this.assertRegNoFree(dto.regNo, actor.schoolId);
    const created = await this.vehicles.create({
      schoolId: actor.schoolId,
      regNo: normalizeRegNo(dto.regNo),
      type: dto.type,
      capacity: dto.capacity,
      makeModel: dto.makeModel?.trim() || null,
      modelYear: dto.modelYear ?? null,
      status: dto.status,
      fitnessExpiry: dto.fitnessExpiry ? parseDate(dto.fitnessExpiry) : null,
      taxTokenExpiry: dto.taxTokenExpiry ? parseDate(dto.taxTokenExpiry) : null,
      insuranceExpiry: dto.insuranceExpiry
        ? parseDate(dto.insuranceExpiry)
        : null,
      notes: dto.notes?.trim() || null,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'Vehicle',
      entityId: created.id,
      newValues: { regNo: created.regNo, capacity: created.capacity },
    });

    // Roadmap §7 wants a WARNING for a lapsed date, not a refusal: a bus
    // whose tax token expired last month is a true fact, and refusing to
    // record it would leave the vehicle off the system entirely.
    return {
      vehicle: created,
      warnings: pastDateWarnings(this.vehiclePapers(created), dhakaToday()),
    };
  }

  async updateVehicle(
    id: string,
    dto: UpsertVehicleDto,
    actor: AccessTokenPayload,
  ) {
    const existing = await this.vehicles.findByIdOrFail(id, actor.schoolId);
    if (normalizeRegNo(dto.regNo) !== normalizeRegNo(existing.regNo)) {
      await this.assertRegNoFree(dto.regNo, actor.schoolId, id);
    }

    const updated = await this.vehicles.update(id, {
      regNo: normalizeRegNo(dto.regNo),
      type: dto.type,
      capacity: dto.capacity,
      makeModel: dto.makeModel?.trim() || null,
      modelYear: dto.modelYear ?? null,
      status: dto.status,
      fitnessExpiry: dto.fitnessExpiry ? parseDate(dto.fitnessExpiry) : null,
      taxTokenExpiry: dto.taxTokenExpiry ? parseDate(dto.taxTokenExpiry) : null,
      insuranceExpiry: dto.insuranceExpiry
        ? parseDate(dto.insuranceExpiry)
        : null,
      notes: dto.notes?.trim() || null,
      // A renewed paper starts a fresh alert cycle — otherwise the dedupe
      // window would keep the office quiet about the NEXT problem.
      expiryNotifiedAt: null,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'Vehicle',
      entityId: id,
      oldValues: {
        regNo: existing.regNo,
        capacity: existing.capacity,
        status: existing.status,
      },
      newValues: {
        regNo: updated.regNo,
        capacity: updated.capacity,
        status: updated.status,
      },
    });

    return {
      vehicle: updated,
      warnings: pastDateWarnings(this.vehiclePapers(updated), dhakaToday()),
    };
  }

  async removeVehicle(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.vehicles.findByIdOrFail(id, actor.schoolId);
    const routes = await this.vehicles.countRoutes(id);
    if (routes > 0) {
      throw new ConflictException(
        `${existing.regNo} is assigned to ${routes} route(s) — detach it from them first`,
      );
    }
    const expenses = await this.vehicles.countExpenses(id);
    if (expenses > 0) {
      throw new ConflictException(
        `${existing.regNo} has ${expenses} expense record(s) against it — set it to INACTIVE instead, so the spend stays in the accounts`,
      );
    }
    await this.vehicles.softDelete(id);
    this.audit.set({
      entityType: 'Vehicle',
      entityId: id,
      oldValues: { regNo: existing.regNo },
    });
  }

  // ── drivers ─────────────────────────────────────────────────────────

  async listDrivers(query: DriverQueryDto, actor: AccessTokenPayload) {
    const cfg = await this.config.load(actor.schoolId);
    const page = await this.drivers.paginate(query, {
      searchColumns: ['name', 'phone', 'licenseNo'],
      sortableColumns: ['name', 'createdAt'],
      schoolId: actor.schoolId,
      where: query.status ? { status: query.status } : {},
    });

    const today = dhakaToday();
    const data: DriverView[] = [];
    for (const driver of page.data) {
      const detail = await this.drivers.findDetail(driver.id, actor.schoolId);
      data.push({
        ...(detail ?? { ...driver, staff: null }),
        ...this.driverDocuments(driver, today, cfg.expiryAlertDays),
        routes: await this.drivers.countRoutes(driver.id),
      });
    }
    return { ...page, data };
  }

  async getDriver(id: string, actor: AccessTokenPayload): Promise<DriverView> {
    const driver = await this.drivers.findDetail(id, actor.schoolId);
    if (!driver) throw new NotFoundException(`Driver ${id} not found`);
    const cfg = await this.config.load(actor.schoolId);
    return {
      ...driver,
      ...this.driverDocuments(driver, dhakaToday(), cfg.expiryAlertDays),
      routes: await this.drivers.countRoutes(id),
    };
  }

  async createDriver(dto: UpsertDriverDto, actor: AccessTokenPayload) {
    await this.assertLicenseFree(dto.licenseNo, actor.schoolId);
    if (dto.staffId) await this.assertStaffFree(dto.staffId, actor.schoolId);

    const created = await this.drivers.create({
      schoolId: actor.schoolId,
      staffId: dto.staffId ?? null,
      name: dto.name.trim(),
      phone: dto.phone.trim(),
      licenseNo: dto.licenseNo.trim().toUpperCase(),
      licenseExpiry: dto.licenseExpiry ? parseDate(dto.licenseExpiry) : null,
      address: dto.address?.trim() || null,
      status: dto.status,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'Driver',
      entityId: created.id,
      newValues: { name: created.name, licenseNo: created.licenseNo },
    });

    return {
      driver: created,
      warnings: pastDateWarnings(this.driverPapers(created), dhakaToday()),
    };
  }

  async updateDriver(
    id: string,
    dto: UpsertDriverDto,
    actor: AccessTokenPayload,
  ) {
    const existing = await this.drivers.findByIdOrFail(id, actor.schoolId);
    if (
      dto.licenseNo.trim().toUpperCase() !== existing.licenseNo.toUpperCase()
    ) {
      await this.assertLicenseFree(dto.licenseNo, actor.schoolId, id);
    }
    if (dto.staffId && dto.staffId !== existing.staffId) {
      await this.assertStaffFree(dto.staffId, actor.schoolId, id);
    }

    const updated = await this.drivers.update(id, {
      staffId: dto.staffId ?? null,
      name: dto.name.trim(),
      phone: dto.phone.trim(),
      licenseNo: dto.licenseNo.trim().toUpperCase(),
      licenseExpiry: dto.licenseExpiry ? parseDate(dto.licenseExpiry) : null,
      address: dto.address?.trim() || null,
      status: dto.status,
      expiryNotifiedAt: null,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'Driver',
      entityId: id,
      oldValues: { name: existing.name, status: existing.status },
      newValues: { name: updated.name, status: updated.status },
    });

    return {
      driver: updated,
      warnings: pastDateWarnings(this.driverPapers(updated), dhakaToday()),
    };
  }

  async removeDriver(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.drivers.findByIdOrFail(id, actor.schoolId);
    const routes = await this.drivers.countRoutes(id);
    if (routes > 0) {
      throw new ConflictException(
        `${existing.name} is driving (or substituting on) ${routes} route(s) — reassign them first`,
      );
    }
    await this.drivers.softDelete(id);
    this.audit.set({
      entityType: 'Driver',
      entityId: id,
      oldValues: { name: existing.name },
    });
  }

  // ── the alerts widget (roadmap §5) ──────────────────────────────────

  /**
   * Everything whose papers are expired, expiring, or missing — the
   * dashboard widget and the nightly job read the SAME list, so the badge
   * and the message can never disagree (the M16/M23 single-verdict rule).
   */
  async alerts(schoolId: string, today = dhakaToday()) {
    const cfg = await this.config.load(schoolId);
    const [vehicles, drivers] = await Promise.all([
      this.vehicles.findAllLive(schoolId),
      this.drivers.findAllLive(schoolId),
    ]);

    const vehicleAlerts = vehicles
      .map((vehicle) => ({
        id: vehicle.id,
        kind: 'VEHICLE' as const,
        label: vehicle.regNo,
        status: vehicle.status,
        items: alertable(
          expiryItems(this.vehiclePapers(vehicle), today, cfg.expiryAlertDays),
        ),
      }))
      .filter((row) => row.items.length > 0);

    const driverAlerts = drivers
      .map((driver) => ({
        id: driver.id,
        kind: 'DRIVER' as const,
        label: driver.name,
        status: driver.status,
        items: alertable(
          expiryItems(this.driverPapers(driver), today, cfg.expiryAlertDays),
        ),
      }))
      .filter((row) => row.items.length > 0);

    return {
      windowDays: cfg.expiryAlertDays,
      vehicles: vehicleAlerts,
      drivers: driverAlerts,
      total: vehicleAlerts.length + driverAlerts.length,
    };
  }

  // ── internals ───────────────────────────────────────────────────────

  vehiclePapers(vehicle: Vehicle) {
    return [
      { kind: 'FITNESS' as const, expiry: isoOrNull(vehicle.fitnessExpiry) },
      { kind: 'TAX_TOKEN' as const, expiry: isoOrNull(vehicle.taxTokenExpiry) },
      {
        kind: 'INSURANCE' as const,
        expiry: isoOrNull(vehicle.insuranceExpiry),
      },
    ];
  }

  driverPapers(driver: Driver) {
    return [
      { kind: 'LICENSE' as const, expiry: isoOrNull(driver.licenseExpiry) },
    ];
  }

  private vehicleDocuments(
    vehicle: Vehicle,
    today: string,
    windowDays: number,
  ) {
    const documents = expiryItems(
      this.vehiclePapers(vehicle),
      today,
      windowDays,
    );
    return { documents, documentState: worstState(documents) };
  }

  private driverDocuments(driver: Driver, today: string, windowDays: number) {
    const documents = expiryItems(this.driverPapers(driver), today, windowDays);
    return { documents, documentState: worstState(documents) };
  }

  private async assertRegNoFree(
    regNo: string,
    schoolId: string,
    excludeId?: string,
  ): Promise<void> {
    const clash = await this.vehicles.findByRegNo(schoolId, regNo, excludeId);
    if (clash) {
      throw new ConflictException(
        `${normalizeRegNo(regNo)} is already on the fleet list`,
      );
    }
  }

  private async assertLicenseFree(
    licenseNo: string,
    schoolId: string,
    excludeId?: string,
  ): Promise<void> {
    const clash = await this.drivers.findByLicense(
      schoolId,
      licenseNo,
      excludeId,
    );
    if (clash) {
      throw new ConflictException(
        `Licence ${licenseNo.trim().toUpperCase()} belongs to ${clash.name}`,
      );
    }
  }

  private async assertStaffFree(
    staffId: string,
    schoolId: string,
    excludeId?: string,
  ): Promise<void> {
    const clash = await this.drivers.findByStaff(schoolId, staffId, excludeId);
    if (clash) {
      throw new ConflictException(
        `That employee is already on the driver list as ${clash.name}`,
      );
    }
  }
}

/** Status helpers the reports service reuses. */
export const ROADWORTHY_VEHICLE: VehicleStatus[] = [VehicleStatus.ACTIVE];
export const AVAILABLE_DRIVER: DriverStatus[] = [DriverStatus.ACTIVE];

function isoOrNull(value: Date | null): string | null {
  return value ? isoDate(value) : null;
}
