import { buildIcs, icsDate, icsEscape } from './ics.util';

describe('ics util', () => {
  it('formats all-day dates as YYYYMMDD', () => {
    expect(icsDate(new Date('2026-02-05'))).toBe('20260205');
  });

  it('escapes RFC 5545 special characters', () => {
    expect(icsEscape('Eid, day 1; note\nnext')).toBe(
      'Eid\\, day 1\\; note\\nnext',
    );
  });

  it('builds a calendar with exclusive DTEND (+1 day)', () => {
    const ics = buildIcs('Test Cal', [
      {
        uid: 'h1',
        title: 'Victory Day',
        start: new Date('2026-12-16'),
        end: new Date('2026-12-16'),
        categories: 'HOLIDAY,GOVERNMENT',
      },
    ]);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('X-WR-CALNAME:Test Cal');
    expect(ics).toContain('UID:h1@hexschool');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261216');
    expect(ics).toContain('DTEND;VALUE=DATE:20261217'); // inclusive end + 1
    expect(ics).toContain('SUMMARY:Victory Day');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
});
