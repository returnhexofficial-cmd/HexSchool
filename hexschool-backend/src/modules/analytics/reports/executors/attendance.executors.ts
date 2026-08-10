import { Injectable } from '@nestjs/common';
import { AttendanceReportsService } from '../../../attendance/services/attendance-reports.service';
import { AttendanceSettingsService } from '../../../attendance/services/attendance-settings.service';
import type { ReportRow, ReportTable } from '../../calc/types';
import {
  defaultWindow,
  str,
  type ReportContext,
  type ReportExecutor,
  type ReportExecutorProvider,
} from '../executor.types';

/**
 * M12's five report shapes, flattened to the one tabular contract the
 * engine renders.
 *
 * The flattening is the whole job of an executor and it is not
 * mechanical. `AttendanceReportsService` returns shapes built for a
 * *screen* — a monthly register is a student × day matrix, a daily report
 * carries both a section roll-up and (sometimes) a student list. A
 * spreadsheet is rectangular, so each executor picks the one grain the
 * sheet is actually about and says so in the title. Reaching into the
 * service for the numbers rather than re-querying is what keeps the sheet
 * and the screen showing the same figures (the M12 reports/export split,
 * applied across module boundaries).
 */
@Injectable()
export class AttendanceReportExecutors implements ReportExecutorProvider {
  constructor(
    private readonly reports: AttendanceReportsService,
    private readonly config: AttendanceSettingsService,
  ) {}

  executors(): Record<string, ReportExecutor> {
    return {
      'attendance.daily': (ctx) => this.daily(ctx),
      'attendance.monthly': (ctx) => this.monthly(ctx),
      'attendance.late': (ctx) => this.late(ctx),
      'attendance.summary': (ctx) => this.summary(ctx),
      'attendance.staff': (ctx) => this.staff(ctx),
    };
  }

  private async daily(ctx: ReportContext): Promise<ReportTable> {
    const date =
      str(ctx.params, 'date') ?? new Date().toISOString().slice(0, 10);
    const report = await this.reports.daily(
      { date, sectionId: str(ctx.params, 'sectionId') },
      ctx.schoolId,
    );

    const rows: ReportRow[] = report.sections.map((section) => ({
      className: section.className,
      sectionName: section.sectionName,
      enrolled: section.enrolled,
      marked: section.marked,
      present: section.counts.PRESENT,
      absent: section.counts.ABSENT,
      late: section.counts.LATE,
      halfDay: section.counts.HALF_DAY,
      leave: section.counts.LEAVE,
      percentage: section.percentage,
    }));

    return {
      title: `Daily attendance — ${report.date}`,
      subtitle: report.holiday.holiday
        ? `Holiday: ${report.holiday.title ?? report.holiday.reason ?? 'school closed'}`
        : undefined,
      columns: [
        { key: 'className', label: 'Class' },
        { key: 'sectionName', label: 'Section' },
        { key: 'enrolled', label: 'Enrolled', type: 'number' },
        { key: 'marked', label: 'Marked', type: 'number' },
        { key: 'present', label: 'Present', type: 'number' },
        { key: 'absent', label: 'Absent', type: 'number' },
        { key: 'late', label: 'Late', type: 'number' },
        { key: 'halfDay', label: 'Half day', type: 'number' },
        { key: 'leave', label: 'Leave', type: 'number' },
        { key: 'percentage', label: 'Attendance', type: 'percent' },
      ],
      rows,
      summary: [
        { label: 'Enrolled', value: report.totals.enrolled },
        { label: 'Marked', value: report.totals.marked },
        { label: 'Attendance', value: `${report.totals.percentage}%` },
      ],
      notes: [
        'A percentage counts present + late + half a half-day over the rows actually marked; holiday rows are removed from both sides.',
      ],
    };
  }

  private async monthly(ctx: ReportContext): Promise<ReportTable> {
    const sectionId = str(ctx.params, 'sectionId');
    const month = str(ctx.params, 'month');
    if (!sectionId || !month) {
      throw new Error('sectionId and month are required');
    }
    const register = await this.reports.monthly(
      { sectionId, month },
      ctx.schoolId,
    );

    // One column per working day, so the sheet is the register a class
    // teacher recognises rather than a long list of (student, day) pairs.
    const dayColumns = register.days.map((day) => ({
      key: `d${day}`,
      label: day.slice(8),
      width: 5,
    }));

    const rows: ReportRow[] = register.rows.map((row) => {
      const cells: ReportRow = {
        rollNo: row.rollNo,
        studentUid: row.studentUid,
        name: row.name,
      };
      for (const day of register.days) {
        cells[`d${day}`] = row.marks[day] ? row.marks[day].charAt(0) : '';
      }
      cells.present = row.summary.counts.PRESENT;
      cells.absent = row.summary.counts.ABSENT;
      cells.percentage = row.summary.percentage;
      return cells;
    });

    return {
      title: `Attendance register — ${register.section.className} ${register.section.name}, ${register.month}`,
      columns: [
        { key: 'rollNo', label: 'Roll', type: 'number', width: 6 },
        { key: 'studentUid', label: 'Student ID', width: 16 },
        { key: 'name', label: 'Name', width: 28 },
        ...dayColumns,
        { key: 'present', label: 'P', type: 'number', width: 6 },
        { key: 'absent', label: 'A', type: 'number', width: 6 },
        { key: 'percentage', label: '%', type: 'percent', width: 9 },
      ],
      rows,
      notes: [
        `Columns are the ${register.days.length} working days of the month — holidays and weekly off-days are not columns at all.`,
        'P present · A absent · L late · H half day · E leave.',
      ],
    };
  }

  private async late(ctx: ReportContext): Promise<ReportTable> {
    const month = str(ctx.params, 'month');
    if (!month) throw new Error('month is required');
    const cfg = await this.config.load(ctx.schoolId);
    const report = await this.reports.lateAnalysis(
      { month, sectionId: str(ctx.params, 'sectionId') },
      ctx.schoolId,
      cfg.lateAlertThreshold,
    );

    return {
      title: `Late analysis — ${report.month}`,
      columns: [
        { key: 'studentUid', label: 'Student ID' },
        { key: 'name', label: 'Name', width: 28 },
        { key: 'sectionName', label: 'Section' },
        { key: 'lateDays', label: 'Late days', type: 'number' },
        { key: 'flagged', label: 'Over threshold' },
        { key: 'dates', label: 'Dates', width: 40 },
      ],
      rows: report.rows.map((row) => ({
        studentUid: row.studentUid,
        name: row.name,
        sectionName: row.sectionName,
        lateDays: row.lateDays,
        flagged: row.flagged,
        dates: row.dates.join(', '),
      })),
      notes: [
        `The threshold is ${report.threshold} late marks in a month (attendance.late_alert_threshold).`,
      ],
    };
  }

  private async summary(ctx: ReportContext): Promise<ReportTable> {
    const window = defaultWindow(ctx.params);
    const report = await this.reports.summary(
      {
        sessionId: str(ctx.params, 'sessionId'),
        from: window.from,
        to: window.to,
      },
      ctx.schoolId,
    );

    return {
      title: `Attendance summary — ${report.from} to ${report.to}`,
      columns: [
        { key: 'className', label: 'Class' },
        { key: 'sectionName', label: 'Section' },
        { key: 'enrolled', label: 'Enrolled', type: 'number' },
        { key: 'marked', label: 'Marked', type: 'number' },
        { key: 'present', label: 'Present', type: 'number' },
        { key: 'absent', label: 'Absent', type: 'number' },
        { key: 'percentage', label: 'Attendance', type: 'percent' },
      ],
      rows: report.sections.map((section) => ({
        className: section.className,
        sectionName: section.sectionName,
        enrolled: section.enrolled,
        marked: section.marked,
        present: section.counts.PRESENT,
        absent: section.counts.ABSENT,
        percentage: section.percentage,
      })),
      summary: [
        { label: 'Working days', value: report.workingDays },
        { label: 'Overall', value: `${report.overall.percentage}%` },
      ],
    };
  }

  private async staff(ctx: ReportContext): Promise<ReportTable> {
    const month = str(ctx.params, 'month');
    if (!month) throw new Error('month is required');
    const report = await this.reports.staff({ month }, ctx.schoolId);

    return {
      title: `Staff attendance — ${report.month}`,
      columns: [
        { key: 'employeeId', label: 'Employee ID' },
        { key: 'name', label: 'Name', width: 28 },
        { key: 'personType', label: 'Type' },
        { key: 'present', label: 'Present', type: 'number' },
        { key: 'absent', label: 'Absent', type: 'number' },
        { key: 'late', label: 'Late', type: 'number' },
        { key: 'leave', label: 'Leave', type: 'number' },
        { key: 'percentage', label: 'Attendance', type: 'percent' },
      ],
      rows: report.rows.map((row) => ({
        employeeId: row.employeeId,
        name: row.name,
        personType: row.personType,
        present: row.summary.counts.PRESENT,
        absent: row.summary.counts.ABSENT,
        late: row.summary.counts.LATE,
        leave: row.summary.counts.LEAVE,
        percentage: row.summary.percentage,
      })),
      notes: [
        `Denominator: the ${report.days.length} working days of the month for staff.`,
      ],
    };
  }
}
