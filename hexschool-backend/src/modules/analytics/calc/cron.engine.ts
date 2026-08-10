import { DHAKA_OFFSET_MINUTES } from '../../../common/utils/clock.util';

/**
 * Roadmap §7's "cron whitelist (no sub-hourly)" and §6's "scheduled
 * reports run in school timezone (Asia/Dhaka)".
 *
 * A five-field expression, parsed and fired in Dhaka wall-clock time.
 * Bangladesh is a fixed +06:00 with no DST (the M12 note), so "9 a.m.
 * Dhaka" is a constant shift and none of the usual cron-across-a-DST-
 * boundary questions — a fire time that happens twice, or not at all —
 * can arise. That is the reason this is forty lines of arithmetic instead
 * of a dependency.
 *
 * **Why parse at all rather than hand the string to a cron library.**
 * §7 is a *refusal* rule: the expression has to be rejected before it is
 * stored, and rejected for a reason a school administrator can act on.
 * A library that accepts a five-minute step and then fires a full-school
 * tabulation twelve times an hour has enforced nothing. So the parser is
 * the validator, and the whitelist is the parse:
 *
 *   - the **minute** field must be a single literal 0–59. Not `*`, not a
 *     list, not a range, not a step. That single rule is what makes
 *     sub-hourly unrepresentable rather than merely discouraged.
 *   - the remaining fields take `*`, literals, `a-b` ranges, `a,b,c`
 *     lists and star-slash-n steps, in any combination.
 *   - seconds are not a field. A six-field expression is refused rather
 *     than silently reinterpreted, because the two dialects disagree
 *     about which field is which and the mistake is invisible.
 */

export interface CronFields {
  minute: number;
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
  /** True when both day fields are restricted — see `matchesDate`. */
  bothDayFieldsRestricted: boolean;
}

export interface CronParse {
  ok: boolean;
  fields?: CronFields;
  error?: string;
}

const MINUTE_RE = /^([0-9]|[1-5][0-9])$/;

interface FieldSpec {
  name: string;
  min: number;
  max: number;
}

const HOUR: FieldSpec = { name: 'hour', min: 0, max: 23 };
const DOM: FieldSpec = { name: 'day of month', min: 1, max: 31 };
const MONTH: FieldSpec = { name: 'month', min: 1, max: 12 };
const DOW: FieldSpec = { name: 'day of week', min: 0, max: 6 };

function expandField(raw: string, spec: FieldSpec): number[] | string {
  const out = new Set<number>();

  for (const part of raw.split(',')) {
    const piece = part.trim();
    if (piece === '') return `empty value in the ${spec.name} field`;

    const [rangePart, stepPart] = piece.split('/');
    let step = 1;
    if (stepPart !== undefined) {
      const parsed = Number(stepPart);
      if (!Number.isInteger(parsed) || parsed < 1) {
        return `"${piece}" is not a valid ${spec.name} step`;
      }
      step = parsed;
    }

    let lo: number;
    let hi: number;
    if (rangePart === '*') {
      lo = spec.min;
      hi = spec.max;
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-');
      lo = Number(a);
      hi = Number(b);
      if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
        return `"${piece}" is not a valid ${spec.name} range`;
      }
    } else {
      lo = Number(rangePart);
      hi = lo;
      if (!Number.isInteger(lo)) {
        return `"${piece}" is not a valid ${spec.name}`;
      }
    }

    if (lo < spec.min || hi > spec.max || lo > hi) {
      return `${spec.name} must be between ${spec.min} and ${spec.max}`;
    }
    for (let value = lo; value <= hi; value += step) out.add(value);
  }

  return [...out].sort((a, b) => a - b);
}

/** Parses and whitelist-checks an expression. Never throws. */
export function parseCron(expression: string): CronParse {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    return {
      ok: false,
      error:
        parts.length === 6
          ? 'Six-field (seconds) cron is not accepted — use five fields: minute hour day month weekday'
          : 'A cron expression has five fields: minute hour day month weekday',
    };
  }

  const [minuteRaw, hourRaw, domRaw, monthRaw, dowRaw] = parts;

  // §7's whole whitelist, in one condition.
  if (!MINUTE_RE.test(minuteRaw)) {
    return {
      ok: false,
      error:
        'The minute field must be a single number 0–59 — sub-hourly schedules are not allowed',
    };
  }

  const hours = expandField(hourRaw, HOUR);
  if (typeof hours === 'string') return { ok: false, error: hours };
  const daysOfMonth = expandField(domRaw, DOM);
  if (typeof daysOfMonth === 'string') return { ok: false, error: daysOfMonth };
  const months = expandField(monthRaw, MONTH);
  if (typeof months === 'string') return { ok: false, error: months };
  const daysOfWeek = expandField(dowRaw, DOW);
  if (typeof daysOfWeek === 'string') return { ok: false, error: daysOfWeek };

  return {
    ok: true,
    fields: {
      minute: Number(minuteRaw),
      hours,
      daysOfMonth,
      months,
      daysOfWeek,
      bothDayFieldsRestricted: domRaw !== '*' && dowRaw !== '*',
    },
  };
}

/**
 * Vixie cron's day rule, which is a genuine oddity worth stating: when
 * **both** the day-of-month and day-of-week fields are restricted the two
 * are OR-ed, not AND-ed. `0 9 1 * 1` fires on the 1st *and* on every
 * Monday. When only one is restricted it simply applies. Getting this
 * backwards silently makes a monthly schedule fire weekly.
 */
function matchesDate(fields: CronFields, date: Date): boolean {
  const dom = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const dow = date.getUTCDay();

  if (!fields.months.includes(month)) return false;

  const domHit = fields.daysOfMonth.includes(dom);
  const dowHit = fields.daysOfWeek.includes(dow);
  return fields.bothDayFieldsRestricted ? domHit || dowHit : domHit && dowHit;
}

/** The Dhaka wall-clock instant, expressed as a UTC `Date` for arithmetic. */
function toDhaka(instant: Date): Date {
  return new Date(instant.getTime() + DHAKA_OFFSET_MINUTES * 60_000);
}

function fromDhaka(wall: Date): Date {
  return new Date(wall.getTime() - DHAKA_OFFSET_MINUTES * 60_000);
}

/**
 * The next instant strictly after `after` at which the expression fires,
 * as a real (UTC) `Date`. `null` when the expression can never fire —
 * `0 9 30 2 *`, the 30th of February, is the honest example, and a
 * schedule saved with it would otherwise sit ACTIVE forever without ever
 * producing a report.
 *
 * The scan is by **day**, not by minute: the minute is fixed by the
 * whitelist and the hours are a small set, so at most 24 candidate times
 * exist per day and four years of days bounds every representable
 * expression (a leap-day-only schedule is the worst case).
 */
export function nextRun(
  expression: string,
  after: Date = new Date(),
): Date | null {
  const parsed = parseCron(expression);
  if (!parsed.ok || !parsed.fields) return null;
  const fields = parsed.fields;

  const afterWall = toDhaka(after);
  const cursor = new Date(
    Date.UTC(
      afterWall.getUTCFullYear(),
      afterWall.getUTCMonth(),
      afterWall.getUTCDate(),
    ),
  );

  // 366 * 4 + 1 days covers every expression the parser accepts, leap day
  // included.
  for (let day = 0; day <= 1465; day += 1) {
    const probe = new Date(cursor.getTime() + day * 86_400_000);
    if (matchesDate(fields, probe)) {
      for (const hour of fields.hours) {
        const wall = new Date(
          probe.getTime() + hour * 3_600_000 + fields.minute * 60_000,
        );
        if (wall.getTime() > afterWall.getTime()) return fromDhaka(wall);
      }
    }
  }
  return null;
}

/**
 * A schedule the sweep skipped — the machine was down, the worker was
 * busy — has a `next_run_at` in the past. Firing it once and moving on is
 * right; firing it once per missed window is a mailbox full of identical
 * spreadsheets at 3 a.m. This computes the forward-looking next slot from
 * *now*, which is what "catch up by skipping" means.
 */
export function catchUpNextRun(
  expression: string,
  now: Date = new Date(),
): Date | null {
  return nextRun(expression, now);
}

/** Roadmap §5's cron presets. */
export const CRON_PRESETS = {
  DAILY_7AM: '0 7 * * *',
  DAILY_8PM: '0 20 * * *',
  WEEKLY_SUN_7AM: '0 7 * * 0',
  WEEKLY_MON_7AM: '0 7 * * 1',
  MONTHLY_1ST_7AM: '0 7 1 * *',
  MONTHLY_LAST_WORKING: '0 7 28 * *',
} as const;

export type CronPreset = keyof typeof CRON_PRESETS;

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

function ordinal(n: number): string {
  const suffix =
    n % 100 >= 11 && n % 100 <= 13
      ? 'th'
      : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

/**
 * A plain-English rendering for the schedule list. The manager shows this
 * beside the expression rather than instead of it — an administrator who
 * typed the cron should be able to check the system read it the way they
 * meant, which a sentence alone cannot do and an expression alone will
 * not be trusted for.
 */
export function describeCron(expression: string): string {
  const parsed = parseCron(expression);
  if (!parsed.ok || !parsed.fields) return expression;
  const { minute, hours, daysOfMonth, months, daysOfWeek } = parsed.fields;

  const times = hours
    .map(
      (h) => `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    )
    .join(', ');

  const everyDom = daysOfMonth.length === 31;
  const everyDow = daysOfWeek.length === 7;
  const everyMonth = months.length === 12;

  let when: string;
  if (everyDom && everyDow) {
    when = 'every day';
  } else if (everyDom) {
    when = `every ${daysOfWeek.map((d) => DAY_NAMES[d]).join(', ')}`;
  } else if (everyDow) {
    when = `on the ${daysOfMonth.map(ordinal).join(', ')}`;
  } else {
    when = `on the ${daysOfMonth.map(ordinal).join(', ')} and every ${daysOfWeek
      .map((d) => DAY_NAMES[d])
      .join(', ')}`;
  }

  const scope = everyMonth
    ? ''
    : ` in ${months
        .map((m) =>
          new Date(Date.UTC(2000, m - 1, 1)).toLocaleString('en', {
            month: 'long',
            timeZone: 'UTC',
          }),
        )
        .join(', ')}`;

  return `At ${times} (Asia/Dhaka) ${when}${scope}`.trim();
}
