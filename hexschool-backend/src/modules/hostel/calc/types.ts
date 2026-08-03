/**
 * The enum vocabulary the `calc/` engines speak, as plain string-literal
 * unions.
 *
 * **No engine in this folder imports `@prisma/client`** — the M24 lesson,
 * which cost three of five spec suites dying with "Jest worker ran out of
 * memory" before anybody worked out that reaching for one generated enum
 * pulls the entire generated client into every engine and every spec.
 * `tsc` still checks that these lists agree with the PG enums at every
 * call site, which is what makes the duplication safe rather than
 * hopeful: if a value is added to the schema and not here, the service
 * that passes it stops compiling.
 */

export type HostelKind = 'BOYS' | 'GIRLS';

/** M07/M09's `gender_enum`, mirrored for the allocation check. */
export type StudentGender = 'MALE' | 'FEMALE' | 'OTHER';

export type RoomState = 'ACTIVE' | 'MAINTENANCE';

export type BedState = 'VACANT' | 'OCCUPIED' | 'MAINTENANCE';

export type ResidencyStatus = 'ACTIVE' | 'SUSPENDED' | 'VACATED';

export type MealOffState = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

/** `YYYY-MM-DD`. Calendar days, never instants — the M05 rule. */
export type IsoDate = string;

/** `YYYY-MM`. */
export type IsoMonth = string;

export const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
export const MONTH_SHAPE = /^\d{4}-\d{2}$/;

/** Days in the `YYYY-MM` month; 0 when the string is not a month. */
export function daysInMonth(month: IsoMonth): number {
  if (!MONTH_SHAPE.test(month)) return 0;
  const year = Number(month.slice(0, 4));
  const monthNo = Number(month.slice(5, 7));
  if (monthNo < 1 || monthNo > 12) return 0;
  return new Date(Date.UTC(year, monthNo, 0)).getUTCDate();
}

/** `YYYY-MM-DD` for day `day` of `month`. Callers clamp to the month. */
export function dayOf(month: IsoMonth, day: number): IsoDate {
  return `${month}-${String(day).padStart(2, '0')}`;
}

/** The `YYYY-MM` a `YYYY-MM-DD` falls in; `''` for a malformed date. */
export function monthOf(date: IsoDate): IsoMonth {
  return DATE_SHAPE.test(date) ? date.slice(0, 7) : '';
}

/**
 * The month after `month`, as `YYYY-MM`. Used by the meal-off credit,
 * which lands on the NEXT invoice.
 */
export function nextMonth(month: IsoMonth): IsoMonth {
  if (!MONTH_SHAPE.test(month)) return '';
  const year = Number(month.slice(0, 4));
  const monthNo = Number(month.slice(5, 7));
  if (monthNo < 1 || monthNo > 12) return '';
  const rolled = monthNo === 12;
  return `${rolled ? year + 1 : year}-${String(rolled ? 1 : monthNo + 1).padStart(2, '0')}`;
}

/** The first day of a month, which is how `credit_month` is stored. */
export function firstOfMonth(month: IsoMonth): IsoDate {
  return MONTH_SHAPE.test(month) ? `${month}-01` : '';
}

/**
 * Inclusive whole days between two `YYYY-MM-DD` dates — the unit a
 * meal-off is counted in, because a boarder away from the 12th to the
 * 12th missed one day of meals and not zero.
 *
 * Computed through `Date.UTC` rather than by parsing into a local `Date`,
 * because the local one drags a timezone into arithmetic that has none
 * (the M25 Dhaka-midnight lesson).
 */
export function inclusiveDays(from: IsoDate, to: IsoDate): number {
  if (!DATE_SHAPE.test(from) || !DATE_SHAPE.test(to)) return 0;
  const start = utc(from);
  const end = utc(to);
  if (end < start) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
}

function utc(date: IsoDate): number {
  return Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  );
}
