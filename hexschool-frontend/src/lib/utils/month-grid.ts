/**
 * Month-grid builder for the calendar page (no date library — plain UTC
 * math). Weeks run Sunday→Saturday to match the WEEKDAYS order used by
 * the backend's weekly-holiday check.
 */

export interface GridDay {
  /** YYYY-MM-DD */
  iso: string;
  dayOfMonth: number;
  /** SUNDAY … SATURDAY (matches backend + settings values). */
  weekday: string;
  inMonth: boolean;
}

export const WEEKDAYS = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
] as const;

const isoOf = (d: Date): string => d.toISOString().slice(0, 10);

/** Full weeks covering the month of `year`-`month` (1-based month). */
export function buildMonthGrid(year: number, month: number): GridDay[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const gridStart = new Date(first);
  gridStart.setUTCDate(first.getUTCDate() - first.getUTCDay()); // back to Sunday

  const weeks: GridDay[][] = [];
  const cursor = new Date(gridStart);
  do {
    const week: GridDay[] = [];
    for (let i = 0; i < 7; i += 1) {
      week.push({
        iso: isoOf(cursor),
        dayOfMonth: cursor.getUTCDate(),
        weekday: WEEKDAYS[cursor.getUTCDay()],
        inMonth: cursor.getUTCMonth() === month - 1,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  } while (cursor.getUTCMonth() === month - 1);
  return weeks;
}

/** Is `iso` inside the inclusive [start, end] date-string range? */
export function inRange(iso: string, start: string, end: string): boolean {
  const startIso = start.slice(0, 10);
  const endIso = end.slice(0, 10);
  return iso >= startIso && iso <= endIso;
}

/** "2026-02" → { label: "February 2026", prev: "2026-01", next: "2026-03" } */
export function monthInfo(month: string): {
  label: string;
  prev: string;
  next: string;
} {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, 1));
  const label = date.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const fmt = (yy: number, mm: number) =>
    `${yy}-${String(mm).padStart(2, "0")}`;
  const prev = m === 1 ? fmt(y - 1, 12) : fmt(y, m - 1);
  const next = m === 12 ? fmt(y + 1, 1) : fmt(y, m + 1);
  return { label, prev, next };
}
