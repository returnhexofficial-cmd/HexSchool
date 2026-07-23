import { Injectable } from '@nestjs/common';
import { Workbook } from 'exceljs';
import PDFDocument from 'pdfkit';
import { formatMoney } from '../calc/money.util';
import type {
  DailyCollection,
  DuesReport,
  HeadWiseIncome,
} from './fee-reports.service';
import type { InvoiceDetail } from '../repositories/invoices.repository';
import type { PaymentWithRelations } from '../repositories/payments.repository';

export interface ExportFile {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface ReceiptContext {
  schoolName: string;
  schoolAddress: string | null;
  footer: string;
}

/**
 * Printable money artifacts: the receipt handed across the counter, the
 * invoice sent home, and the report files.
 *
 * Pure presentation over the shapes `FeeReportsService` produces (the
 * M12 split). Deliberately plain — the branded report engine arrives
 * with M18, and pdfkit's default font cannot set Bangla, the same
 * limitation flagged for M09 ID cards and M13/M14/M15 output.
 *
 * The receipt has two layouts because a school desk has two printers: a
 * **thermal** 80 mm roll for the queue, and **A5** for anything filed.
 */
@Injectable()
export class FeeExportService {
  // ── receipt ─────────────────────────────────────────────────────────

  async receiptPdf(
    payment: PaymentWithRelations,
    context: ReceiptContext,
    layout: 'thermal' | 'a5' = 'a5',
  ): Promise<ExportFile> {
    const doc =
      layout === 'thermal'
        ? new PDFDocument({
            // 80 mm roll, continuous — height is generous and the page
            // simply ends where the content does.
            size: [226, 600],
            margin: 12,
            info: { Title: `Receipt ${payment.paymentNo}` },
          })
        : new PDFDocument({
            size: 'A5',
            margin: 30,
            info: { Title: `Receipt ${payment.paymentNo}` },
          });

    const chunks: Buffer[] = [];
    const done = this.collect(doc, chunks);
    const narrow = layout === 'thermal';
    const student = payment.invoice.enrollment.student;

    doc
      .fontSize(narrow ? 11 : 15)
      .font('Helvetica-Bold')
      .text(context.schoolName, { align: 'center' });
    if (context.schoolAddress && !narrow) {
      doc
        .fontSize(8)
        .font('Helvetica')
        .fillColor('#555')
        .text(context.schoolAddress, { align: 'center' });
    }
    doc
      .moveDown(0.3)
      .fillColor('#000')
      .fontSize(narrow ? 9 : 11)
      .font('Helvetica-Bold')
      .text('MONEY RECEIPT', { align: 'center' });
    doc.moveDown(0.5);

    const line = (label: string, value: string) => {
      doc
        .fontSize(narrow ? 7.5 : 9)
        .font('Helvetica')
        .text(`${label}: ${value}`);
    };

    line('Receipt No', payment.paymentNo);
    line(
      'Date',
      (payment.paidAt ?? payment.createdAt).toISOString().slice(0, 10),
    );
    line('Student', `${student.firstName} ${student.lastName}`.trim());
    line('Student ID', student.studentUid);
    line(
      'Class',
      `${payment.invoice.enrollment.class.name} — ${payment.invoice.enrollment.section.name} · Roll ${payment.invoice.enrollment.rollNo}`,
    );
    line('Invoice', payment.invoice.invoiceNo);
    line('Method', payment.method);
    if (payment.reference) line('Reference', payment.reference);

    doc.moveDown(0.5);
    doc
      .fontSize(narrow ? 11 : 14)
      .font('Helvetica-Bold')
      .text(`Received: ${formatMoney(Number(payment.amount))} BDT`);

    const balance =
      Number(payment.invoice.payable) - Number(payment.invoice.paidTotal);
    doc
      .fontSize(narrow ? 7.5 : 9)
      .font('Helvetica')
      .text(`Outstanding on this invoice: ${formatMoney(balance)} BDT`);

    const refunded = payment.refunds.reduce(
      (sum, refund) => sum + Number(refund.amount),
      0,
    );
    if (refunded > 0) {
      doc
        .fillColor('#b91c1c')
        .text(`Refunded: ${formatMoney(refunded)} BDT`)
        .fillColor('#000');
    }

    doc.moveDown(narrow ? 1 : 2);
    if (!narrow) {
      doc
        .fontSize(8)
        .text(
          'Received by: ______________________     Signature: ______________________',
        );
      doc.moveDown(0.6);
    }
    if (context.footer) {
      doc.fontSize(narrow ? 6.5 : 7).fillColor('#6b7280').text(context.footer);
    }

    doc.end();
    return {
      buffer: await done,
      filename: `receipt-${slug(payment.paymentNo)}.pdf`,
      contentType: 'application/pdf',
    };
  }

  // ── invoice ─────────────────────────────────────────────────────────

  async invoicePdf(
    invoice: InvoiceDetail,
    context: ReceiptContext,
  ): Promise<ExportFile> {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      info: { Title: `Invoice ${invoice.invoiceNo}` },
    });
    const chunks: Buffer[] = [];
    const done = this.collect(doc, chunks);
    const student = invoice.enrollment.student;

    doc.fontSize(16).font('Helvetica-Bold').text(context.schoolName, {
      align: 'center',
    });
    if (context.schoolAddress) {
      doc
        .fontSize(8)
        .font('Helvetica')
        .fillColor('#555')
        .text(context.schoolAddress, { align: 'center' });
    }
    doc
      .moveDown(0.4)
      .fillColor('#1e3a5f')
      .fontSize(13)
      .font('Helvetica-Bold')
      .text('FEE INVOICE', { align: 'center' });
    doc.moveDown(0.8).fillColor('#000');

    const top = doc.y;
    doc.fontSize(9).font('Helvetica');
    doc.text(`Student: ${student.firstName} ${student.lastName}`.trim(), 40, top);
    doc.text(`Student ID: ${student.studentUid}`, 40, doc.y);
    doc.text(
      `Class: ${invoice.enrollment.class.name} — ${invoice.enrollment.section.name}`,
      40,
      doc.y,
    );
    doc.text(`Roll: ${invoice.enrollment.rollNo}`, 40, doc.y);
    doc.y = top;
    doc.text(`Invoice No: ${invoice.invoiceNo}`, 330, doc.y);
    doc.text(`Issued: ${invoice.issueDate.toISOString().slice(0, 10)}`, 330, doc.y);
    doc.text(`Due: ${invoice.dueDate.toISOString().slice(0, 10)}`, 330, doc.y);
    doc.text(`Status: ${invoice.status}`, 330, doc.y);
    doc.x = 40;
    doc.moveDown(1.2);

    this.table(
      doc,
      ['Description', 'Amount', 'Discount', 'Net'],
      invoice.items.map((item) => [
        item.note ? `${item.description} (${item.note})` : item.description,
        formatMoney(Number(item.amount)),
        formatMoney(Number(item.discount)),
        formatMoney(Number(item.amount) - Number(item.discount)),
      ]),
      [280, 80, 80, 80],
    );

    doc.moveDown(0.8);
    const summary = (label: string, value: number, bold = false) => {
      doc
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(bold ? 11 : 9)
        .text(`${label}: ${formatMoney(value)} BDT`, { align: 'right' });
    };
    summary('Subtotal', Number(invoice.subtotal));
    summary('Discount', Number(invoice.discountTotal));
    if (Number(invoice.fineTotal) > 0) {
      summary('Late fine', Number(invoice.fineTotal));
    }
    summary('Payable', Number(invoice.payable), true);
    summary('Paid', Number(invoice.paidTotal));
    summary(
      'Outstanding',
      Number(invoice.payable) - Number(invoice.paidTotal),
      true,
    );

    doc.moveDown(2);
    if (context.footer) {
      doc.fontSize(7).fillColor('#6b7280').text(context.footer);
    }

    doc.end();
    return {
      buffer: await done,
      filename: `invoice-${slug(invoice.invoiceNo)}.pdf`,
      contentType: 'application/pdf',
    };
  }

  // ── reports ─────────────────────────────────────────────────────────

  async collectionXlsx(report: DailyCollection): Promise<ExportFile> {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Collection');

    sheet.addRow([`Collection ${report.from} → ${report.to}`]);
    sheet.addRow([`Total: ${formatMoney(report.total)} BDT`]);
    sheet.addRow([]);
    sheet.addRow([
      'Receipt',
      'Date',
      'Student',
      'UID',
      'Class',
      'Invoice',
      'Method',
      'Amount',
    ]);
    for (const row of report.rows) {
      sheet.addRow([
        row.paymentNo,
        row.paidAt,
        row.studentName,
        row.studentUid,
        row.className,
        row.invoiceNo,
        row.method,
        row.amount,
      ]);
    }

    sheet.addRow([]);
    sheet.addRow(['By method']);
    for (const row of report.byMethod) {
      sheet.addRow([row.method, row.count, row.amount]);
    }

    sheet.getRow(1).font = { bold: true, size: 14 };
    sheet.getRow(4).font = { bold: true };
    sheet.columns.forEach((column) => {
      column.width = 16;
    });

    return {
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      filename: `collection-${report.from}-to-${report.to}.xlsx`,
      contentType: XLSX_TYPE,
    };
  }

  async duesXlsx(report: DuesReport): Promise<ExportFile> {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Defaulters');

    sheet.addRow(['Outstanding dues']);
    sheet.addRow([`Total: ${formatMoney(report.totalOutstanding)} BDT`]);
    sheet.addRow([]);
    sheet.addRow([
      'Roll',
      'UID',
      'Student',
      'Class',
      'Section',
      'Outstanding',
      'Oldest due',
      'Age',
    ]);
    for (const row of report.defaulters) {
      sheet.addRow([
        row.rollNo,
        row.studentUid,
        row.studentName,
        row.className,
        row.sectionName,
        row.outstanding,
        row.oldestDueDate,
        row.bucket,
      ]);
    }

    sheet.addRow([]);
    sheet.addRow(['Aging']);
    for (const bucket of report.buckets) {
      sheet.addRow([bucket.bucket, bucket.invoices, bucket.amount]);
    }

    sheet.getRow(1).font = { bold: true, size: 14 };
    sheet.getRow(4).font = { bold: true };
    sheet.columns.forEach((column) => {
      column.width = 16;
    });

    return {
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      filename: 'dues-defaulters.xlsx',
      contentType: XLSX_TYPE,
    };
  }

  async headWiseXlsx(report: HeadWiseIncome): Promise<ExportFile> {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Head-wise income');

    sheet.addRow(['Head-wise income']);
    sheet.addRow([]);
    sheet.addRow(['Fee head', 'Billed', 'Discounted', 'Net']);
    for (const row of report.rows) {
      sheet.addRow([row.feeHeadName, row.billed, row.discounted, row.net]);
    }
    sheet.addRow([]);
    sheet.addRow([
      'Total',
      report.totalBilled,
      report.totalDiscounted,
      report.totalNet,
    ]);

    sheet.getRow(1).font = { bold: true, size: 14 };
    sheet.getRow(3).font = { bold: true };
    sheet.columns.forEach((column) => {
      column.width = 20;
    });

    return {
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      filename: 'head-wise-income.xlsx',
      contentType: XLSX_TYPE,
    };
  }

  // ── renderers ───────────────────────────────────────────────────────

  private table(
    doc: PDFKit.PDFDocument,
    headers: string[],
    rows: string[][],
    widths: number[],
  ): void {
    const left = doc.page.margins.left;
    const write = (cells: string[], bold: boolean): void => {
      if (doc.y > doc.page.height - 80) doc.addPage();
      const top = doc.y;
      let x = left;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 9 : 8.5);
      cells.forEach((cell, i) => {
        doc.text(cell, x, top, {
          width: widths[i] - 6,
          ellipsis: true,
          lineBreak: false,
          align: i === 0 ? 'left' : 'right',
        });
        x += widths[i];
      });
      doc.y = top + 15;
      doc.x = left;
    };

    write(headers, true);
    doc
      .moveTo(left, doc.y - 4)
      .lineTo(left + widths.reduce((a, b) => a + b, 0), doc.y - 4)
      .strokeColor('#9ca3af')
      .stroke();
    for (const row of rows) write(row, false);
    if (rows.length === 0) {
      doc.font('Helvetica').fontSize(9).text('No lines.', left, doc.y);
    }
  }

  private collect(doc: PDFKit.PDFDocument, chunks: Buffer[]): Promise<Buffer> {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    return new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
  }
}

function slug(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'fee';
}
