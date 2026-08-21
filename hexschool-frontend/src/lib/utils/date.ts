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

/**
 * Bangladesh is **UTC+6 year-round** — no DST since 2009 — so a day boundary is
 * a fixed offset, not a lookup.
 *
 * A `<input type="date">` yields `YYYY-MM-DD`, which means a *local* day. Two
 * ways of turning that into an instant are both wrong (QA finding F25):
 *
 *  - appending `T00:00:00.000Z` / `T23:59:59.999Z` treats the picked day as a
 *    **UTC** day, so an admission cycle advertised as closing on the 31st in
 *    fact keeps accepting applications until 05:59 on the 1st, Dhaka time;
 *  - `new Date(\`${d}T23:59:59\`)` treats it as a day in **the viewer's own**
 *    timezone, so the same filter returns different rows on different laptops.
 */
const UTC_OFFSET = "+06:00";

/** `2026-08-31` → the instant Dhaka's 31 August begins. */
export function startOfDayIso(day: string): string {
  return new Date(`${day}T00:00:00.000${UTC_OFFSET}`).toISOString();
}

/** `2026-08-31` → the last instant of Dhaka's 31 August. */
export function endOfDayIso(day: string): string {
  return new Date(`${day}T23:59:59.999${UTC_OFFSET}`).toISOString();
}

/**
 * The **machine** form, `YYYY-MM-DD` — what an `<input type="date">` requires
 * as its value, and the only legitimate reason to truncate an ISO instant.
 *
 * It exists so that `.slice(0, 10)` on a date field can be banned outright
 * (QA finding F24): every remaining use of that idiom was a display string
 * showing ISO to a reader who expects DD/MM/YYYY, and no heuristic could
 * separate the two. Naming the legitimate use makes the rest unambiguous.
 *
 * Truncates on the **Dhaka** calendar, so pre-filling a form from an instant
 * offers the day the reader saw, not the UTC one.
 */
export function isoDateInput(
  value: string | number | Date | null | undefined,
): string {
  const d = toDate(value);
  if (!d) return "";
  return new Date(d.getTime() + 6 * 60 * 60_000).toISOString().slice(0, 10);
}
