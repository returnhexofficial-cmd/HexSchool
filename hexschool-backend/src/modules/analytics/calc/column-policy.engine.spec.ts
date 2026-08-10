import {
  forbiddenColumns,
  mayRunReport,
  stripColumns,
} from './column-policy.engine';
import type { ReportTable } from './types';

const table = (): ReportTable => ({
  title: 'Payroll register',
  columns: [
    { key: 'name', label: 'Employee' },
    { key: 'net', label: 'Net pay', type: 'money', permission: 'payroll.view' },
    {
      key: 'notes',
      label: 'Medical notes',
      permission: 'student.medical.view',
    },
  ],
  rows: [
    { name: 'Rahim', net: 32000, notes: 'asthma' },
    { name: 'Karim', net: 28000, notes: null },
  ],
});

describe('forbiddenColumns', () => {
  it('names only the columns whose permission is missing', () => {
    const held = new Set(['payroll.view']);
    expect(forbiddenColumns(table().columns, held).map((c) => c.key)).toEqual([
      'notes',
    ]);
  });

  it('leaves unguarded columns alone', () => {
    expect(
      forbiddenColumns(table().columns, new Set()).map((c) => c.key),
    ).toEqual(['net', 'notes']);
  });
});

describe('stripColumns', () => {
  it('returns the table untouched when nothing is forbidden', () => {
    const input = table();
    const result = stripColumns(
      input,
      new Set(['payroll.view', 'student.medical.view']),
    );
    expect(result.table).toBe(input);
    expect(result.stripped).toEqual([]);
  });

  it('deletes the cell, it does not blank it', () => {
    // A blanked column still discloses that the field exists and how many
    // rows have one — for a medical flag that is most of the disclosure.
    const result = stripColumns(table(), new Set(['payroll.view']));
    expect(result.table.columns.map((c) => c.key)).toEqual(['name', 'net']);
    for (const row of result.table.rows) {
      expect('notes' in row).toBe(false);
    }
  });

  it('degrades the report rather than refusing it', () => {
    const result = stripColumns(table(), new Set());
    expect(result.table.rows).toEqual([{ name: 'Rahim' }, { name: 'Karim' }]);
    expect(result.stripped).toEqual(['Net pay', 'Medical notes']);
  });

  it('says on the report which columns went', () => {
    const result = stripColumns(table(), new Set(['payroll.view']));
    expect(result.table.notes?.at(-1)).toContain('Medical notes');
    expect(result.table.notes?.at(-1)).toContain('1 column withheld');
  });

  it('pluralises the note correctly', () => {
    const result = stripColumns(table(), new Set());
    expect(result.table.notes?.at(-1)).toContain('2 columns withheld');
  });

  it('keeps any notes the report already carried', () => {
    const input = { ...table(), notes: ['Valuation is last price × qty.'] };
    const result = stripColumns(input, new Set());
    expect(result.table.notes?.[0]).toBe('Valuation is last price × qty.');
    expect(result.table.notes).toHaveLength(2);
  });

  it('does not mutate the input table', () => {
    const input = table();
    stripColumns(input, new Set());
    expect(input.columns).toHaveLength(3);
    expect(input.rows[0]).toHaveProperty('notes');
  });
});

describe('mayRunReport', () => {
  it('lets a super admin through without the code', () => {
    expect(mayRunReport({ permission: 'fee.report' }, new Set(), true)).toBe(
      true,
    );
  });

  it('demands the code otherwise', () => {
    expect(mayRunReport({ permission: 'fee.report' }, new Set())).toBe(false);
    expect(
      mayRunReport({ permission: 'fee.report' }, new Set(['fee.report'])),
    ).toBe(true);
  });
});
