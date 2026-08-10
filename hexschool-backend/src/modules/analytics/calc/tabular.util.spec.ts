import {
  contentTypeFor,
  csvChunks,
  csvField,
  formatCell,
  reportFilename,
  toCsv,
} from './tabular.util';
import type { ReportColumn } from './types';

const col = (over: Partial<ReportColumn> & { key: string }): ReportColumn => ({
  label: over.key,
  ...over,
});

describe('formatCell', () => {
  it('renders an empty string for null and undefined', () => {
    expect(formatCell(null, col({ key: 'a' }))).toBe('');
    expect(formatCell(undefined, col({ key: 'a' }))).toBe('');
  });

  it('renders money to two places, always', () => {
    expect(formatCell(1200, col({ key: 'a', type: 'money' }))).toBe('1200.00');
    expect(formatCell(0, col({ key: 'a', type: 'money' }))).toBe('0.00');
  });

  it('renders a percent with its sign', () => {
    expect(formatCell(91.5, col({ key: 'a', type: 'percent' }))).toBe('91.50%');
  });

  it('renders a date column as a date and everything else as a stamp', () => {
    const at = new Date('2026-08-10T14:35:22.000Z');
    expect(formatCell(at, col({ key: 'a', type: 'date' }))).toBe('2026-08-10');
    expect(formatCell(at, col({ key: 'a' }))).toBe('2026-08-10 14:35');
  });

  it('renders a boolean as Yes/No', () => {
    expect(formatCell(true, col({ key: 'a' }))).toBe('Yes');
    expect(formatCell(false, col({ key: 'a' }))).toBe('No');
  });
});

describe('csvField', () => {
  it('quotes a comma, a quote and a newline', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
  });

  it('leaves an ordinary value alone', () => {
    expect(csvField('Rahim Uddin')).toBe('Rahim Uddin');
  });

  it('defuses a formula — a complaint box is a spreadsheet injection', () => {
    expect(csvField('=1+1')).toBe("'=1+1");
    expect(csvField('+SUM(A1:A9)')).toBe("'+SUM(A1:A9)");
    expect(csvField('-2')).toBe("'-2");
    expect(csvField('@import')).toBe("'@import");
  });

  it('quotes a defused formula that also contains a comma', () => {
    expect(csvField('=A1,B1')).toBe('"\'=A1,B1"');
  });
});

describe('toCsv', () => {
  const columns = [
    col({ key: 'name', label: 'Name' }),
    col({ key: 'due', label: 'Due', type: 'money' }),
  ];

  it('writes a header row and CRLF line endings', () => {
    const csv = toCsv(columns, [{ name: 'Rahim', due: 500 }]);
    expect(csv).toBe('Name,Due\r\nRahim,500.00\r\n');
  });

  it('writes just the header for no rows', () => {
    expect(toCsv(columns, [])).toBe('Name,Due\r\n');
  });

  it('emits a column the row is missing as empty', () => {
    expect(toCsv(columns, [{ name: 'Rahim' }])).toBe('Name,Due\r\nRahim,\r\n');
  });
});

describe('csvChunks', () => {
  const columns = [col({ key: 'n', label: 'N' })];
  const rows = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ n: i }));

  it('produces exactly the same bytes as toCsv', () => {
    const all = rows(1200);
    expect([...csvChunks(columns, all)].join('')).toBe(toCsv(columns, all));
  });

  it('batches rather than yielding per row', () => {
    // header + 1200/500 = 3 batches
    expect([...csvChunks(columns, rows(1200), 500)]).toHaveLength(4);
  });

  it('yields the header alone for an empty iterable', () => {
    expect([...csvChunks(columns, [])]).toEqual(['N\r\n']);
  });

  it('accepts any iterable, so the rows never have to be an array', () => {
    function* source() {
      yield { n: 1 };
      yield { n: 2 };
    }
    expect([...csvChunks(columns, source())].join('')).toBe('N\r\n1\r\n2\r\n');
  });
});

describe('reportFilename', () => {
  it('is filesystem-safe and stamped', () => {
    expect(
      reportFilename('fee.dues', 'xlsx', new Date('2026-08-10T09:01:02.000Z')),
    ).toBe('fee.dues-2026-08-10-09-01-02.xlsx');
  });

  it('strips a path separator out of a code', () => {
    expect(reportFilename('a/../b', 'csv', new Date(0))).toBe(
      'a-..-b-1970-01-01-00-00-00.csv',
    );
  });
});

describe('contentTypeFor', () => {
  it('maps each format', () => {
    expect(contentTypeFor('XLSX')).toMatch(/spreadsheetml/);
    expect(contentTypeFor('CSV')).toBe('text/csv; charset=utf-8');
    expect(contentTypeFor('PDF')).toBe('application/pdf');
    expect(contentTypeFor('JSON')).toBe('application/json');
  });
});
