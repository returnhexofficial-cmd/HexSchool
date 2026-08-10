import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PassThrough } from 'stream';
import PDFDocument from 'pdfkit';
import type { ReportFormat } from '../calc/types';
import {
  contentTypeFor,
  extensionFor,
  formatCell,
  reportFilename,
  toCsv,
} from '../calc/tabular.util';
import type { ReportCell, ReportTable } from '../calc/types';

export interface RenderedReport {
  buffer: Buffer;
  filename: string;
  contentType: string;
  rowCount: number;
}

/**
 * Turns a `ReportTable` into a file. **One renderer for forty-odd
 * reports** — which is the payoff of making every executor return the
 * same shape, and the reason M12's per-module export services (each with
 * its own column list, its own header styling, its own page setup) are not
 * the model here.
 *
 * Roadmap §8's memory bound is handled by the **writer**, not by the
 * caller: ExcelJS's streaming workbook writes each row to a buffer as it
 * is added instead of holding a document tree, so a 50 000-row register is
 * a few megabytes of output rather than a few hundred megabytes of objects.
 * The non-streaming API is what makes a big export fall over, and it is
 * the API that reads more naturally, so it is worth saying plainly why it
 * is not used here.
 */
@Injectable()
export class ReportRenderService {
  async render(
    table: ReportTable,
    format: ReportFormat,
    code: string,
    schoolName?: string,
  ): Promise<RenderedReport> {
    const filename = reportFilename(code, extensionFor(format));
    const contentType = contentTypeFor(format);
    const rowCount = table.rows.length;

    switch (format) {
      case 'CSV':
        return {
          buffer: Buffer.from(toCsv(table.columns, table.rows), 'utf8'),
          filename,
          contentType,
          rowCount,
        };
      case 'JSON':
        return {
          buffer: Buffer.from(JSON.stringify(table, null, 2), 'utf8'),
          filename,
          contentType,
          rowCount,
        };
      case 'PDF':
        return {
          buffer: await this.pdf(table, schoolName),
          filename,
          contentType,
          rowCount,
        };
      default:
        return {
          buffer: await this.xlsx(table, schoolName),
          filename,
          contentType,
          rowCount,
        };
    }
  }

  private async xlsx(table: ReportTable, schoolName?: string): Promise<Buffer> {
    const sink = new PassThrough();
    const chunks: Buffer[] = [];
    sink.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    const drained = new Promise<void>((resolve, reject) => {
      sink.on('end', resolve);
      sink.on('error', reject);
    });

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: sink,
      useStyles: true,
    });

    const sheet = workbook.addWorksheet('Report');

    let cursor = 1;
    sheet.getCell(cursor, 1).value = table.title;
    sheet.getCell(cursor, 1).font = { bold: true, size: 14 };
    cursor += 1;
    if (schoolName) {
      sheet.getCell(cursor, 1).value = schoolName;
      cursor += 1;
    }
    if (table.subtitle) {
      sheet.getCell(cursor, 1).value = table.subtitle;
      cursor += 1;
    }
    for (const item of table.summary ?? []) {
      sheet.getCell(cursor, 1).value = item.label;
      sheet.getCell(cursor, 2).value = item.value;
      cursor += 1;
    }
    cursor += 1;

    const headerRow = sheet.getRow(cursor);
    table.columns.forEach((column, index) => {
      headerRow.getCell(index + 1).value = column.label;
      sheet.getColumn(index + 1).width = column.width ?? 16;
    });
    headerRow.font = { bold: true };
    headerRow.commit();
    cursor += 1;

    for (const row of table.rows) {
      const sheetRow = sheet.getRow(cursor);
      table.columns.forEach((column, index) => {
        sheetRow.getCell(index + 1).value = cellValue(row[column.key]);
      });
      sheetRow.commit();
      cursor += 1;
    }

    if (table.notes?.length) {
      cursor += 1;
      for (const note of table.notes) {
        sheet.getCell(cursor, 1).value = note;
        sheet.getCell(cursor, 1).font = { italic: true, size: 9 };
        cursor += 1;
      }
    }

    sheet.commit();
    await workbook.commit();
    await drained;
    return Buffer.concat(chunks);
  }

  /**
   * A plain landscape table. The default pdfkit font **cannot set Bangla**
   * — the limitation flagged since M09's ID cards and carried by every PDF
   * in this system — so a Bangla name renders transliterated. It is stated
   * here rather than discovered, because the alternative is a school
   * printing a register and finding out at the counter.
   */
  private pdf(table: ReportTable, schoolName?: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margin: 28,
      });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      if (schoolName) doc.fontSize(12).text(schoolName, { align: 'center' });
      doc.fontSize(14).text(table.title, { align: 'center' });
      if (table.subtitle) {
        doc.fontSize(9).text(table.subtitle, { align: 'center' });
      }
      doc.moveDown(0.5);

      if (table.summary?.length) {
        doc
          .fontSize(9)
          .text(
            table.summary
              .map((s) => `${s.label}: ${String(s.value)}`)
              .join('   ·   '),
          );
        doc.moveDown(0.5);
      }

      const usable = doc.page.width - 56;
      const totalWidth = table.columns.reduce(
        (sum, column) => sum + (column.width ?? 16),
        0,
      );
      const widths = table.columns.map(
        (column) => ((column.width ?? 16) / totalWidth) * usable,
      );

      const writeRow = (cells: string[], bold: boolean) => {
        if (doc.y > doc.page.height - 50) doc.addPage();
        const top = doc.y;
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5);
        let x = 28;
        cells.forEach((cell, index) => {
          doc.text(cell, x, top, {
            width: widths[index] - 3,
            height: 12,
            ellipsis: true,
            lineBreak: false,
          });
          x += widths[index];
        });
        doc.y = top + 12;
      };

      writeRow(
        table.columns.map((column) => column.label),
        true,
      );
      for (const row of table.rows) {
        writeRow(
          table.columns.map((column) => formatCell(row[column.key], column)),
          false,
        );
      }

      if (table.notes?.length) {
        doc.moveDown(0.8);
        doc.font('Helvetica-Oblique').fontSize(7);
        for (const note of table.notes) doc.text(note);
      }

      doc.end();
    });
  }
}

/**
 * A cell for a spreadsheet, where a number should stay a number.
 *
 * The one place this differs from the CSV writer: Excel needs the numeric
 * type to sort and total a column, whereas CSV is text either way. Dates
 * likewise go in as `Date`, so a filter reads them as dates.
 */
function cellValue(value: ReportCell): string | number | Date | boolean | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return value;
}
