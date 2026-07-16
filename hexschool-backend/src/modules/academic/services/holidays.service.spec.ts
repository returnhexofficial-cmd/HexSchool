import { BadRequestException } from '@nestjs/common';
import { UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { HolidaysService } from './holidays.service';

describe('HolidaysService', () => {
  const actor: AccessTokenPayload = {
    sub: 'actor-1',
    schoolId: 'school-1',
    userType: UserType.ADMIN,
  };
  const session = {
    id: 'sess-1',
    name: '2026',
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-12-31'),
  };

  let holidays: Record<string, jest.Mock>;
  let sessions: Record<string, jest.Mock>;
  let service: HolidaysService;

  beforeEach(() => {
    holidays = {
      paginate: jest.fn(),
      findByIdOrFail: jest.fn(),
      create: jest
        .fn()
        .mockImplementation((data: object) =>
          Promise.resolve({ id: 'hol-new', ...data }),
        ),
      update: jest.fn(),
      hardDelete: jest.fn(),
    };
    sessions = { findByIdOrFail: jest.fn().mockResolvedValue(session) };
    service = new HolidaysService(
      holidays as never,
      sessions as never,
      { set: jest.fn() } as never,
    );
  });

  it('rejects a holiday outside its session range', async () => {
    await expect(
      service.create(
        {
          sessionId: session.id,
          title: 'New Year',
          startDate: '2027-01-01',
          endDate: '2027-01-01',
        },
        actor,
      ),
    ).rejects.toThrow(/within session/);
  });

  it('accepts a holiday inside the session', async () => {
    await expect(
      service.create(
        {
          sessionId: session.id,
          title: 'Victory Day',
          startDate: '2026-12-16',
          endDate: '2026-12-16',
        },
        actor,
      ),
    ).resolves.toMatchObject({ id: 'hol-new' });
  });

  describe('CSV import', () => {
    const importCsv = (csv: string) =>
      service.importCsv(session.id, csv, actor);

    it('rejects an empty file and a wrong header', async () => {
      await expect(importCsv('')).rejects.toThrow(BadRequestException);
      await expect(importCsv('name,from,to\nX,1,2')).rejects.toThrow(/header/);
    });

    it('imports valid rows and reports invalid ones with line numbers', async () => {
      const report = await importCsv(
        [
          'title,start_date,end_date,type,applies_to',
          'Victory Day,2026-12-16,2026-12-16,GOVERNMENT,ALL',
          'Bad date,16-12-2026,2026-12-16,GOVERNMENT,ALL',
          'Outside,2027-01-05,2027-01-06,SCHOOL,',
          'Eid Holidays,2026-03-20,2026-03-22,RELIGIOUS,ALL',
          'Bad type,2026-05-01,2026-05-01,PARTY,ALL',
        ].join('\n'),
      );
      expect(report.imported).toBe(2);
      expect(report.errors.map((e) => e.line)).toEqual([3, 4, 6]);
      expect(report.errors[0].message).toContain('YYYY-MM-DD');
      expect(report.errors[1].message).toContain('outside the session');
      expect(report.errors[2].message).toContain('type must be one of');
      expect(holidays.create).toHaveBeenCalledTimes(2);
    });
  });
});
