import { Injectable } from '@nestjs/common';
import { TransportReportsService } from '../../../transport/services/transport-reports.service';
import type { ReportTable } from '../../calc/types';
import {
  defaultWindow,
  str,
  type ReportContext,
  type ReportExecutor,
  type ReportExecutorProvider,
} from '../executor.types';

/** M25's four report shapes. */
@Injectable()
export class TransportReportExecutors implements ReportExecutorProvider {
  constructor(private readonly reports: TransportReportsService) {}

  executors(): Record<string, ReportExecutor> {
    return {
      'transport.roster': (ctx) => this.roster(ctx),
      'transport.expenses': (ctx) => this.expenses(ctx),
      'transport.utilization': (ctx) => this.utilization(ctx),
      'transport.collection': (ctx) => this.collection(ctx),
    };
  }

  private async roster(ctx: ReportContext): Promise<ReportTable> {
    const routeId = str(ctx.params, 'routeId');
    if (!routeId) throw new Error('routeId is required');
    const report = await this.reports.roster(routeId, ctx.schoolId);

    return {
      title: `Route roster — ${report.route.name}`,
      subtitle: [
        report.route.vehicleRegNo,
        report.route.driverName,
        report.route.driverPhone,
      ]
        .filter(Boolean)
        .join(' · '),
      columns: [
        { key: 'stopName', label: 'Stop', width: 22 },
        { key: 'pickupTime', label: 'Pickup' },
        { key: 'dropTime', label: 'Drop' },
        { key: 'studentUid', label: 'Student ID' },
        { key: 'studentName', label: 'Student', width: 26 },
        { key: 'className', label: 'Class' },
        { key: 'sectionName', label: 'Section' },
        { key: 'rollNo', label: 'Roll', type: 'number' },
        { key: 'guardianName', label: 'Guardian', width: 24 },
        { key: 'guardianPhone', label: 'Phone' },
        { key: 'status', label: 'Status' },
      ],
      rows: report.riders.map((rider) => ({ ...rider })),
      summary: [
        { label: 'Riders', value: report.riders.length },
        { label: 'Stops', value: report.stops.length },
        { label: 'Capacity', value: report.capacity.state },
      ],
      notes: [
        'Riders are listed in the order the bus drives, so the sheet reads as the driver works.',
      ],
    };
  }

  private async expenses(ctx: ReportContext): Promise<ReportTable> {
    const window = defaultWindow(ctx.params);
    const report = await this.reports.expenseSummary(ctx.schoolId, {
      vehicleId: str(ctx.params, 'vehicleId'),
      from: window.from,
      to: window.to,
    });

    return {
      title: `Vehicle expenses — ${window.from} to ${window.to}`,
      columns: [
        { key: 'regNo', label: 'Vehicle' },
        { key: 'total', label: 'Total spend', type: 'money' },
        { key: 'fuel', label: 'Fuel', type: 'money' },
        { key: 'km', label: 'Distance (km)', type: 'number' },
        { key: 'costPerKm', label: 'Cost per km', type: 'money' },
      ],
      rows: report.byVehicle.map((row) => ({ ...row })),
      summary: [
        { label: 'Total', value: report.summary.total },
        { label: 'Fuel', value: report.summary.fuelTotal },
      ],
      notes: [
        'Distance comes from the gaps between odometer readings; a backwards reading breaks the chain rather than going negative, so a vehicle with bad readings reports no cost per km at all.',
      ],
    };
  }

  private async utilization(ctx: ReportContext): Promise<ReportTable> {
    const report = await this.reports.utilization(ctx.schoolId);
    return {
      title: 'Capacity utilization',
      columns: [
        { key: 'routeName', label: 'Route', width: 26 },
        { key: 'vehicleRegNo', label: 'Vehicle' },
        { key: 'capacity', label: 'Seats', type: 'number' },
        { key: 'riders', label: 'Riders', type: 'number' },
        { key: 'utilization', label: 'Utilization', type: 'percent' },
        { key: 'state', label: 'State' },
        { key: 'expectedMonthly', label: 'Expected monthly', type: 'money' },
      ],
      rows: report.routes.map((row) => ({ ...row })),
      notes: [
        'A route with no vehicle reports UNKNOWN capacity, never a capacity of zero.',
      ],
    };
  }

  private async collection(ctx: ReportContext): Promise<ReportTable> {
    const report = await this.reports.collection(
      ctx.schoolId,
      str(ctx.params, 'month'),
    );
    return {
      title: `Transport fee collection — ${report.month}`,
      subtitle: report.feeHead?.name,
      columns: [
        { key: 'routeName', label: 'Route', width: 26 },
        { key: 'riders', label: 'Riders', type: 'number' },
        { key: 'expected', label: 'Expected', type: 'money' },
        { key: 'invoiced', label: 'Invoiced', type: 'money' },
        { key: 'collected', label: 'Collected', type: 'money' },
        { key: 'outstanding', label: 'Outstanding', type: 'money' },
      ],
      rows: report.routes.map((row) => ({ ...row })),
      summary: [
        { label: 'Riders', value: report.totals.riders },
        { label: 'Expected', value: report.totals.expected },
        { label: 'Invoiced', value: report.totals.invoiced },
        { label: 'Collected', value: report.totals.collected },
        { label: 'Outstanding', value: report.totals.outstanding },
      ],
      notes: [report.note],
    };
  }
}
