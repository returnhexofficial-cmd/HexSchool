import { Injectable, NotFoundException } from '@nestjs/common';
import { TransportAssignmentStatus } from '../../../common/constants';
import {
  dhakaToday,
  timeColumnMinutes,
} from '../../../common/utils/clock.util';
import { parseDate } from '../../academic/calendar/date.util';
import {
  capacityStatus,
  fleetUtilization,
  stopLoads,
  type CapacityStatus,
} from '../calc/capacity.engine';
import {
  monthlySeries,
  summarizeExpenses,
  type ExpenseSummary,
  type MonthlyExpensePoint,
} from '../calc/expense.engine';
import { formatClock, routeWindow } from '../calc/route-plan.util';
import { expectedMonthlyRevenue } from '../calc/transport-fee.engine';
import { money } from '../../fee/calc/money.util';
import { RoutesRepository } from '../repositories/routes.repository';
import { TransportAssignmentsRepository } from '../repositories/transport-assignments.repository';
import {
  TransportBillingRepository,
  type BilledTransport,
} from '../repositories/transport-billing.repository';
import { VehicleExpensesRepository } from '../repositories/vehicle-expenses.repository';
import { VehiclesRepository } from '../repositories/fleet.repository';
import { TransportSettingsService } from './transport-settings.service';

export interface RosterRider {
  assignmentId: string;
  studentUid: string;
  studentName: string;
  className: string;
  sectionName: string | null;
  rollNo: number;
  stopName: string;
  pickupTime: string | null;
  dropTime: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  monthlyFee: number;
  status: TransportAssignmentStatus;
  remarks: string | null;
}

export interface RouteRoster {
  route: {
    id: string;
    name: string;
    vehicleRegNo: string | null;
    driverName: string | null;
    driverPhone: string | null;
    substituteDriverName: string | null;
    helperName: string | null;
    helperPhone: string | null;
    firstPickup: string | null;
    lastDrop: string | null;
  };
  capacity: CapacityStatus;
  stops: Array<{ stopId: string; stopName: string; riders: number }>;
  riders: RosterRider[];
  generatedAt: string;
}

export interface UtilizationReport {
  fleet: ReturnType<typeof fleetUtilization>;
  routes: Array<{
    routeId: string;
    routeName: string;
    vehicleRegNo: string | null;
    capacity: number | null;
    riders: number;
    utilization: number | null;
    state: CapacityStatus['state'];
    expectedMonthly: number;
  }>;
}

export interface CollectionReport {
  month: string;
  feeHead: { id: string; name: string } | null;
  routes: Array<{
    routeId: string;
    routeName: string;
    riders: number;
    expected: number;
    invoiced: number;
    collected: number;
    outstanding: number;
  }>;
  totals: {
    riders: number;
    expected: number;
    invoiced: number;
    collected: number;
    outstanding: number;
  };
  note: string;
}

/**
 * The four reports roadmap §4 asks for. The reports/export split is
 * M12's: the JSON shapes live here and `TransportExportService` renders
 * them, so the spreadsheet, the PDF and the screen are the same numbers
 * rather than three queries that drift apart.
 */
@Injectable()
export class TransportReportsService {
  constructor(
    private readonly routes: RoutesRepository,
    private readonly assignments: TransportAssignmentsRepository,
    private readonly expenses: VehicleExpensesRepository,
    private readonly vehicles: VehiclesRepository,
    private readonly billing: TransportBillingRepository,
    private readonly config: TransportSettingsService,
  ) {}

  /**
   * The driver's sheet: who boards where, and the phone to ring when a
   * child is not at the stop. **Guardian phones are the point of this
   * report** — a driver with a list of names and no numbers has a list.
   */
  async roster(routeId: string, schoolId: string): Promise<RouteRoster> {
    const route = await this.routes.findDetail(routeId, schoolId);
    if (!route) throw new NotFoundException(`Route ${routeId} not found`);

    const riders = await this.assignments.findAllFor(schoolId, { routeId });
    const live = riders.filter(
      (rider) => rider.status !== TransportAssignmentStatus.ENDED,
    );
    const phones = await this.assignments.guardianPhones(
      live.map((rider) => rider.enrollment.student.id),
    );
    const byStop = await this.routes.riderCountsByStop(routeId);

    return {
      route: {
        id: route.id,
        name: route.name,
        vehicleRegNo: route.vehicle?.regNo ?? null,
        driverName: route.driver?.name ?? null,
        driverPhone: route.driver?.phone ?? null,
        substituteDriverName: route.substituteDriver?.name ?? null,
        helperName: route.helperName,
        helperPhone: route.helperPhone,
        ...routeWindow(
          route.stops.map((stop) => ({
            id: stop.id,
            name: stop.name,
            displayOrder: stop.displayOrder,
            pickupTime: clock(stop.pickupTime),
            dropTime: clock(stop.dropTime),
          })),
        ),
      },
      capacity: capacityStatus({
        capacity: route.vehicle?.capacity ?? null,
        assigned: live.length,
      }),
      stops: stopLoads(
        route.stops.map((stop) => ({
          id: stop.id,
          name: stop.name,
          displayOrder: stop.displayOrder,
        })),
        byStop,
      ),
      riders: live.map((rider) => {
        const guardian = phones.get(rider.enrollment.student.id);
        return {
          assignmentId: rider.id,
          studentUid: rider.enrollment.student.studentUid,
          studentName:
            `${rider.enrollment.student.firstName} ${rider.enrollment.student.lastName}`.trim(),
          className: rider.enrollment.class.name,
          sectionName: rider.enrollment.section?.name ?? null,
          rollNo: rider.enrollment.rollNo,
          stopName: rider.stop.name,
          pickupTime: clock(rider.stop.pickupTime),
          dropTime: clock(rider.stop.dropTime),
          guardianName: guardian?.name ?? null,
          guardianPhone: guardian?.phone ?? null,
          monthlyFee: Number(rider.stop.monthlyFee),
          status: rider.status,
          remarks: rider.remarks,
        };
      }),
      generatedAt: dhakaToday(),
    };
  }

  /** Roadmap §4's "vehicle expense summary (per km if odometer)". */
  async expenseSummary(
    schoolId: string,
    filter: { vehicleId?: string; from?: string; to?: string },
  ): Promise<{
    summary: ExpenseSummary;
    series: MonthlyExpensePoint[];
    byVehicle: Array<{
      vehicleId: string;
      regNo: string;
      total: number;
      fuel: number;
      km: number;
      costPerKm: number | null;
    }>;
  }> {
    const rows = await this.expenses.findAllFor(schoolId, {
      vehicleId: filter.vehicleId,
      from: filter.from ? parseDate(filter.from) : undefined,
      to: filter.to ? parseDate(filter.to) : undefined,
    });

    const asEngineRows = rows.map((row) => ({
      date: row.date.toISOString().slice(0, 10),
      type: row.type,
      amount: Number(row.amount),
      odometer: row.odometer,
      vehicleId: row.vehicleId,
    }));

    const vehicles = await this.vehicles.findAllLive(schoolId);
    const byVehicle = vehicles
      .map((vehicle) => {
        const forVehicle = asEngineRows.filter(
          (row) => row.vehicleId === vehicle.id,
        );
        const summary = summarizeExpenses(forVehicle);
        return {
          vehicleId: vehicle.id,
          regNo: vehicle.regNo,
          total: summary.total,
          fuel: summary.fuelTotal,
          km: summary.distance.km,
          costPerKm: summary.totalCostPerKm,
        };
      })
      .filter((row) => row.total > 0)
      .sort((a, b) => b.total - a.total);

    return {
      summary: summarizeExpenses(asEngineRows),
      series: monthlySeries(
        asEngineRows,
        filter.from && filter.to
          ? { from: filter.from, to: filter.to }
          : undefined,
      ),
      byVehicle,
    };
  }

  /** Roadmap §4's "capacity utilization". */
  async utilization(schoolId: string): Promise<UtilizationReport> {
    const routes = await this.routes.findMany(schoolId, {});
    const riders = await this.routes.riderCounts(schoolId);

    const rows = routes.map((route) => {
      const assigned = riders.get(route.id) ?? 0;
      const status = capacityStatus({
        capacity: route.vehicle?.capacity ?? null,
        assigned,
      });
      return {
        routeId: route.id,
        routeName: route.name,
        vehicleRegNo: route.vehicle?.regNo ?? null,
        capacity: status.capacity,
        riders: assigned,
        utilization: status.utilization,
        state: status.state,
        expectedMonthly: 0,
      };
    });

    // Expected revenue is per rider at their own stop's fare, which is
    // why it cannot be derived from the route: two children on one bus
    // pay different amounts depending on how far they travel.
    for (const row of rows) {
      const live = await this.assignments.findAllFor(schoolId, {
        routeId: row.routeId,
      });
      row.expectedMonthly = expectedMonthlyRevenue(
        live
          .filter((rider) => rider.status !== TransportAssignmentStatus.ENDED)
          .map((rider) => Number(rider.stop.monthlyFee)),
      );
    }

    return {
      fleet: fleetUtilization(
        routes.map((route) => ({
          capacity: route.vehicle?.capacity ?? null,
          assigned: riders.get(route.id) ?? 0,
        })),
      ),
      routes: rows,
    };
  }

  /**
   * Roadmap §4's "fee collection vs assigned".
   *
   * `expected` is what the riders on the route should be paying this
   * month at their stops' fares; `invoiced` is what M16 actually billed;
   * `collected` is the transport share of what came in. The three differ
   * for real reasons — a rider assigned after the batch ran is expected
   * but not invoiced — and showing them side by side is the point.
   */
  async collection(
    schoolId: string,
    month?: string,
  ): Promise<CollectionReport> {
    const cfg = await this.config.load(schoolId);
    const target = month ?? dhakaToday().slice(0, 7);
    const head = await this.billing.resolveFeeHead(
      schoolId,
      cfg.feeHeadId,
      cfg.feeHeadName,
    );

    const routes = await this.routes.findMany(schoolId, {});
    const billed = head
      ? await this.billing.billedForMonth(
          schoolId,
          head.id,
          parseDate(`${target}-01`),
        )
      : new Map<string, BilledTransport>();

    const rows: CollectionReport['routes'] = [];
    for (const route of routes) {
      const riders = (
        await this.assignments.findAllFor(schoolId, { routeId: route.id })
      ).filter((rider) => rider.status !== TransportAssignmentStatus.ENDED);

      let invoiced = 0;
      let collected = 0;
      for (const rider of riders) {
        const row = billed.get(rider.enrollmentId);
        if (!row) continue;
        invoiced = money(invoiced + row.invoiced);
        collected = money(collected + row.collected);
      }

      rows.push({
        routeId: route.id,
        routeName: route.name,
        riders: riders.length,
        expected: expectedMonthlyRevenue(
          riders.map((rider) => Number(rider.stop.monthlyFee)),
        ),
        invoiced,
        collected,
        outstanding: money(invoiced - collected),
      });
    }

    const totals = rows.reduce(
      (sum, row) => ({
        riders: sum.riders + row.riders,
        expected: money(sum.expected + row.expected),
        invoiced: money(sum.invoiced + row.invoiced),
        collected: money(sum.collected + row.collected),
        outstanding: money(sum.outstanding + row.outstanding),
      }),
      { riders: 0, expected: 0, invoiced: 0, collected: 0, outstanding: 0 },
    );

    return {
      month: target,
      feeHead: head,
      routes: rows,
      totals,
      note: head
        ? 'Money is collected against an invoice, never against one line of it, so the transport share of a part-paid bill is attributed pro rata.'
        : `No fee head called "${cfg.feeHeadName}" exists yet, so nothing has been billed for transport. Create one under Fees → Setup, or point transport.fee_head_id at an existing head.`,
    };
  }
}

function clock(value: Date | null): string | null {
  return value === null ? null : formatClock(timeColumnMinutes(value));
}
