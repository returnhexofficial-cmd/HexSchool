import { Injectable } from '@nestjs/common';
import { HostelReportsService } from '../../../hostel/services/hostel-reports.service';
import type { ReportRow, ReportTable } from '../../calc/types';
import {
  defaultWindow,
  str,
  type ReportContext,
  type ReportExecutor,
  type ReportExecutorProvider,
} from '../executor.types';

/**
 * M26's four report shapes.
 *
 * Occupancy is the interesting flattening: the service returns a
 * hostel → floor → room → bed tree, which is the right shape for the grid
 * and useless in a spreadsheet. The sheet is cut at the **room**, the
 * grain a warden actually acts on, with the hostel and floor as columns
 * so it still sorts and pivots. The bed list is not carried through —
 * thirty-two rows of "bed 3 is free" is not a report, it is the grid
 * printed out.
 */
@Injectable()
export class HostelReportExecutors implements ReportExecutorProvider {
  constructor(private readonly reports: HostelReportsService) {}

  executors(): Record<string, ReportExecutor> {
    return {
      'hostel.occupancy': (ctx) => this.occupancy(ctx),
      'hostel.residents': (ctx) => this.residents(ctx),
      'hostel.dues': (ctx) => this.dues(ctx),
      'hostel.mealoffs': (ctx) => this.mealOffs(ctx),
    };
  }

  private query(ctx: ReportContext) {
    return {
      hostelId: str(ctx.params, 'hostelId'),
      sessionId: str(ctx.params, 'sessionId'),
    };
  }

  private async occupancy(ctx: ReportContext): Promise<ReportTable> {
    const report = await this.reports.occupancy(
      { hostelId: str(ctx.params, 'hostelId') },
      ctx.schoolId,
    );

    const rows: ReportRow[] = [];
    for (const hostel of report.hostels) {
      for (const floor of hostel.floors) {
        for (const room of floor.rooms) {
          rows.push({
            hostelName: hostel.hostelName,
            hostelType: hostel.type,
            floor: floor.floor,
            roomNo: room.roomNo,
            roomType: room.type,
            roomStatus: room.status,
            monthlyFee: room.monthlyFee,
            beds: room.occupancy.total,
            occupied: room.occupancy.occupied,
            vacant: room.occupancy.vacant,
            maintenance: room.occupancy.maintenance,
            utilization: room.occupancy.utilization,
          });
        }
      }
    }

    return {
      title: 'Hostel occupancy',
      columns: [
        { key: 'hostelName', label: 'Hostel', width: 24 },
        { key: 'hostelType', label: 'Type' },
        { key: 'floor', label: 'Floor', type: 'number' },
        { key: 'roomNo', label: 'Room' },
        { key: 'roomType', label: 'Room type' },
        { key: 'roomStatus', label: 'Room status' },
        { key: 'monthlyFee', label: 'Seat rent', type: 'money' },
        { key: 'beds', label: 'Beds', type: 'number' },
        { key: 'occupied', label: 'Occupied', type: 'number' },
        { key: 'vacant', label: 'Vacant', type: 'number' },
        { key: 'maintenance', label: 'Out of service', type: 'number' },
        { key: 'utilization', label: 'Utilization', type: 'percent' },
      ],
      rows,
      summary: [
        { label: 'Beds', value: report.overall.total },
        { label: 'Occupied', value: report.overall.occupied },
        { label: 'Available tonight', value: report.overall.available },
        { label: 'Out of service', value: report.overall.maintenance },
        { label: 'Utilization', value: `${report.overall.utilization}%` },
      ],
      notes: [
        'A bed out of service is taken OUT of the utilization denominator — it is not a vacancy the school failed to fill.',
      ],
    };
  }

  private async residents(ctx: ReportContext): Promise<ReportTable> {
    const rows = await this.reports.residents(this.query(ctx), ctx.schoolId);
    return {
      title: 'Resident register',
      columns: [
        { key: 'studentUid', label: 'Student ID' },
        { key: 'studentName', label: 'Student', width: 26 },
        { key: 'className', label: 'Class' },
        { key: 'sectionName', label: 'Section' },
        { key: 'rollNo', label: 'Roll', type: 'number' },
        { key: 'hostelName', label: 'Hostel', width: 20 },
        { key: 'roomNo', label: 'Room' },
        { key: 'bedNo', label: 'Bed' },
        { key: 'status', label: 'Status' },
        { key: 'startDate', label: 'Since', type: 'date' },
        { key: 'monthlyFee', label: 'Seat rent', type: 'money' },
        { key: 'messPlan', label: 'Mess plan' },
        { key: 'guardianName', label: 'Guardian', width: 24 },
        { key: 'guardianPhone', label: 'Phone' },
      ],
      rows: rows.map((row) => ({ ...row })),
      summary: [{ label: 'Boarders', value: rows.length }],
    };
  }

  private async dues(ctx: ReportContext): Promise<ReportTable> {
    const rows = await this.reports.dues(this.query(ctx), ctx.schoolId);
    return {
      title: 'Resident fee dues',
      columns: [
        { key: 'studentUid', label: 'Student ID' },
        { key: 'studentName', label: 'Student', width: 26 },
        { key: 'className', label: 'Class' },
        { key: 'hostelName', label: 'Hostel', width: 20 },
        { key: 'roomNo', label: 'Room' },
        { key: 'bedNo', label: 'Bed' },
        { key: 'guardianPhone', label: 'Guardian phone' },
        { key: 'outstanding', label: 'Outstanding', type: 'money' },
      ],
      rows: rows.map((row) => ({ ...row })),
      summary: [
        {
          label: 'Boarders owing',
          value: rows.filter((r) => r.outstanding > 0).length,
        },
        {
          label: 'Total outstanding',
          value:
            Math.round(rows.reduce((sum, r) => sum + r.outstanding, 0) * 100) /
            100,
        },
      ],
      notes: [
        'Dues come from the same LedgerService read that blocks a vacate, so the two cannot disagree.',
      ],
    };
  }

  private async mealOffs(ctx: ReportContext): Promise<ReportTable> {
    const window = defaultWindow(ctx.params);
    const rows = await this.reports.mealOffSummary(
      {
        hostelId: str(ctx.params, 'hostelId'),
        from: window.from,
        to: window.to,
      },
      ctx.schoolId,
    );
    return {
      title: `Meal-off summary — ${window.from} to ${window.to}`,
      columns: [
        { key: 'studentUid', label: 'Student ID' },
        { key: 'studentName', label: 'Student', width: 26 },
        { key: 'hostelName', label: 'Hostel', width: 20 },
        { key: 'requested', label: 'Claims', type: 'number' },
        { key: 'approved', label: 'Approved', type: 'number' },
        { key: 'rejected', label: 'Rejected', type: 'number' },
        { key: 'daysRequested', label: 'Days claimed', type: 'number' },
        { key: 'daysApproved', label: 'Days credited', type: 'number' },
      ],
      rows: rows.map((row) => ({ ...row })),
      notes: [
        'A meal-off whose credit month passed without the school invoicing that month is not carried forward.',
      ],
    };
  }
}
