import { BadRequestException } from '@nestjs/common';
import {
  dateRange,
  dhakaDisplayDate,
  dhakaMinutesOfDay,
  dhakaToday,
  minutesOfDay,
  minutesOfDayOr,
  timeColumnMinutes,
} from './clock.util';

describe('Dhaka clock helpers', () => {
  it('rolls the local day over at 18:00 UTC', () => {
    // 17:59 UTC is still the 20th in Dhaka (23:59); 18:00 is the 21st.
    expect(dhakaToday(new Date('2026-07-20T17:59:00Z'))).toBe('2026-07-20');
    expect(dhakaToday(new Date('2026-07-20T18:00:00Z'))).toBe('2026-07-21');
  });

  it('reports minutes since local midnight', () => {
    // 02:30 UTC = 08:30 Dhaka.
    expect(dhakaMinutesOfDay(new Date('2026-07-20T02:30:00Z'))).toBe(510);
  });

  it('parses HH:mm and rejects malformed values', () => {
    expect(minutesOfDay('08:15')).toBe(495);
    expect(minutesOfDay('00:00')).toBe(0);
    expect(() => minutesOfDay('24:00')).toThrow(BadRequestException);
    expect(() => minutesOfDay('8:15')).toThrow(BadRequestException);
    expect(() => minutesOfDay('nonsense')).toThrow(BadRequestException);
  });

  it('falls back instead of throwing on bad settings values', () => {
    expect(minutesOfDayOr('bad', '08:00')).toBe(480);
    expect(minutesOfDayOr(undefined, '11:00')).toBe(660);
    expect(minutesOfDayOr('09:30', '08:00')).toBe(570);
  });

  it('reads a Prisma @db.Time column as minutes of day', () => {
    expect(timeColumnMinutes(new Date('1970-01-01T07:45:00Z'))).toBe(465);
  });

  it('lists an inclusive date range', () => {
    expect(dateRange(new Date('2026-07-20'), new Date('2026-07-22'))).toEqual([
      '2026-07-20',
      '2026-07-21',
      '2026-07-22',
    ]);
  });
});

/**
 * QA finding F24 (backend half) — a student ID card printed
 * `Date of Birth 2014-01-01`, and five other generated documents printed the
 * same machine form on paper handed to parents.
 */
describe('dhakaDisplayDate', () => {
  it('renders DD/MM/YYYY, not the ISO form', () => {
    expect(dhakaDisplayDate(new Date('2014-01-01T00:00:00.000Z'))).toBe(
      '01/01/2014',
    );
  });

  it('pads a single-digit day and month', () => {
    expect(dhakaDisplayDate(new Date('2026-08-05T00:00:00.000Z'))).toBe(
      '05/08/2026',
    );
  });

  it('reads the Dhaka calendar, not the UTC one', () => {
    // 19:30 UTC on the 18th is already 01:30 on the 19th in Dhaka — the hour
    // at which a receipt printed in Bangladesh would otherwise be back-dated.
    expect(dhakaDisplayDate(new Date('2026-08-18T19:30:00.000Z'))).toBe(
      '19/08/2026',
    );
    expect(dhakaDisplayDate(new Date('2026-08-18T17:30:00.000Z'))).toBe(
      '18/08/2026',
    );
  });
});
