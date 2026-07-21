import { Injectable } from '@nestjs/common';
import { Workbook, type Worksheet } from 'exceljs';
import PDFDocument from 'pdfkit';
import { AttendanceStatus } from '../../../common/constants';
import type {
  AttendanceSummaryReport,
  DailyReport,
  LateAnalysisReport,
  MonthlyRegister,
  StaffMonthlyReport,
  StudentAttendanceReport,
} from './attendance-reports.service';

/** Single-letter codes for the register matrix (the printed convention). */
const STATUS_CODE: Record<AttendanceStatus, string> = {
  [AttendanceStatus.PRESENT]: 'P',
  [AttendanceStatus.ABSENT]: 'A',
  [AttendanceStatus.LATE]: 'L',
  [AttendanceStatus.LEAVE]: 'V',
  [AttendanceStatus.HALF_DAY]: 'H',
  [AttendanceStatus.HOLIDAY]: '—',
};

export interface ExportFile {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * XLSX + PDF renderers for the M12 reports. Kept apart from
 * `AttendanceReportsService` so the report shapes stay the JSON contract
 * the UI consumes and the file formats are pure presentation over them.
 * The PDF side is deliberately plain (tabular, portrait/landscape) —
 * the styled report engine arrives with M18.
 */
@Injectable()
export class AttendanceExportService {
  // ── monthly register ────────────────────────────────────────────────

  async monthlyXlsx(report: MonthlyRegister): Promise<ExportFile> {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet(`${report.month}`);
    const dayLabels = report.days.map((d) => d.slice(8));

    sheet.addRow([
      `${report.section.className} — Section ${report.section.name}`,
    ]);
    sheet.addRow([`Monthly attendance register · ${report.month}`]);
    sheet.addRow([]);
    sheet.addRow(['Roll', 'UID', 'Name', ...dayLabels, 'Present', '%']);

    for (const row of report.rows) {
      sheet.addRow([
        row.rollNo,
        row.studentUid,
        row.name,
        ...report.days.map((day) =>
          row.marks[day] ? STATUS_CODE[row.marks[day]] : '',
        ),
        row.summary.presentEquivalent,
        row.summary.percentage,
      ]);
    }
    this.autoFit(sheet, [8, 18, 28]);
    return this.xlsx(workbook, `attendance-register-${report.month}`);
  }

  async monthlyPdf(report: MonthlyRegister): Promise<ExportFile> {
    const dayLabels = report.days.map((d) => d.slice(8));
    return this.pdf(
      `attendance-register-${report.month}`,
      `${report.section.className} — Section ${report.section.name}`,
      `Monthly attendance register · ${report.month}`,
      ['Roll', 'Name', ...dayLabels, '%'],
      report.rows.map((row) => [
        String(row.rollNo),
        row.name,
        ...report.days.map((day) =>
          row.marks[day] ? STATUS_CODE[row.marks[day]] : '',
        ),
        String(row.summary.percentage),
      ]),
      true,
    );
  }

  // ── daily ───────────────────────────────────────────────────────────

  async dailyXlsx(report: DailyReport): Promise<ExportFile> {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Daily');
    sheet.addRow([`Daily attendance · ${report.date}`]);
    if (report.holiday.holiday) {
      sheet.addRow([`Holiday: ${report.holiday.title ?? 'yes'}`]);
    }
    sheet.addRow([]);
    sheet.addRow([
      'Class',
      'Section',
      'Enrolled',
      'Marked',
      'Present',
      'Absent',
      'Late',
      'Leave',
      'Half day',
      '%',
    ]);
    for (const row of report.sections) {
      sheet.addRow([
        row.className,
        row.sectionName,
        row.enrolled,
        row.marked,
        row.counts.PRESENT,
        row.counts.ABSENT,
        row.counts.LATE,
        row.counts.LEAVE,
        row.counts.HALF_DAY,
        row.percentage,
      ]);
    }

    if (report.students) {
      const detail = workbook.addWorksheet('Students');
      detail.addRow(['Roll', 'UID', 'Name', 'Status', 'Remarks']);
      for (const row of report.students) {
        detail.addRow([
          row.rollNo,
          row.studentUid,
          row.name,
          row.status ?? 'UNMARKED',
          row.remarks ?? '',
        ]);
      }
      this.autoFit(detail, [8, 18, 28, 12, 30]);
    }

    this.autoFit(sheet, [14, 10]);
    return this.xlsx(workbook, `attendance-daily-${report.date}`);
  }

  async dailyPdf(report: DailyReport): Promise<ExportFile> {
    return this.pdf(
      `attendance-daily-${report.date}`,
      `Daily attendance · ${report.date}`,
      report.holiday.holiday
        ? `Holiday: ${report.holiday.title ?? 'yes'}`
        : `${report.totals.marked} of ${report.totals.enrolled} students marked`,
      ['Class', 'Section', 'Enrolled', 'Marked', 'P', 'A', 'L', '%'],
      report.sections.map((row) => [
        row.className,
        row.sectionName,
        String(row.enrolled),
        String(row.marked),
        String(row.counts.PRESENT),
        String(row.counts.ABSENT),
        String(row.counts.LATE),
        String(row.percentage),
      ]),
    );
  }

  // ── per student ─────────────────────────────────────────────────────

  async studentXlsx(report: StudentAttendanceReport): Promise<ExportFile> {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Summary');
    sheet.addRow([report.student.name, report.student.studentUid]);
    sheet.addRow([`${report.from} → ${report.to}`]);
    sheet.addRow([]);
    sheet.addRow(['Working days', report.summary.workingDays]);
    sheet.addRow(['Present equivalent', report.summary.presentEquivalent]);
    sheet.addRow(['Attendance %', report.summary.percentage]);
    sheet.addRow([]);
    sheet.addRow(['Section', 'Class', 'Present', 'Absent', 'Late', '%']);
    for (const block of report.bySection) {
      sheet.addRow([
        block.sectionName,
        block.className,
        block.counts.PRESENT,
        block.counts.ABSENT,
        block.counts.LATE,
        block.percentage,
      ]);
    }

    const detail = workbook.addWorksheet('Days');
    detail.addRow(['Date', 'Status', 'Section', 'Remarks']);
    for (const entry of report.entries) {
      detail.addRow([
        entry.date,
        entry.status,
        entry.sectionName,
        entry.remarks ?? '',
      ]);
    }
    this.autoFit(sheet, [22, 18]);
    this.autoFit(detail, [14, 12, 14, 30]);
    return this.xlsx(
      workbook,
      `attendance-${report.student.studentUid}-${report.from}`,
    );
  }

  async studentPdf(report: StudentAttendanceReport): Promise<ExportFile> {
    return this.pdf(
      `attendance-${report.student.studentUid}-${report.from}`,
      `${report.student.name} (${report.student.studentUid})`,
      `${report.from} → ${report.to} · ${report.summary.percentage}% of ${report.summary.workingDays} working days`,
      ['Date', 'Status', 'Section', 'Remarks'],
      report.entries.map((entry) => [
        entry.date,
        entry.status,
        entry.sectionName,
        entry.remarks ?? '',
      ]),
    );
  }

  // ── staff ───────────────────────────────────────────────────────────

  async staffXlsx(report: StaffMonthlyReport): Promise<ExportFile> {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet(report.month);
    const dayLabels = report.days.map((d) => d.slice(8));
    sheet.addRow([`Staff attendance register · ${report.month}`]);
    sheet.addRow([]);
    sheet.addRow(['Employee ID', 'Name', 'Type', ...dayLabels, '%']);
    for (const row of report.rows) {
      sheet.addRow([
        row.employeeId,
        row.name,
        row.personType,
        ...report.days.map((day) =>
          row.marks[day] ? STATUS_CODE[row.marks[day]] : '',
        ),
        row.summary.percentage,
      ]);
    }
    this.autoFit(sheet, [16, 26, 10]);
    return this.xlsx(workbook, `attendance-staff-${report.month}`);
  }

  async staffPdf(report: StaffMonthlyReport): Promise<ExportFile> {
    return this.pdf(
      `attendance-staff-${report.month}`,
      `Staff attendance · ${report.month}`,
      `${report.rows.length} employees · ${report.days.length} working days`,
      ['Employee ID', 'Name', 'Type', 'Present', '%'],
      report.rows.map((row) => [
        row.employeeId,
        row.name,
        row.personType,
        String(row.summary.presentEquivalent),
        String(row.summary.percentage),
      ]),
    );
  }

  // ── summary + late analysis ─────────────────────────────────────────

  async summaryXlsx(report: AttendanceSummaryReport): Promise<ExportFile> {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Sections');
    sheet.addRow([`Attendance summary · ${report.from} → ${report.to}`]);
    sheet.addRow(['Working days', report.workingDays]);
    sheet.addRow(['Overall %', report.overall.percentage]);
    sheet.addRow([]);
    sheet.addRow(['Class', 'Section', 'Enrolled', 'Marked', '%']);
    for (const row of report.sections) {
      sheet.addRow([
        row.className,
        row.sectionName,
        row.enrolled,
        row.marked,
        row.percentage,
      ]);
    }

    const trend = workbook.addWorksheet('Trend');
    trend.addRow(['Date', '%']);
    for (const point of report.trend)
      trend.addRow([point.date, point.percentage]);

    this.autoFit(sheet, [16, 12]);
    this.autoFit(trend, [14, 10]);
    return this.xlsx(workbook, `attendance-summary-${report.from}`);
  }

  async summaryPdf(report: AttendanceSummaryReport): Promise<ExportFile> {
    return this.pdf(
      `attendance-summary-${report.from}`,
      'Attendance summary',
      `${report.from} → ${report.to} · overall ${report.overall.percentage}%`,
      ['Class', 'Section', 'Enrolled', 'Marked', '%'],
      report.sections.map((row) => [
        row.className,
        row.sectionName,
        String(row.enrolled),
        String(row.marked),
        String(row.percentage),
      ]),
    );
  }

  async lateAnalysisXlsx(report: LateAnalysisReport): Promise<ExportFile> {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Late');
    sheet.addRow([`Late analysis · ${report.month}`]);
    sheet.addRow([`Flag threshold: ${report.threshold} day(s)`]);
    sheet.addRow([]);
    sheet.addRow(['UID', 'Name', 'Section', 'Late days', 'Flagged', 'Dates']);
    for (const row of report.rows) {
      sheet.addRow([
        row.studentUid,
        row.name,
        row.sectionName,
        row.lateDays,
        row.flagged ? 'YES' : '',
        row.dates.join(', '),
      ]);
    }
    this.autoFit(sheet, [18, 26, 12, 12, 10, 40]);
    return this.xlsx(workbook, `attendance-late-${report.month}`);
  }

  async lateAnalysisPdf(report: LateAnalysisReport): Promise<ExportFile> {
    return this.pdf(
      `attendance-late-${report.month}`,
      `Late analysis · ${report.month}`,
      `Flag threshold: ${report.threshold} day(s)`,
      ['UID', 'Name', 'Section', 'Late days', 'Flagged'],
      report.rows.map((row) => [
        row.studentUid,
        row.name,
        row.sectionName,
        String(row.lateDays),
        row.flagged ? 'YES' : '',
      ]),
    );
  }

  // ── renderers ───────────────────────────────────────────────────────

  private async xlsx(
    workbook: Workbook,
    basename: string,
  ): Promise<ExportFile> {
    return {
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      filename: `${basename}.xlsx`,
      contentType: XLSX_TYPE,
    };
  }

  /** Minimal tabular PDF; `wide` switches to landscape for matrices. */
  private async pdf(
    basename: string,
    title: string,
    subtitle: string,
    headers: string[],
    rows: string[][],
    wide = false,
  ): Promise<ExportFile> {
    const doc = new PDFDocument({
      size: 'A4',
      layout: wide ? 'landscape' : 'portrait',
      margin: 32,
      info: { Title: title },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    doc.fontSize(14).text(title);
    doc.fontSize(9).fillColor('#555').text(subtitle);
    doc.moveDown(0.8).fillColor('#000');

    const usable = doc.page.width - 64;
    const colWidth = usable / headers.length;
    const writeRow = (cells: string[], bold: boolean) => {
      if (doc.y > doc.page.height - 48) doc.addPage();
      const top = doc.y;
      doc.fontSize(bold ? 8.5 : 8);
      cells.forEach((cell, index) => {
        doc.text(cell, 32 + index * colWidth, top, {
          width: colWidth - 4,
          ellipsis: true,
          lineBreak: false,
        });
      });
      doc.y = top + 13;
    };

    writeRow(headers, true);
    doc
      .moveTo(32, doc.y - 3)
      .lineTo(doc.page.width - 32, doc.y - 3)
      .strokeColor('#999')
      .stroke();
    for (const row of rows) writeRow(row, false);
    if (rows.length === 0) doc.fontSize(9).text('No data for this range.');

    doc.end();
    return {
      buffer: await done,
      filename: `${basename}.pdf`,
      contentType: 'application/pdf',
    };
  }

  private autoFit(sheet: Worksheet, widths: number[]): void {
    widths.forEach((width, index) => {
      sheet.getColumn(index + 1).width = width;
    });
    sheet.getRow(1).font = { bold: true };
  }
}
