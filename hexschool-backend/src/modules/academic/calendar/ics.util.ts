/**
 * Minimal iCalendar (RFC 5545) writer for all-day events — no external
 * dependency for what is a handful of lines. Consumers: GET /calendar.ics.
 */

export interface IcsEvent {
  uid: string;
  title: string;
  description?: string | null;
  /** Inclusive calendar dates. */
  start: Date;
  end: Date;
  categories?: string;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** YYYYMMDD (all-day VALUE=DATE format). */
export function icsDate(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
}

/** RFC 5545 text escaping (backslash, newline, comma, semicolon). */
export function icsEscape(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

export function buildIcs(calendarName: string, events: IcsEvent[]): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//HexSchool SMIS//Academic Calendar//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${icsEscape(calendarName)}`,
  ];

  for (const event of events) {
    // DTEND is exclusive for all-day events → inclusive end + 1 day.
    const endExclusive = new Date(event.end.getTime() + 24 * 60 * 60 * 1000);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}@hexschool`,
      `DTSTART;VALUE=DATE:${icsDate(event.start)}`,
      `DTEND;VALUE=DATE:${icsDate(endExclusive)}`,
      `SUMMARY:${icsEscape(event.title)}`,
      ...(event.description
        ? [`DESCRIPTION:${icsEscape(event.description)}`]
        : []),
      ...(event.categories ? [`CATEGORIES:${event.categories}`] : []),
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
