import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { encodeCode128B } from '../calc/barcode.util';
import { BookCopiesRepository } from '../repositories/book-copies.repository';
import { LibraryReportsService } from './library-reports.service';

export interface ExportFile {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** A CR80-ish spine label: 50 mm × 25 mm at 72 dpi. */
const LABEL = { width: 142, height: 71, cols: 4, rows: 10, margin: 28 };

/**
 * Report files and the barcode label sheet.
 *
 * The reports/export split is M12's: the JSON shapes live in
 * `LibraryReportsService` and are rendered here, so the spreadsheet and
 * the screen are the same numbers rather than two queries that can
 * drift apart.
 *
 * The label sheet is roadmap §4's "barcode label PDF sheets (Code128)".
 * It draws the bars from `encodeCode128B`'s module widths — pdfkit
 * rectangles, no image, no font trickery — which is why the output
 * scales cleanly at any printer resolution and needs no dependency
 * beyond the pdfkit already in the tree.
 */
@Injectable()
export class LibraryExportService {
  constructor(
    private readonly reports: LibraryReportsService,
    private readonly copies: BookCopiesRepository,
  ) {}

  async overdueXlsx(schoolId: string): Promise<ExportFile> {
    const rows = await this.reports.overdue(schoolId);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Overdue');
    sheet.columns = [
      { header: 'Accession', key: 'accessionNo', width: 18 },
      { header: 'Title', key: 'title', width: 40 },
      { header: 'Card', key: 'cardNo', width: 16 },
      { header: 'Member', key: 'memberName', width: 26 },
      { header: 'Class / role', key: 'memberContext', width: 20 },
      { header: 'Due', key: 'dueAt', width: 14 },
      { header: 'Days overdue', key: 'daysOverdue', width: 14 },
      { header: 'Fine (BDT)', key: 'outstandingFine', width: 14 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const row of rows) {
      sheet.addRow({ ...row, dueAt: row.dueAt.toISOString().slice(0, 10) });
    }
    return this.xlsx(workbook, 'library-overdue.xlsx');
  }

  async stockXlsx(schoolId: string): Promise<ExportFile> {
    const stock = await this.reports.stock(schoolId);
    const workbook = new ExcelJS.Workbook();

    const sheet = workbook.addWorksheet('Stock by category');
    sheet.columns = [
      { header: 'Category', key: 'categoryName', width: 30 },
      { header: 'Titles', key: 'titles', width: 12 },
      { header: 'Copies', key: 'copies', width: 12 },
      { header: 'Available', key: 'available', width: 12 },
      { header: 'On loan', key: 'issued', width: 12 },
      { header: 'Written off', key: 'lost', width: 14 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const row of stock.byCategory) sheet.addRow(row);

    const totals = workbook.addWorksheet('Totals');
    totals.columns = [
      { header: 'Status', key: 'status', width: 20 },
      { header: 'Copies', key: 'count', width: 12 },
    ];
    totals.getRow(1).font = { bold: true };
    for (const [status, count] of Object.entries(stock.totals)) {
      totals.addRow({ status, count });
    }
    return this.xlsx(workbook, 'library-stock.xlsx');
  }

  async popularXlsx(
    schoolId: string,
    from: Date,
    to: Date,
    limit: number,
  ): Promise<ExportFile> {
    const rows = await this.reports.popular(schoolId, from, to, limit);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Popular titles');
    sheet.columns = [
      { header: 'Title', key: 'title', width: 40 },
      { header: 'Category', key: 'category', width: 24 },
      { header: 'Authors', key: 'authors', width: 32 },
      { header: 'Times issued', key: 'issues', width: 14 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const row of rows) {
      sheet.addRow({ ...row, authors: row.authors.join(', ') });
    }
    return this.xlsx(workbook, 'library-popular.xlsx');
  }

  async memberHistoryXlsx(
    memberId: string,
    schoolId: string,
  ): Promise<ExportFile> {
    const history = await this.reports.memberHistory(memberId, schoolId);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Borrowing history');
    sheet.columns = [
      { header: 'Accession', key: 'accessionNo', width: 18 },
      { header: 'Title', key: 'title', width: 40 },
      { header: 'Issued', key: 'issuedAt', width: 14 },
      { header: 'Due', key: 'dueAt', width: 14 },
      { header: 'Returned', key: 'returnedAt', width: 14 },
      { header: 'Renewals', key: 'renewCount', width: 12 },
      { header: 'Fine', key: 'fineAmount', width: 12 },
      { header: 'Unpaid', key: 'outstandingFine', width: 12 },
    ];
    sheet.getRow(1).font = { bold: true };
    const date = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');
    for (const row of history.loans) {
      sheet.addRow({
        ...row,
        issuedAt: date(row.issuedAt),
        dueAt: date(row.dueAt),
        returnedAt: date(row.returnedAt),
      });
    }
    return this.xlsx(workbook, `library-member-${history.member.cardNo}.xlsx`);
  }

  /**
   * Roadmap §4's Code 128 label sheet: an A4 grid of spine labels, each
   * carrying the barcode, the accession number under it and the title
   * above, so a librarian sticking forty labels can tell them apart
   * without a scanner.
   */
  async labelSheet(copyIds: string[], schoolId: string): Promise<ExportFile> {
    const copies = await this.copies.findAllFor(schoolId, {});
    const wanted = new Set(copyIds);
    const selected = copies.filter((c) => wanted.has(c.id));

    const doc = new PDFDocument({ size: 'A4', margin: LABEL.margin });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    const perPage = LABEL.cols * LABEL.rows;
    selected.forEach((copy, index) => {
      if (index > 0 && index % perPage === 0) doc.addPage();
      const slot = index % perPage;
      const x = LABEL.margin + (slot % LABEL.cols) * LABEL.width;
      const y = LABEL.margin + Math.floor(slot / LABEL.cols) * LABEL.height;
      this.drawLabel(doc, x, y, copy.accessionNo, copy.book.title);
    });

    if (selected.length === 0) {
      doc.fontSize(11).text('No copies selected.', LABEL.margin, LABEL.margin);
    }

    doc.end();
    return {
      buffer: await done,
      filename: 'library-labels.pdf',
      contentType: 'application/pdf',
    };
  }

  private drawLabel(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    accessionNo: string,
    title: string,
  ): void {
    const padding = 6;
    const innerWidth = LABEL.width - padding * 2;

    doc
      .fontSize(6)
      .fillColor('#444444')
      .text(title.slice(0, 34), x + padding, y + padding, {
        width: innerWidth,
        height: 9,
        ellipsis: true,
        lineBreak: false,
      });

    const symbol = encodeCode128B(accessionNo, 4);
    // Scale the symbol to fit the label, keeping bars on whole modules
    // so no bar rounds away to nothing at small sizes.
    const moduleWidth = innerWidth / symbol.modules;
    const barTop = y + padding + 12;
    const barHeight = LABEL.height - padding * 2 - 26;

    doc.fillColor('#000000');
    for (const bar of symbol.bars) {
      doc.rect(
        x + padding + bar.x * moduleWidth,
        barTop,
        Math.max(0.4, bar.width * moduleWidth),
        barHeight,
      );
    }
    doc.fill();

    doc
      .fontSize(7)
      .fillColor('#000000')
      .text(accessionNo, x + padding, barTop + barHeight + 2, {
        width: innerWidth,
        align: 'center',
        lineBreak: false,
      });
  }

  private async xlsx(
    workbook: ExcelJS.Workbook,
    filename: string,
  ): Promise<ExportFile> {
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return { buffer, filename, contentType: XLSX_TYPE };
  }
}
