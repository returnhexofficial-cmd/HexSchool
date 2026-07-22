import {
  PeriodSlotType,
  TimetableStatus,
  UserType,
  Weekday,
} from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { RoutineService } from './routine.service';

const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);

/**
 * `getCurrentPeriod` is the contract M12 period-mode attendance leans on,
 * so its edge cases (holiday, between periods, unbuilt routine) get the
 * detail here. The draft-visibility rule (roadmap M13 §6) is checked too:
 * a draft must never leak into a portal view.
 */
describe('RoutineService', () => {
  const SLOTS = [
    {
      id: 'slot-1',
      shiftId: 'shift-1',
      name: 'Period 1',
      startTime: time('08:00'),
      endTime: time('08:45'),
      type: PeriodSlotType.CLASS,
      displayOrder: 1,
    },
    {
      id: 'slot-tiffin',
      shiftId: 'shift-1',
      name: 'Tiffin',
      startTime: time('08:45'),
      endTime: time('09:05'),
      type: PeriodSlotType.BREAK,
      displayOrder: 2,
    },
  ];

  const SECTION = {
    id: 'sec-1',
    name: 'A',
    sessionId: 'ses-1',
    shiftId: 'shift-1',
    roomNo: '101',
    class: { id: 'cls-7', name: 'Class 7', numericLevel: 7 },
    shift: { id: 'shift-1', name: 'Morning' },
  };

  const ENTRY = {
    id: 'e-1',
    timetableId: 'tt-1',
    teacherId: 'tea-1',
    day: Weekday.SAT,
    periodSlotId: 'slot-1',
    roomNo: '101',
    combinedWithSectionId: null,
    subject: { id: 'sub-1', name: 'Mathematics', code: 'MATH', type: 'THEORY' },
    teacher: {
      id: 'tea-1',
      firstName: 'Mr',
      lastName: 'X',
      employeeId: 'T-01',
      photoUrl: null,
    },
    periodSlot: { ...SLOTS[0] },
    combinedWithSection: null,
    timetable: {
      id: 'tt-1',
      status: TimetableStatus.PUBLISHED,
      version: 1,
      sessionId: 'ses-1',
      sectionId: 'sec-1',
      section: {
        id: 'sec-1',
        name: 'A',
        roomNo: '101',
        class: { id: 'cls-7', name: 'Class 7', numericLevel: 7 },
        shift: { id: 'shift-1', name: 'Morning' },
      },
    },
  };

  let timetables: Record<string, jest.Mock>;
  let entries: Record<string, jest.Mock>;
  let slots: Record<string, jest.Mock>;
  let sections: Record<string, jest.Mock>;
  let teachers: Record<string, jest.Mock>;
  let sessions: Record<string, jest.Mock>;
  let calendar: Record<string, jest.Mock>;
  let config: Record<string, jest.Mock>;
  let permissions: Record<string, jest.Mock>;
  let service: RoutineService;

  beforeEach(() => {
    timetables = {
      findLive: jest
        .fn()
        .mockImplementation(
          (_s: string, _sec: string, status: TimetableStatus) =>
            Promise.resolve(
              status === TimetableStatus.PUBLISHED
                ? {
                    id: 'tt-1',
                    status,
                    version: 1,
                    sectionId: 'sec-1',
                    sessionId: 'ses-1',
                    effectiveFrom: new Date('2026-01-10'),
                    publishedAt: new Date('2026-01-09'),
                  }
                : null,
            ),
        ),
      findForSession: jest.fn().mockResolvedValue([]),
    };
    entries = {
      findForTimetable: jest.fn().mockResolvedValue([ENTRY]),
      findForSession: jest.fn().mockResolvedValue([ENTRY]),
      findForTeacher: jest.fn().mockResolvedValue([ENTRY]),
      periodsPerWeek: jest.fn().mockResolvedValue([]),
    };
    slots = {
      findForShift: jest.fn().mockResolvedValue(SLOTS),
      findAllWithShift: jest.fn().mockResolvedValue(
        SLOTS.map((s) => ({
          ...s,
          shift: { id: 'shift-1', name: 'Morning' },
        })),
      ),
    };
    sections = {
      findDetail: jest.fn().mockResolvedValue(SECTION),
      findForSessionWithRelations: jest.fn().mockResolvedValue([SECTION]),
    };
    teachers = {
      findByIdOrFail: jest.fn().mockResolvedValue({
        id: 'tea-1',
        firstName: 'Mr',
        lastName: 'X',
        employeeId: 'T-01',
      }),
    };
    sessions = {
      getById: jest.fn().mockResolvedValue({ id: 'ses-1', name: '2026' }),
      getCurrent: jest.fn().mockResolvedValue({ id: 'ses-1', name: '2026' }),
    };
    calendar = { isHoliday: jest.fn().mockResolvedValue({ holiday: false }) };
    config = {
      load: jest.fn().mockResolvedValue({
        workingDays: [Weekday.SAT, Weekday.SUN, Weekday.MON],
        weeklyHolidays: [Weekday.FRI],
        checkRooms: true,
        allowCombined: true,
        maxPeriodsPerTeacherPerDay: 0,
      }),
    };
    permissions = { getUserPermissionCodes: jest.fn().mockResolvedValue([]) };

    service = new RoutineService(
      timetables as never,
      entries as never,
      slots as never,
      sections as never,
      teachers as never,
      sessions as never,
      calendar as never,
      config as never,
      permissions as never,
    );
  });

  // 2026-01-10 is a Saturday — the first day of the BD school week.
  const SATURDAY = '2026-01-10';

  describe('getCurrentPeriod', () => {
    it('returns the running period and its routine cell', async () => {
      const result = await service.getCurrentPeriod(
        'sec-1',
        { date: SATURDAY, at: '08:20' },
        'school-1',
      );
      expect(result.day).toBe(Weekday.SAT);
      expect(result.slot?.name).toBe('Period 1');
      expect(result.cell?.subject.name).toBe('Mathematics');
    });

    it('returns the slot with a null cell when the routine has a gap there', async () => {
      entries.findForTimetable.mockResolvedValue([]);
      const result = await service.getCurrentPeriod(
        'sec-1',
        { date: SATURDAY, at: '08:20' },
        'school-1',
      );
      expect(result.slot?.id).toBe('slot-1');
      expect(result.cell).toBeNull();
    });

    it('returns a BREAK slot — a school may still take attendance in tiffin', async () => {
      const result = await service.getCurrentPeriod(
        'sec-1',
        { date: SATURDAY, at: '08:50' },
        'school-1',
      );
      expect(result.slot?.name).toBe('Tiffin');
      expect(result.cell).toBeNull();
    });

    it('returns no slot between the school day and the bell schedule', async () => {
      const result = await service.getCurrentPeriod(
        'sec-1',
        { date: SATURDAY, at: '07:30' },
        'school-1',
      );
      expect(result.slot).toBeNull();
    });

    it('short-circuits on a holiday without touching the routine', async () => {
      calendar.isHoliday.mockResolvedValue({
        holiday: true,
        reason: 'RANGE',
        title: 'Victory Day',
      });
      const result = await service.getCurrentPeriod(
        'sec-1',
        { date: SATURDAY, at: '08:20' },
        'school-1',
      );
      expect(result.holiday).toBe(true);
      expect(result.holidayTitle).toBe('Victory Day');
      expect(result.slot).toBeNull();
      expect(entries.findForTimetable).not.toHaveBeenCalled();
    });

    it('returns the slot but no cell when the section has no routine yet', async () => {
      timetables.findLive.mockResolvedValue(null);
      const result = await service.getCurrentPeriod(
        'sec-1',
        { date: SATURDAY, at: '08:20' },
        'school-1',
      );
      expect(result.slot?.id).toBe('slot-1');
      expect(result.cell).toBeNull();
    });
  });

  describe('sectionRoutine', () => {
    it('returns the published grid with its axes', async () => {
      const routine = await service.sectionRoutine('sec-1', {}, 'school-1');
      expect(routine.timetable?.status).toBe(TimetableStatus.PUBLISHED);
      expect(routine.days).toEqual([Weekday.SAT, Weekday.SUN, Weekday.MON]);
      expect(routine.slots).toHaveLength(2);
      expect(routine.cells).toHaveLength(1);
    });

    it('hides an unpublished routine from a plain viewer', async () => {
      timetables.findLive.mockImplementation((_s, _sec, status) =>
        Promise.resolve(
          status === TimetableStatus.DRAFT ? { id: 'tt-draft' } : null,
        ),
      );
      const routine = await service.sectionRoutine('sec-1', {}, 'school-1');
      expect(routine.timetable).toBeNull();
      expect(routine.cells).toEqual([]);
    });

    it('shows the draft when the builder asks for it', async () => {
      timetables.findLive.mockImplementation(
        (_s: string, _sec: string, status: TimetableStatus) =>
          Promise.resolve(
            status === TimetableStatus.DRAFT
              ? {
                  id: 'tt-draft',
                  status,
                  version: 2,
                  effectiveFrom: new Date('2026-02-01'),
                  publishedAt: null,
                }
              : null,
          ),
      );
      const routine = await service.sectionRoutine(
        'sec-1',
        { includeDraft: true },
        'school-1',
      );
      expect(routine.timetable?.status).toBe(TimetableStatus.DRAFT);
    });
  });

  describe('teacherRoutine', () => {
    it('counts periods per week and the free periods left per day', async () => {
      const routine = await service.teacherRoutine('tea-1', {}, 'school-1');
      expect(routine.periodsPerWeek).toBe(1);
      // One CLASS slot exists; Saturday is booked, the rest are free.
      expect(routine.freeByDay[Weekday.SAT]).toBe(0);
      expect(routine.freeByDay[Weekday.SUN]).toBe(1);
    });

    it('labels each cell with the section it is taught in', async () => {
      const routine = await service.teacherRoutine('tea-1', {}, 'school-1');
      expect(routine.cells[0].sectionLabel).toBe('Class 7 — A');
    });
  });

  describe('canPreviewDrafts', () => {
    const actor = (userType: UserType): AccessTokenPayload => ({
      sub: 'actor-1',
      schoolId: 'school-1',
      userType,
    });

    it('lets a Super Admin through without a permission lookup', async () => {
      await expect(
        service.canPreviewDrafts(actor(UserType.SUPER_ADMIN)),
      ).resolves.toBe(true);
      expect(permissions.getUserPermissionCodes).not.toHaveBeenCalled();
    });

    it('requires timetable.manage for everyone else', async () => {
      await expect(
        service.canPreviewDrafts(actor(UserType.STAFF)),
      ).resolves.toBe(false);
      permissions.getUserPermissionCodes.mockResolvedValue([
        'timetable.manage',
      ]);
      await expect(
        service.canPreviewDrafts(actor(UserType.STAFF)),
      ).resolves.toBe(true);
    });
  });

  describe('masterRoutine', () => {
    it('reports coverage per section and the teacher heat list', async () => {
      timetables.findForSession.mockResolvedValue([
        { id: 'tt-1', sectionId: 'sec-1', status: TimetableStatus.PUBLISHED },
      ]);
      const master = await service.masterRoutine({}, 'school-1');
      expect(master.sections[0].filled).toBe(1);
      // 1 CLASS slot × 3 working days.
      expect(master.sections[0].capacity).toBe(3);
      expect(master.teacherLoad[0]).toMatchObject({
        teacherId: 'tea-1',
        periodsPerWeek: 1,
      });
    });
  });
});
