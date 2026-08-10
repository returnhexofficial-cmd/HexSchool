import type { ReportColumn, ReportRow, ReportTable } from './types';

/**
 * Roadmap §6: "Exports containing sensitive columns (medical, salary)
 * require the specific data permission — **engine strips columns
 * otherwise**".
 *
 * The emphasis is the whole design. The obvious implementation is to
 * refuse the report, and it is wrong: a payroll clerk who may see net pay
 * but not tax details still needs the register, and a school nurse
 * building a class list should not be told "denied" because one column of
 * it is medical. Stripping degrades the report to what the reader is
 * allowed to have, and — this is the part that is easy to skip — **says
 * which columns went**, so a short sheet reads as a permissions boundary
 * rather than as a broken export.
 *
 * Dependency-free: this runs identically on a manual run inside the
 * request and on a scheduled run inside the worker, where the "requester"
 * is the schedule's owner and the permission set was resolved hours after
 * they went home.
 */

export interface StripResult<T> {
  table: T;
  /** Labels of the columns removed, in declaration order. */
  stripped: string[];
}

/** Which of `columns` the holder may not see. */
export function forbiddenColumns(
  columns: readonly ReportColumn[],
  held: ReadonlySet<string>,
): ReportColumn[] {
  return columns.filter((col) => col.permission && !held.has(col.permission));
}

/**
 * Removes every column the holder lacks the permission for, and the
 * corresponding cell from every row.
 *
 * The cells are deleted rather than blanked. A blanked column still tells
 * the reader the field exists and how many rows have one, which for a
 * medical flag or a disciplinary note is most of the disclosure.
 */
export function stripColumns(
  table: ReportTable,
  held: ReadonlySet<string>,
): StripResult<ReportTable> {
  const forbidden = forbiddenColumns(table.columns, held);
  if (forbidden.length === 0) return { table, stripped: [] };

  const drop = new Set(forbidden.map((col) => col.key));
  const columns = table.columns.filter((col) => !drop.has(col.key));
  const rows: ReportRow[] = table.rows.map((row) => {
    const next: ReportRow = {};
    for (const col of columns) next[col.key] = row[col.key];
    return next;
  });

  const stripped = forbidden.map((col) => col.label);
  const notes = [
    ...(table.notes ?? []),
    `${stripped.length} column${stripped.length === 1 ? '' : 's'} withheld — ${stripped.join(', ')} — because the requester does not hold the data permission for ${stripped.length === 1 ? 'it' : 'them'}.`,
  ];

  return { table: { ...table, columns, rows, notes }, stripped };
}

/**
 * Whether a *whole report* is available to a permission set. Column
 * stripping handles the inside of a report; this is the door, and it is
 * checked in the engine as well as on the route — roadmap §6's "engine
 * level, not just UI", which for a scheduled run is the only check there
 * is, because no route is involved at all.
 */
export function mayRunReport(
  definition: { permission: string },
  held: ReadonlySet<string>,
  isSuperAdmin = false,
): boolean {
  return isSuperAdmin || held.has(definition.permission);
}
