import { HolidayAppliesTo } from '../../../common/constants';
import { CalendarService } from './calendar.service';

describe('CalendarService', () => {
  let holidays: Record<string, jest.Mock>;
  let events: Record<string, jest.Mock>;
  let sessions: Record<string, jest.Mock>;
  let settings: { getValue: jest.Mock };
  let service: CalendarService;

  beforeEach(() => {
    holidays = {
      findCovering: jest.fn().mockResolvedValue(null),
      findInRange: jest.fn().mockResolvedValue([]),
    };
    events = { findInRange: jest.fn().mockResolvedValue([]) };
    sessions = { findByIdOrFail: jest.fn() };
    settings = { getValue: jest.fn().mockResolvedValue(['FRIDAY']) };
    service = new CalendarService(
      holidays as never,
      events as never,
      sessions as never,
      settings as never,
    );
  });

  describe('isHoliday', () => {
    it('flags configured weekly off-days (2026-07-17 is a Friday)', async () => {
      const result = await service.isHoliday('s1', new Date('2026-07-17'));
      expect(result).toMatchObject({ holiday: true, reason: 'WEEKLY' });
      expect(holidays.findCovering).not.toHaveBeenCalled();
    });

    it('respects the per-school setting (Saturday configured)', async () => {
      settings.getValue.mockResolvedValue(['FRIDAY', 'SATURDAY']);
      const saturday = await service.isHoliday('s1', new Date('2026-07-18'));
      expect(saturday.holiday).toBe(true);
    });

    it('flags dates covered by a holiday row', async () => {
      holidays.findCovering.mockResolvedValue({ title: 'Victory Day' });
      const result = await service.isHoliday('s1', new Date('2026-12-16'));
      expect(result).toMatchObject({
        holiday: true,
        reason: 'RANGE',
        title: 'Victory Day',
      });
    });

    it('passes appliesTo through to the range lookup', async () => {
      await service.isHoliday(
        's1',
        new Date('2026-12-16'),
        HolidayAppliesTo.STUDENTS,
      );
      expect(holidays.findCovering).toHaveBeenCalledWith(
        's1',
        expect.any(Date),
        HolidayAppliesTo.STUDENTS,
      );
    });

    it('an ordinary working day is not a holiday', async () => {
      const result = await service.isHoliday('s1', new Date('2026-07-15')); // Wednesday
      expect(result).toEqual({ holiday: false });
    });
  });

  describe('month aggregate', () => {
    it('month=YYYY-MM resolves to the exact month span', async () => {
      const result = await service.month({ month: '2026-02' }, 's1');
      expect(result.from).toBe('2026-02-01');
      expect(result.to).toBe('2026-02-28');
      expect(result.weeklyHolidays).toEqual(['FRIDAY']);
    });

    it('sessionId resolves to the session span', async () => {
      sessions.findByIdOrFail.mockResolvedValue({
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
      });
      const result = await service.month({ sessionId: 'sess-1' }, 's1');
      expect(result.from).toBe('2026-01-01');
      expect(result.to).toBe('2026-12-31');
    });
  });

  it('ics includes both holidays and events', async () => {
    holidays.findInRange.mockResolvedValue([
      {
        id: 'h1',
        title: 'Eid',
        startDate: new Date('2026-03-20'),
        endDate: new Date('2026-03-22'),
        type: 'RELIGIOUS',
      },
    ]);
    events.findInRange.mockResolvedValue([
      {
        id: 'e1',
        title: 'Sports Day',
        description: 'Annual sports',
        startDate: new Date('2026-03-05'),
        endDate: new Date('2026-03-05'),
        type: 'SPORTS',
      },
    ]);
    const ics = await service.ics({ month: '2026-03' }, 's1');
    expect(ics).toContain('SUMMARY:Eid');
    expect(ics).toContain('SUMMARY:Sports Day');
    expect(ics).toContain('CATEGORIES:HOLIDAY,RELIGIOUS');
  });
});
