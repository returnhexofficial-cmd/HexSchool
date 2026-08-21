import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { RegisterReportQueryDto } from '../dto';
import { CertificateReportsService } from './certificate-reports.service';
import { dhakaDisplayDate } from '../../../common/utils/clock.util';

export interface ExportFile {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * The register as a file. The shapes come from `CertificateReportsService`,
 * so the sheet and the screen are the same rows (the M12 reports/export
 * split).
 *
 * The PDF is the one that gets signed and filed: a BD school's certificate
 * register is a **bound book** an inspector asks to see, so it prints in
 * issue order with the number first, and it prints the waiver and
 * revocation columns rather than hiding them — those are the rows an
 * inspection is actually looking for.
 */
@Injectable()
export class CertificateExportService {
  constructor(private readonly reports: CertificateReportsService) {}

  async registerXlsx(
    query: RegisterReportQueryDto,
    schoolId: string,
  ): Promise<ExportFile> {
    const report = await this.reports.register(query, schoolId);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Register');

    sheet.columns = [
      { header: 'Certificate no.', key: 'certificateNo', width: 20 },
      { header: 'Type', key: 'type', width: 16 },
      { header: 'Issued', key: 'issueDate', width: 13 },
      { header: 'Student', key: 'studentName', width: 28 },
      { header: 'Student ID', key: 'studentUid', width: 20 },
      { header: 'Class', key: 'className', width: 14 },
      { header: 'Session', key: 'session', width: 12 },
      { header: 'Kind', key: 'issueKind', width: 12 },
      { header: 'Of', key: 'originalNo', width: 18 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Clearance waived', key: 'clearanceWaived', width: 17 },
      { header: 'Pre-system', key: 'isLegacy', width: 12 },
      { header: 'Revoked because', key: 'revokedReason', width: 46 },
    ];
    sheet.getRow(1).font = { bold: true };

    for (const row of report.rows) {
      sheet.addRow({
        ...row,
        clearanceWaived: row.clearanceWaived ? 'YES' : '',
        isLegacy: row.isLegacy ? 'YES' : '',
        originalNo: row.originalNo ?? '',
        revokedReason: row.revokedReason ?? '',
      });
    }

    const totals = workbook.addWorksheet('Totals');
    totals.columns = [
      { header: 'Measure', key: 'measure', width: 26 },
      { header: 'Count', key: 'count', width: 12 },
    ];
    totals.getRow(1).font = { bold: true };
    totals.addRow({ measure: 'Window from', count: report.from });
    totals.addRow({ measure: 'Window to', count: report.to });
    totals.addRow({
      measure: 'Issued and standing',
      count: report.totals.issued,
    });
    totals.addRow({ measure: 'Revoked', count: report.totals.revoked });
    totals.addRow({ measure: 'Duplicates', count: report.totals.duplicates });
    totals.addRow({
      measure: 'Pre-system entries',
      count: report.totals.legacy,
    });

    return this.xlsx(workbook, 'certificate-register.xlsx');
  }

  async summaryXlsx(
    query: RegisterReportQueryDto,
    schoolId: string,
  ): Promise<ExportFile> {
    const report = await this.reports.summary(query, schoolId);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('By type');

    sheet.columns = [
      { header: 'Type', key: 'type', width: 20 },
      { header: 'Standing', key: 'issued', width: 12 },
      { header: 'Revoked', key: 'revoked', width: 12 },
      { header: 'Total', key: 'total', width: 12 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const row of report.byType) sheet.addRow(row);
    sheet.addRow({
      type: 'TOTAL',
      issued: report.totals.issued,
      revoked: report.totals.revoked,
      total: report.totals.total,
    }).font = { bold: true };

    return this.xlsx(workbook, 'certificate-summary.xlsx');
  }

  async registerPdf(
    query: RegisterReportQueryDto,
    schoolId: string,
  ): Promise<ExportFile> {
    const report = await this.reports.register(query, schoolId);
    // Landscape: the register has thirteen columns and a portrait page
    // truncates the one an inspector reads (why a certificate was revoked).
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 30,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    doc.fontSize(15).text('Certificate issuance register');
    doc.moveDown(0.3);
    doc
      .fontSize(9)
      .text(
        `${report.from} to ${report.to}   |   ${report.rows.length} entr${report.rows.length === 1 ? 'y' : 'ies'}   |   ${report.totals.issued} standing, ${report.totals.revoked} revoked, ${report.totals.duplicates} duplicate(s)   |   Printed ${dhakaDisplayDate(new Date())}`,
      );
    doc.moveDown(0.8);

    doc.fontSize(8);
    for (const row of report.rows) {
      const flags = [
        row.issueKind !== 'ORIGINAL' ? row.issueKind : '',
        row.clearanceWaived ? 'CLEARANCE WAIVED' : '',
        row.isLegacy ? 'PRE-SYSTEM' : '',
        row.status === 'REVOKED' ? 'REVOKED' : '',
      ].filter(Boolean);

      doc.text(
        `${row.issueDate}   ${row.certificateNo.padEnd(16)}  ${row.type.padEnd(14)}  ${row.studentName} (${row.studentUid})  ${row.className}${row.session ? ` / ${row.session}` : ''}${flags.length ? `   [${flags.join(' · ')}]` : ''}`,
      );
      if (row.revokedReason) {
        doc.fillColor('#b42318').text(`        revoked: ${row.revokedReason}`);
        doc.fillColor('#000000');
      }
      if (row.originalNo) {
        doc.text(`        of certificate ${row.originalNo}`);
      }
    }

    if (report.rows.length === 0) {
      doc.text('No certificates were issued in this window.');
    }

    doc.end();
    await new Promise((resolve) => doc.on('end', resolve));
    return {
      buffer: Buffer.concat(chunks),
      filename: 'certificate-register.pdf',
      contentType: 'application/pdf',
    };
  }

  private async xlsx(
    workbook: ExcelJS.Workbook,
    filename: string,
  ): Promise<ExportFile> {
    const buffer = await workbook.xlsx.writeBuffer();
    return { buffer: Buffer.from(buffer), filename, contentType: XLSX_TYPE };
  }
}
