import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { TransportReportsService } from './transport-reports.service';

export interface ExportFile {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Report files. The shapes come from `TransportReportsService`, so the
 * sheet and the screen are the same numbers (the M12 reports/export
 * split).
 *
 * The roster PDF is the one that leaves the office: it is what a driver
 * carries, so it is laid out as a **stop-by-stop list with phone numbers
 * beside the names** rather than as a table sorted by roll number — the
 * order the bus actually drives is the order the sheet has to read in.
 */
@Injectable()
export class TransportExportService {
  constructor(private readonly reports: TransportReportsService) {}

  async rosterXlsx(routeId: string, schoolId: string): Promise<ExportFile> {
    const roster = await this.reports.roster(routeId, schoolId);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Roster');
    sheet.columns = [
      { header: 'Stop', key: 'stopName', width: 22 },
      { header: 'Pickup', key: 'pickupTime', width: 10 },
      { header: 'Drop', key: 'dropTime', width: 10 },
      { header: 'Student ID', key: 'studentUid', width: 18 },
      { header: 'Student', key: 'studentName', width: 28 },
      { header: 'Class', key: 'className', width: 12 },
      { header: 'Section', key: 'sectionName', width: 12 },
      { header: 'Roll', key: 'rollNo', width: 8 },
      { header: 'Guardian', key: 'guardianName', width: 24 },
      { header: 'Phone', key: 'guardianPhone', width: 16 },
      { header: 'Monthly fee', key: 'monthlyFee', width: 14 },
      { header: 'Status', key: 'status', width: 12 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const rider of roster.riders) sheet.addRow(rider);
    return this.xlsx(workbook, `route-roster-${roster.route.name}.xlsx`);
  }

  async expensesXlsx(
    schoolId: string,
    filter: { vehicleId?: string; from?: string; to?: string },
  ): Promise<ExportFile> {
    const report = await this.reports.expenseSummary(schoolId, filter);
    const workbook = new ExcelJS.Workbook();

    const byVehicle = workbook.addWorksheet('By vehicle');
    byVehicle.columns = [
      { header: 'Vehicle', key: 'regNo', width: 24 },
      { header: 'Total (BDT)', key: 'total', width: 16 },
      { header: 'Fuel (BDT)', key: 'fuel', width: 16 },
      { header: 'Distance (km)', key: 'km', width: 16 },
      { header: 'Cost / km', key: 'costPerKm', width: 14 },
    ];
    byVehicle.getRow(1).font = { bold: true };
    for (const row of report.byVehicle) byVehicle.addRow(row);

    const monthly = workbook.addWorksheet('By month');
    monthly.columns = [
      { header: 'Month', key: 'month', width: 12 },
      { header: 'Total (BDT)', key: 'total', width: 16 },
      { header: 'Fuel (BDT)', key: 'fuel', width: 16 },
      { header: 'Entries', key: 'count', width: 10 },
    ];
    monthly.getRow(1).font = { bold: true };
    for (const point of report.series) monthly.addRow(point);

    return this.xlsx(workbook, 'transport-expenses.xlsx');
  }

  async utilizationXlsx(schoolId: string): Promise<ExportFile> {
    const report = await this.reports.utilization(schoolId);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Utilization');
    sheet.columns = [
      { header: 'Route', key: 'routeName', width: 28 },
      { header: 'Vehicle', key: 'vehicleRegNo', width: 22 },
      { header: 'Seats', key: 'capacity', width: 10 },
      { header: 'Riders', key: 'riders', width: 10 },
      { header: 'Utilization %', key: 'utilization', width: 14 },
      { header: 'State', key: 'state', width: 12 },
      { header: 'Expected monthly (BDT)', key: 'expectedMonthly', width: 22 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const row of report.routes) sheet.addRow(row);
    return this.xlsx(workbook, 'transport-utilization.xlsx');
  }

  async collectionXlsx(schoolId: string, month?: string): Promise<ExportFile> {
    const report = await this.reports.collection(schoolId, month);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Collection');
    sheet.columns = [
      { header: 'Route', key: 'routeName', width: 28 },
      { header: 'Riders', key: 'riders', width: 10 },
      { header: 'Expected', key: 'expected', width: 14 },
      { header: 'Invoiced', key: 'invoiced', width: 14 },
      { header: 'Collected', key: 'collected', width: 14 },
      { header: 'Outstanding', key: 'outstanding', width: 14 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const row of report.routes) sheet.addRow(row);
    sheet.addRow({ routeName: 'Total', ...report.totals });
    sheet.lastRow!.font = { bold: true };
    return this.xlsx(workbook, `transport-collection-${report.month}.xlsx`);
  }

  /** The sheet the driver carries. */
  async rosterPdf(routeId: string, schoolId: string): Promise<ExportFile> {
    const roster = await this.reports.roster(routeId, schoolId);
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    doc.fontSize(16).text(`Route: ${roster.route.name}`, { align: 'left' });
    doc.moveDown(0.3);
    doc
      .fontSize(9)
      .text(
        [
          `Vehicle: ${roster.route.vehicleRegNo ?? '—'}`,
          `Driver: ${roster.route.driverName ?? '—'} ${roster.route.driverPhone ?? ''}`.trim(),
          roster.route.substituteDriverName
            ? `Substitute: ${roster.route.substituteDriverName}`
            : null,
          `Helper: ${roster.route.helperName ?? '—'} ${roster.route.helperPhone ?? ''}`.trim(),
          `Window: ${roster.route.firstPickup ?? '—'} → ${roster.route.lastDrop ?? '—'}`,
          `Riders: ${roster.riders.length}${
            roster.capacity.capacity === null
              ? ''
              : ` of ${roster.capacity.capacity} seats`
          }`,
          `Printed: ${roster.generatedAt}`,
        ]
          .filter(Boolean)
          .join('   |   '),
      );
    doc.moveDown(0.8);

    // Grouped by stop, in the order the bus drives them.
    for (const stop of [...roster.stops].sort((a, b) =>
      a.stopName.localeCompare(b.stopName),
    )) {
      const riders = roster.riders.filter(
        (rider) => rider.stopName === stop.stopName,
      );
      if (riders.length === 0) continue;

      const times = riders[0];
      doc
        .fontSize(11)
        .text(
          `${stop.stopName}  (pickup ${times.pickupTime ?? '—'}, drop ${times.dropTime ?? '—'})  — ${riders.length} rider(s)`,
        );
      doc.moveDown(0.2);
      doc.fontSize(9);
      for (const rider of riders) {
        doc.text(
          `   ${rider.studentName}  ·  ${rider.className}${
            rider.sectionName ? ` ${rider.sectionName}` : ''
          } roll ${rider.rollNo}  ·  ${rider.guardianName ?? 'guardian not on file'} ${
            rider.guardianPhone ?? ''
          }`,
        );
      }
      doc.moveDown(0.5);
    }

    doc.end();
    await new Promise((resolve) => doc.on('end', resolve));
    return {
      buffer: Buffer.concat(chunks),
      filename: `route-roster-${roster.route.name}.pdf`,
      contentType: 'application/pdf',
    };
  }

  private async xlsx(
    workbook: ExcelJS.Workbook,
    filename: string,
  ): Promise<ExportFile> {
    const buffer = await workbook.xlsx.writeBuffer();
    return {
      buffer: Buffer.from(buffer),
      filename,
      contentType: XLSX_TYPE,
    };
  }
}
