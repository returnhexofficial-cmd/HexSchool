/**
 * Display formatting for dates coming off the API.
 *
 * The backend stores UTC and the product displays **Asia/Dhaka** (roadmap
 * Global Conventions). Two bugs come from ignoring that:
 *
 *  - rendering the raw API value, so a `@db.Date` field prints
 *    `2014-01-01T00:00:00.000Z` in a table cell (QA finding F9);
 *  - calling `toLocaleDateString()` with no locale or timezone, which formats
 *    against whatever the viewer's machine is set to — so the same row reads
 *    differently for two users, and dates near midnight land on the wrong day.
 *
 * Use these helpers rather than `new Date(x).toLocaleDateString()`.
 */

const TIME_ZONE = "Asia/Dhaka";
/** en-GB gives DD/MM/YYYY, which is what BD schools read. */
const LOCALE = "en-GB";

/** Nullish, empty and unparseable values render as an em dash, never "Invalid Date". */
function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `01/01/2014` — for calendar dates (dob, joining date, admission date). */
export function formatDate(
  value: string | number | Date | null | undefined,
  fallback = "—",
): string {
  const d = toDate(value);
  if (!d) return fallback;
  return d.toLocaleDateString(LOCALE, { timeZone: TIME_ZONE });
}

/** `01/01/2014, 14:30` — for instants (audit rows, timestamps). */
export function formatDateTime(
  value: string | number | Date | null | undefined,
  fallback = "—",
): string {
  const d = toDate(value);
  if (!d) return fallback;
  return d.toLocaleString(LOCALE, { timeZone: TIME_ZONE });
}

/** `1 Jan 2014` — for headings and cards, where the numeric form reads poorly. */
export function formatDateLong(
  value: string | number | Date | null | undefined,
  fallback = "—",
): string {
  const d = toDate(value);
  if (!d) return fallback;
  return d.toLocaleDateString(LOCALE, {
    timeZone: TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
