import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import type { ReportWindowDto } from '../dto';
import { CommunityReportsService } from './community-reports.service';

export interface ExportFile {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Report files. The shapes come from `CommunityReportsService`, so the
 * sheet and the screen are the same numbers (the M12 reports/export
 * split, and the M26/M27 precedent).
 *
 * The visitor register is the one that leaves the office — it is what an
 * inspector or a safeguarding review asks for — so it is laid out **in
 * arrival order**, with the auto-checkout flag as its own column. That
 * column is the honest part of the sheet: it says which departures the
 * school actually witnessed and which the system wrote at nine o'clock
 * because nobody signed out.
 */
@Injectable()
export class CommunityExportService {
  constructor(
    private readonly reports: CommunityReportsService,
    private readonly schools: SchoolsRepository,
  ) {}

  async ticketRegisterXlsx(
    query: ReportWindowDto,
    schoolId: string,
    includeSensitive: boolean,
  ): Promise<ExportFile> {
    const report = await this.reports.ticketRegister(
      query,
      schoolId,
      includeSensitive,
    );
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Tickets');

    sheet.columns = [
      { header: 'Ticket no', key: 'ticketNo', width: 18 },
      { header: 'Raised', key: 'createdAt', width: 20 },
      { header: 'Type', key: 'type', width: 12 },
      { header: 'Category', key: 'category', width: 14 },
      { header: 'Subject', key: 'subject', width: 46 },
      { header: 'From', key: 'from', width: 14 },
      { header: 'Priority', key: 'priority', width: 10 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Resolved', key: 'resolvedAt', width: 20 },
      { header: 'Rating', key: 'rating', width: 8 },
    ];
    sheet.getRow(1).font = { bold: true };

    for (const ticket of report.rows) {
      sheet.addRow({
        ticketNo: ticket.ticketNo,
        createdAt: ticket.createdAt
          .toISOString()
          .slice(0, 16)
          .replace('T', ' '),
        type: ticket.type,
        category: ticket.category,
        subject: ticket.subject,
        // The register never prints who raised an anonymous complaint,
        // because there is nothing on the row to print.
        from: ticket.raisedByType,
        priority: ticket.priority,
        status: ticket.status,
        resolvedAt: ticket.resolvedAt
          ? ticket.resolvedAt.toISOString().slice(0, 16).replace('T', ' ')
          : '',
        rating: ticket.satisfactionRating ?? '',
      });
    }

    if (report.excludesSensitive) {
      // Stated on the sheet, not only in the API shape: a "42 complaints"
      // figure that quietly omits the ones about staff is the kind of
      // number that ends up in a governors' pack meaning something else.
      sheet.addRow({});
      sheet.addRow({
        ticketNo:
          'Restricted complaints are not included — this export was run without `ticket.sensitive.view`.',
      });
    }

    return {
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      filename: `tickets-${report.from}-to-${report.to}.xlsx`,
      contentType: XLSX_TYPE,
    };
  }

  async ticketSummaryXlsx(
    query: ReportWindowDto,
    schoolId: string,
    includeSensitive: boolean,
  ): Promise<ExportFile> {
    const report = await this.reports.ticketSummary(
      query,
      schoolId,
      includeSensitive,
    );
    const workbook = new ExcelJS.Workbook();

    const summary = workbook.addWorksheet('Summary');
    summary.columns = [
      { header: 'Measure', key: 'measure', width: 34 },
      { header: 'Value', key: 'value', width: 16 },
    ];
    summary.getRow(1).font = { bold: true };
    for (const [measure, value] of [
      ['Tickets raised', report.total],
      ['Resolved', report.resolution.resolved],
      ['Average resolution (hours)', report.resolution.avgResolutionHours],
      [
        'Average first response (hours)',
        report.resolution.avgFirstResponseHours,
      ],
      ['Within SLA', report.resolution.withinSla],
      ['SLA compliance %', report.resolution.slaCompliancePercent],
      ['Past SLA right now', report.breachedNow],
      ['Rated', report.satisfaction.rated],
      ['Average rating', report.satisfaction.average],
      [
        'Restricted complaints included',
        report.excludesSensitive ? 'No' : 'Yes',
      ],
    ] as Array<[string, string | number]>) {
      summary.addRow({ measure, value });
    }

    const breakdown = workbook.addWorksheet('Breakdown');
    breakdown.columns = [
      { header: 'Dimension', key: 'dimension', width: 14 },
      { header: 'Value', key: 'value', width: 20 },
      { header: 'Count', key: 'count', width: 10 },
    ];
    breakdown.getRow(1).font = { bold: true };
    for (const row of report.byCategory) {
      breakdown.addRow({
        dimension: 'Category',
        value: row.category,
        count: row.count,
      });
    }
    for (const row of report.byStatus) {
      breakdown.addRow({
        dimension: 'Status',
        value: row.status,
        count: row.count,
      });
    }
    for (const row of report.byPriority) {
      breakdown.addRow({
        dimension: 'Priority',
        value: row.priority,
        count: row.count,
      });
    }

    return {
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      filename: `ticket-summary-${report.from}-to-${report.to}.xlsx`,
      contentType: XLSX_TYPE,
    };
  }

  async visitorRegisterXlsx(
    query: ReportWindowDto,
    schoolId: string,
  ): Promise<ExportFile> {
    const report = await this.reports.visitorRegister(query, schoolId);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Visitors');

    sheet.columns = [
      { header: 'Name', key: 'name', width: 26 },
      { header: 'Phone', key: 'phone', width: 16 },
      { header: 'Purpose', key: 'purpose', width: 18 },
      { header: 'To meet', key: 'whomToMeet', width: 24 },
      { header: 'Gate pass', key: 'gatePassNo', width: 16 },
      { header: 'In', key: 'checkIn', width: 20 },
      { header: 'Out', key: 'checkOut', width: 20 },
      { header: 'Minutes', key: 'minutes', width: 10 },
      { header: 'Signed out by', key: 'by', width: 16 },
    ];
    sheet.getRow(1).font = { bold: true };

    for (const row of report.rows) {
      sheet.addRow({
        ...row,
        checkIn: row.checkIn.toISOString().slice(0, 16).replace('T', ' '),
        checkOut: row.checkOut
          ? row.checkOut.toISOString().slice(0, 16).replace('T', ' ')
          : 'Still inside',
        whomToMeet: row.whomToMeet ?? '',
        gatePassNo: row.gatePassNo ?? '',
        // The honest column: who actually witnessed the departure.
        by: row.checkOut ? (row.autoCheckedOut ? 'Day-end sweep' : 'Gate') : '',
      });
    }

    return {
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      filename: `visitors-${report.from}-to-${report.to}.xlsx`,
      contentType: XLSX_TYPE,
    };
  }

  /** The register a warden or an inspector carries. A4 portrait. */
  async visitorRegisterPdf(
    query: ReportWindowDto,
    schoolId: string,
  ): Promise<ExportFile> {
    const [report, school] = await Promise.all([
      this.reports.visitorRegister(query, schoolId),
      this.schools.findByIdOrFail(schoolId),
    ]);

    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .text(school.name, { align: 'center' });
    doc
      .fontSize(10)
      .font('Helvetica')
      .text(`Visitor register — ${report.from} to ${report.to}`, {
        align: 'center',
      });
    doc.moveDown(0.5);
    doc
      .fontSize(9)
      .text(
        `${report.stats.total} visit(s) · ${report.stats.inside} still inside · average stay ${report.stats.avgStayMinutes} min · ${report.stats.autoCheckedOut} signed out by the day-end sweep`,
        { align: 'center' },
      );
    doc.moveDown(1);

    const cols = [
      { label: 'Name', x: 36, w: 110 },
      { label: 'Phone', x: 146, w: 76 },
      { label: 'Purpose', x: 222, w: 90 },
      { label: 'To meet', x: 312, w: 100 },
      { label: 'In', x: 412, w: 70 },
      { label: 'Out', x: 482, w: 78 },
    ];

    let y = doc.y;
    doc.fontSize(8).font('Helvetica-Bold');
    for (const col of cols) doc.text(col.label, col.x, y, { width: col.w });
    y += 14;
    doc
      .moveTo(36, y - 3)
      .lineTo(560, y - 3)
      .stroke();

    doc.font('Helvetica');
    for (const row of report.rows) {
      if (y > 780) {
        doc.addPage();
        y = 40;
      }
      const values = [
        row.name,
        row.phone,
        row.purpose,
        row.whomToMeet ?? '—',
        row.checkIn.toISOString().slice(11, 16),
        row.checkOut
          ? `${row.checkOut.toISOString().slice(11, 16)}${row.autoCheckedOut ? '*' : ''}`
          : 'inside',
      ];
      cols.forEach((col, i) => {
        doc.text(values[i], col.x, y, { width: col.w, ellipsis: true });
      });
      y += 13;
    }

    doc.moveDown(2);
    doc
      .fontSize(7)
      .fillColor('#555')
      .text(
        '* signed out by the day-end sweep — the school did not witness this departure.',
        36,
        Math.min(y + 10, 800),
      );

    doc.end();
    return {
      buffer: await done,
      filename: `visitor-register-${report.from}-to-${report.to}.pdf`,
      contentType: 'application/pdf',
    };
  }

  async donationRegisterXlsx(
    query: ReportWindowDto,
    schoolId: string,
  ): Promise<ExportFile> {
    const report = await this.reports.donationRegister(query, schoolId);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Donations');

    sheet.columns = [
      { header: 'Receipt no', key: 'receiptNo', width: 18 },
      { header: 'Date', key: 'receivedAt', width: 14 },
      { header: 'Donor', key: 'donorName', width: 28 },
      { header: 'Amount', key: 'amount', width: 14 },
      { header: 'Method', key: 'method', width: 16 },
      { header: 'Purpose', key: 'purpose', width: 28 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Cancelled because', key: 'cancelledReason', width: 34 },
    ];
    sheet.getRow(1).font = { bold: true };

    for (const row of report.rows) {
      sheet.addRow({
        receiptNo: row.receiptNo,
        receivedAt: row.receivedAt.toISOString().slice(0, 10),
        donorName: row.donorName,
        amount: Number(row.amount),
        method: row.method,
        purpose: row.purpose ?? '',
        // A cancelled receipt stays in the register (roadmap §6) and says
        // so, rather than vanishing and leaving a gap in the numbering
        // that nobody can explain.
        status: row.cancelledAt ? 'CANCELLED' : 'Received',
        cancelledReason: row.cancelledReason ?? '',
      });
    }

    return {
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      filename: `donations-${report.from}-to-${report.to}.xlsx`,
      contentType: XLSX_TYPE,
    };
  }

  async donationSummaryXlsx(
    query: ReportWindowDto,
    schoolId: string,
  ): Promise<ExportFile> {
    const report = await this.reports.donationSummary(query, schoolId);
    const workbook = new ExcelJS.Workbook();

    const summary = workbook.addWorksheet('Summary');
    summary.columns = [
      { header: 'Measure', key: 'measure', width: 30 },
      { header: 'Value', key: 'value', width: 16 },
    ];
    summary.getRow(1).font = { bold: true };
    for (const [measure, value] of [
      ['Receipts', report.totals.received],
      ['Total raised', report.totals.total],
      ['From alumni', report.totals.fromAlumniAmount],
      ['Largest gift', report.totals.largest],
      ['Average gift', report.totals.average],
      ['Cancelled receipts', report.totals.cancelled],
      ['Cancelled value', report.totals.cancelledAmount],
    ] as Array<[string, number]>) {
      summary.addRow({ measure, value });
    }

    for (const [name, rows] of [
      ['By purpose', report.byPurpose],
      ['By method', report.byMethod],
      ['By month', report.byMonth],
    ] as const) {
      const sheet = workbook.addWorksheet(name);
      sheet.columns = [
        { header: name, key: 'label', width: 30 },
        { header: 'Receipts', key: 'count', width: 12 },
        { header: 'Amount', key: 'amount', width: 16 },
        { header: 'Share %', key: 'percent', width: 12 },
      ];
      sheet.getRow(1).font = { bold: true };
      for (const row of rows) sheet.addRow(row);
    }

    const donors = workbook.addWorksheet('Top donors');
    donors.columns = [
      { header: 'Donor', key: 'name', width: 30 },
      { header: 'Gifts', key: 'count', width: 10 },
      { header: 'Total', key: 'amount', width: 16 },
    ];
    donors.getRow(1).font = { bold: true };
    for (const donor of report.topDonors) donors.addRow(donor);

    return {
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      filename: `donation-summary-${report.from}-to-${report.to}.xlsx`,
      contentType: XLSX_TYPE,
    };
  }

  async alumniDirectoryXlsx(schoolId: string): Promise<ExportFile> {
    const report = await this.reports.alumniDirectory(schoolId);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Alumni');

    sheet.columns = [
      { header: 'Name', key: 'name', width: 28 },
      { header: 'Batch', key: 'batchYear', width: 10 },
      { header: 'Last class', key: 'lastClass', width: 14 },
      { header: 'Profession', key: 'profession', width: 24 },
      { header: 'Organization', key: 'organization', width: 28 },
      { header: 'Phone', key: 'phone', width: 16 },
      { header: 'Email', key: 'email', width: 28 },
      { header: 'Public profile', key: 'isPublicProfile', width: 14 },
    ];
    sheet.getRow(1).font = { bold: true };

    // This sheet DOES carry contacts — unlike the public directory, which
    // never does. It is gated behind `alumni.export`, and the whole point
    // of the school's own copy is that the office can ring people.
    for (const row of report.rows) {
      sheet.addRow({
        name: row.name,
        batchYear: row.batchYear,
        lastClass: row.lastClass ?? '',
        profession: row.profession ?? '',
        organization: row.organization ?? '',
        phone: row.phone ?? '',
        email: row.email ?? '',
        isPublicProfile: row.isPublicProfile ? 'Yes' : 'No',
      });
    }

    return {
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      filename: 'alumni-directory.xlsx',
      contentType: XLSX_TYPE,
    };
  }
}
