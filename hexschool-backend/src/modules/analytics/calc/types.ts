/**
 * Hand-written string unions mirroring the PG enums this module's engines
 * reason about.
 *
 * **No `calc/` engine imports `@prisma/client`** — the M24 rule, learned
 * the hard way there (the generated client got pulled into every engine
 * and every spec until Jest's workers ran out of memory) and applied from
 * the start in M26, M27 and M28. `tsc` checks these unions against the
 * generated enums at every call site, so the two lists cannot drift
 * silently.
 */

export type ReportOutput = 'TABLE' | 'CHART' | 'PDF' | 'XLSX';
export type ReportFormat = 'XLSX' | 'CSV' | 'PDF' | 'JSON';
export type ReportRunStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';
export type ReportScheduleStatus = 'ACTIVE' | 'PAUSED' | 'DISABLED';

/** The parameter kinds the hub knows how to render a control for. */
export type ReportParamType =
  | 'session'
  | 'class'
  | 'section'
  | 'exam'
  | 'student'
  | 'route'
  | 'item'
  | 'account'
  | 'vehicle'
  | 'hostel'
  | 'supplier'
  | 'month'
  | 'date'
  | 'text'
  | 'number'
  | 'boolean'
  | 'enum';

/**
 * One parameter of a report definition. This is the whole of
 * `params_schema`: the hub generates a control from `type`, and the engine
 * validates a submitted value against the same object — one description,
 * two consumers, so a form can never offer something the engine refuses.
 */
export interface ReportParam {
  key: string;
  label: string;
  type: ReportParamType;
  required: boolean;
  /** For `enum`: the allowed values. Ignored otherwise. */
  options?: readonly string[];
  /** For `number`. */
  min?: number;
  max?: number;
  /** Shown under the control; also the message a validation error uses. */
  help?: string;
  default?: string | number | boolean;
}

/** A validated parameter bag: every value already coerced to its type. */
export type ReportParamValues = Record<
  string,
  string | number | boolean | undefined
>;

/**
 * A column of a report's tabular result.
 *
 * `permission` is roadmap §6 made structural: a column that names one is
 * removed from the file unless the requester holds it. Declaring it here —
 * on the column, next to the data — rather than in a list somewhere else
 * is what stops a new sensitive column shipping unprotected because
 * somebody forgot to add it to the list.
 */
export interface ReportColumn {
  key: string;
  label: string;
  /** Drives alignment and export cell type. */
  type?: 'text' | 'number' | 'money' | 'date' | 'percent';
  width?: number;
  permission?: string;
}

export type ReportCell = string | number | boolean | Date | null | undefined;
export type ReportRow = Record<string, ReportCell>;

/** What every executor returns, and the only shape the renderers know. */
export interface ReportTable {
  title: string;
  subtitle?: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Rendered under the table; the place a report explains its own method. */
  notes?: string[];
  /** Label => value summary printed above the table. */
  summary?: Array<{ label: string; value: string | number }>;
}
