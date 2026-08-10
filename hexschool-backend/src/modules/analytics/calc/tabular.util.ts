import type { ReportCell, ReportColumn, ReportRow } from './types';

/**
 * Cell formatting and the CSV writer — the `ics.util.ts` / `feed.util.ts`
 * / `zip.util.ts` / `barcode.util.ts` precedent, sixth use: a small
 * hand-rolled format writer as a dependency-free engine, so the bytes are
 * unit-testable without a workbook library or a filesystem.
 */

/** A cell as it should appear in a file. */
export function formatCell(value: ReportCell, column: ReportColumn): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    return column.type === 'date'
      ? value.toISOString().slice(0, 10)
      : value.toISOString().slice(0, 16).replace('T', ' ');
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    if (column.type === 'money') return value.toFixed(2);
    if (column.type === 'percent') return `${value.toFixed(2)}%`;
    return String(value);
  }
  return value;
}

/**
 * One CSV field, RFC 4180 quoting.
 *
 * The leading `'` on a value starting with `=`, `+`, `-` or `@` is **not**
 * cosmetic: without it a cell reading `=1+1` is a formula the moment the
 * file is opened, and a cell somebody typed into a complaint box is a
 * formula that can read the rest of the sheet. This is a report of
 * user-entered text going to a spreadsheet, which is exactly the CSV
 * injection setting, and the school's own staff are the target.
 */
export function csvField(raw: string): string {
  const value = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function csvRow(cells: readonly string[]): string {
  return cells.map(csvField).join(',');
}

/**
 * The whole CSV as a string. Used for the small reports; the large ones
 * go through `csvChunks`, which is the same writer yielding as it goes.
 */
export function toCsv(
  columns: readonly ReportColumn[],
  rows: readonly ReportRow[],
): string {
  const lines = [csvRow(columns.map((c) => c.label))];
  for (const row of rows) {
    lines.push(csvRow(columns.map((c) => formatCell(row[c.key], c))));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * Roadmap §8: "Huge export (50k rows) → streamed generation,
 * memory-bounded."
 *
 * A generator rather than an array, so the caller can pipe each chunk
 * straight to S3 (or to the response) and never hold the whole file. The
 * batching is what makes it worth doing — one yield per row would spend
 * more time in the stream machinery than in the rows.
 */
export function* csvChunks(
  columns: readonly ReportColumn[],
  rows: Iterable<ReportRow>,
  batchSize = 500,
): Generator<string> {
  yield `${csvRow(columns.map((c) => c.label))}\r\n`;

  let buffer: string[] = [];
  for (const row of rows) {
    buffer.push(csvRow(columns.map((c) => formatCell(row[c.key], c))));
    if (buffer.length >= batchSize) {
      yield `${buffer.join('\r\n')}\r\n`;
      buffer = [];
    }
  }
  if (buffer.length > 0) yield `${buffer.join('\r\n')}\r\n`;
}

/** A filesystem-safe filename stem for a run. */
export function reportFilename(
  code: string,
  extension: string,
  at: Date = new Date(),
): string {
  const stem = code.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const stamp = at.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `${stem}-${stamp}.${extension}`;
}

/** The MIME type a format is served as. */
export function contentTypeFor(format: string): string {
  switch (format) {
    case 'XLSX':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'CSV':
      return 'text/csv; charset=utf-8';
    case 'PDF':
      return 'application/pdf';
    default:
      return 'application/json';
  }
}

export function extensionFor(format: string): string {
  return format.toLowerCase();
}
