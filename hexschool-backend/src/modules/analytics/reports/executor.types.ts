import type { ReportParamValues, ReportTable } from '../calc/types';

/**
 * What a report needs to know about *who* is running it.
 *
 * `held` is the resolved permission-code set, not the user id, because the
 * two callers resolve it at different times: an interactive run resolves
 * it inside the request, a scheduled run resolves the **owner's** codes
 * hours later inside the worker. Passing the resolved set means the column
 * policy is one function with one input in both cases (roadmap §6's
 * "engine level, not just UI" — for a scheduled run there is no UI and no
 * route at all).
 */
export interface ReportContext {
  schoolId: string;
  params: ReportParamValues;
  actorId: string | null;
  held: ReadonlySet<string>;
  isSuperAdmin: boolean;
}

/** The one signature every report executor has. */
export type ReportExecutor = (ctx: ReportContext) => Promise<ReportTable>;

/**
 * A provider contributes the executors for one source module. Splitting
 * them per module keeps each file next to the vocabulary it translates
 * (an inventory executor talks about issues and reorder levels) and keeps
 * the merge in `ReportExecutorRegistry` a one-liner.
 */
export interface ReportExecutorProvider {
  executors(): Record<string, ReportExecutor>;
}

/** DI token for the set of providers the registry merges. */
export const REPORT_EXECUTORS = Symbol('REPORT_EXECUTORS');

// ── Small helpers every executor uses ────────────────────────────────

export function str(
  values: ReportParamValues,
  key: string,
): string | undefined {
  const value = values[key];
  return typeof value === 'string' ? value : undefined;
}

export function num(
  values: ReportParamValues,
  key: string,
): number | undefined {
  const value = values[key];
  return typeof value === 'number' ? value : undefined;
}

export function bool(
  values: ReportParamValues,
  key: string,
): boolean | undefined {
  const value = values[key];
  return typeof value === 'boolean' ? value : undefined;
}

/** A `Decimal | number | string` money column as a plain number. */
export function money(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

/**
 * The window a report defaults to when the caller gave none: the current
 * month. Every windowed executor uses this rather than inventing its own
 * default, so an unparameterised scheduled run means the same thing
 * everywhere.
 */
export function defaultWindow(
  values: ReportParamValues,
  now = new Date(),
): { from: string; to: string } {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const last = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  );
  return {
    from: str(values, 'from') ?? first.toISOString().slice(0, 10),
    to: str(values, 'to') ?? last.toISOString().slice(0, 10),
  };
}

/**
 * The same window in **`YYYY-MM`**, for the one source module whose
 * reports are grained in months rather than days.
 *
 * M21's payroll reports take a month pair, because a payroll run belongs
 * to a month and there is no such thing as half of one. Handing them a
 * date instead produces `"2026-08-01-01" is not a valid calendar date` —
 * the service appends `-01` to what it assumes is a month — which is a
 * failure the type system cannot see, both being `string`. The e2e run
 * found it; this helper is why it cannot come back.
 */
export function defaultMonthWindow(
  values: ReportParamValues,
  now = new Date(),
): { from: string; to: string } {
  const month = now.toISOString().slice(0, 7);
  const toMonth = (raw: string | undefined) => raw?.slice(0, 7);
  return {
    from: toMonth(str(values, 'from')) ?? month,
    to: toMonth(str(values, 'to')) ?? month,
  };
}
