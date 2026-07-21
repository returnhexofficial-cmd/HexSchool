import { isoDate } from './date.util';

/** Weekday names as stored in the `general.weekly_holidays` setting. */
const WEEKDAY_NAMES = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
] as const;

export interface HolidayRange {
  startDate: Date;
  endDate: Date;
}

/**
 * Dependency-free working-day calculator behind
 * `CalendarService.workingDays()` (added in M12 — attendance percentages
 * divide by working days, and running `isHoliday` per date would be one
 * query pair per day). A day is a working day unless it falls on a
 * configured weekly off-day or inside a holiday range.
 *
 * Dates are UTC-midnight `@db.Date` values end to end (M05 convention),
 * so plain UTC arithmetic is exact here — no timezone shifting.
 */
export function workingDaysBetween(
  from: Date,
  to: Date,
  weeklyHolidays: readonly string[],
  holidays: readonly HolidayRange[],
): string[] {
  if (from.getTime() > to.getTime()) return [];

  const weekly = new Set(weeklyHolidays.map((d) => d.toUpperCase()));
  const days: string[] = [];

  for (
    let cursor = new Date(from.getTime());
    cursor.getTime() <= to.getTime();
    cursor = new Date(cursor.getTime() + 86_400_000)
  ) {
    if (weekly.has(WEEKDAY_NAMES[cursor.getUTCDay()])) continue;
    const time = cursor.getTime();
    const covered = holidays.some(
      (h) => h.startDate.getTime() <= time && h.endDate.getTime() >= time,
    );
    if (covered) continue;
    days.push(isoDate(cursor));
  }

  return days;
}
