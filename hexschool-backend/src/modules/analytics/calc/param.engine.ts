import type { ReportParam, ReportParamValues } from './types';

/**
 * Roadmap §7: "params validated against schema".
 *
 * Dependency-free, so the same function runs in the HTTP path (a manual
 * run, where a bad value must 400 immediately) and in the worker (a
 * scheduled run, where the params were stored months ago and the report's
 * schema may have changed underneath them since). Those two callers are
 * the reason this returns **every** error rather than throwing on the
 * first — the M22 bulk-grid rule: a form that reveals one problem per
 * submission takes four round trips to fill in.
 */

export interface ParamError {
  key: string;
  message: string;
}

export interface ParamValidation {
  ok: boolean;
  values: ReportParamValues;
  errors: ParamError[];
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The param types whose value is a row id. */
const ID_TYPES = new Set([
  'session',
  'class',
  'section',
  'exam',
  'student',
  'route',
  'item',
  'account',
  'vehicle',
  'hostel',
  'supplier',
]);

/**
 * A YYYY-MM-DD string that is also a real calendar date. The M05 lesson,
 * restated: the regex shape is not the same question as validity, and
 * `2026-02-30` passes the first and fails the second.
 */
export function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}

function coerceBoolean(raw: unknown): boolean | undefined {
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true' || raw === '1' || raw === 1) return true;
  if (raw === 'false' || raw === '0' || raw === 0) return false;
  return undefined;
}

function isBlank(raw: unknown): boolean {
  return (
    raw === undefined ||
    raw === null ||
    (typeof raw === 'string' && raw.trim() === '')
  );
}

/**
 * Validates and coerces a raw parameter bag against a report's schema.
 *
 * Unknown keys are **dropped, not rejected**. A stored schedule outlives
 * the schema it was written against; refusing the whole run because the
 * report lost a filter last quarter would turn a schema tidy-up into a
 * silent outage in every school's Monday email. The keys the report still
 * declares are validated exactly.
 */
export function validateParams(
  schema: readonly ReportParam[],
  raw: Record<string, unknown> | null | undefined,
): ParamValidation {
  const input = raw ?? {};
  const values: ReportParamValues = {};
  const errors: ParamError[] = [];

  for (const param of schema) {
    const provided = input[param.key];
    const value = isBlank(provided) ? param.default : provided;

    if (isBlank(value)) {
      if (param.required) {
        errors.push({ key: param.key, message: `${param.label} is required` });
      }
      continue;
    }

    if (ID_TYPES.has(param.type)) {
      const str = String(value);
      if (!UUID_RE.test(str)) {
        errors.push({
          key: param.key,
          message: `${param.label} must be a valid id`,
        });
        continue;
      }
      values[param.key] = str;
      continue;
    }

    switch (param.type) {
      case 'date': {
        const str = String(value);
        if (!isRealDate(str)) {
          errors.push({
            key: param.key,
            message: `${param.label} must be a real date (YYYY-MM-DD)`,
          });
          continue;
        }
        values[param.key] = str;
        break;
      }
      case 'month': {
        const str = String(value);
        if (!MONTH_RE.test(str)) {
          errors.push({
            key: param.key,
            message: `${param.label} must be a month (YYYY-MM)`,
          });
          continue;
        }
        values[param.key] = str;
        break;
      }
      case 'number': {
        const num = Number(value);
        if (!Number.isFinite(num)) {
          errors.push({
            key: param.key,
            message: `${param.label} must be a number`,
          });
          continue;
        }
        if (param.min !== undefined && num < param.min) {
          errors.push({
            key: param.key,
            message: `${param.label} must be at least ${param.min}`,
          });
          continue;
        }
        if (param.max !== undefined && num > param.max) {
          errors.push({
            key: param.key,
            message: `${param.label} must be at most ${param.max}`,
          });
          continue;
        }
        values[param.key] = num;
        break;
      }
      case 'boolean': {
        const bool = coerceBoolean(value);
        if (bool === undefined) {
          errors.push({
            key: param.key,
            message: `${param.label} must be true or false`,
          });
          continue;
        }
        values[param.key] = bool;
        break;
      }
      case 'enum': {
        const str = String(value);
        if (!param.options?.includes(str)) {
          errors.push({
            key: param.key,
            message: `${param.label} must be one of ${(param.options ?? []).join(', ')}`,
          });
          continue;
        }
        values[param.key] = str;
        break;
      }
      default: {
        // `text`
        const str = String(value).trim();
        if (str.length > 200) {
          errors.push({
            key: param.key,
            message: `${param.label} is too long (max 200 characters)`,
          });
          continue;
        }
        values[param.key] = str;
      }
    }
  }

  // A `from` after a `to` is the one cross-field rule worth having here:
  // every window report in the system uses those two key names, and the
  // alternative is each of forty executors discovering it separately.
  const from = values.from;
  const to = values.to;
  if (typeof from === 'string' && typeof to === 'string' && from > to) {
    errors.push({ key: 'to', message: 'The end date is before the start' });
  }

  return { ok: errors.length === 0, values, errors };
}

/** A stable, comparable rendering of a param bag — used in cache keys. */
export function paramFingerprint(values: ReportParamValues): string {
  return Object.keys(values)
    .filter((key) => values[key] !== undefined)
    .sort()
    .map((key) => `${key}=${String(values[key])}`)
    .join('&');
}
