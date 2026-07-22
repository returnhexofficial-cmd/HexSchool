import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  PeriodSlotType,
  SessionStatus,
  TimetableStatus,
  UserType,
  Weekday,
} from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { TimetableService } from './timetable.service';

const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);

/**
 * The builder rules the roadmap (M13 §6) makes non-negotiable: no lesson
 * in a break, only curriculum subjects, no teaching on a weekly holiday,
 * no publishing an empty grid — plus the one rule that IS overridable
 * (placing an unassigned teacher) and the archive-on-publish contract.
 */
describe('TimetableService', () => {
  const actor: AccessTokenPayload = {
    sub: 'actor-1',
    schoolId: 'school-1',
    userType: UserType.ADMIN,
  };

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

  const DRAFT = {
    id: 'tt-1',
    schoolId: 'school-1',
    sessionId: 'ses-1',
    sectionId: 'sec-1',
    status: TimetableStatus.DRAFT,
    version: 1,
    effectiveFrom: new Date('2026-01-10'),
    publishedAt: null,
    section: {
      id: 'sec-1',
      name: 'A',
      classId: 'cls-7',
      groupId: null,
      shiftId: 'shift-1',
      roomNo: '101',
      class: { id: 'cls-7', name: 'Class 7', numericLevel: 7 },
      shift: { id: 'shift-1', name: 'Morning' },
    },
    session: { id: 'ses-1', name: '2026' },
  };

  let timetables: Record<string, jest.Mock>;
  let entries: Record<string, jest.Mock>;
  let slots: Record<string, jest.Mock>;
  let sections: Record<string, jest.Mock>;
  let subjects: Record<string, jest.Mock>;
  let classSubjects: Record<string, jest.Mock>;
  let teachers: Record<string, jest.Mock>;
  let assignments: Record<string, jest.Mock>;
  let sessions: Record<string, jest.Mock>;
  let config: Record<string, jest.Mock>;
  let permissions: Record<string, jest.Mock>;
  let service: TimetableService;

  beforeEach(() => {
    timetables = {
      findDetail: jest.fn().mockResolvedValue(DRAFT),
      findLive: jest.fn().mockResolvedValue(null),
      findVersions: jest.fn().mockResolvedValue([]),
      findForSession: jest.fn().mockResolvedValue([]),
      maxVersion: jest.fn().mockResolvedValue(0),
      create: jest
        .fn()
        .mockImplementation((data: object) =>
          Promise.resolve({ id: 'tt-new', version: 1, ...data }),
        ),
      setStatus: jest.fn().mockResolvedValue(DRAFT),
      softDelete: jest.fn().mockResolvedValue(undefined),
      withTransaction: jest
        .fn()
        .mockImplementation((fn: (tx: unknown) => unknown) => fn({})),
    };
    entries = {
      findForTimetable: jest.fn().mockResolvedValue([]),
      findForSession: jest.fn().mockResolvedValue([]),
      replaceForTimetable: jest.fn().mockResolvedValue(1),
      countForTimetable: jest.fn().mockResolvedValue(0),
      cloneInto: jest.fn().mockResolvedValue(0),
    };
    slots = {
      findForShift: jest.fn().mockResolvedValue(SLOTS),
      findAllWithShift: jest.fn().mockResolvedValue(SLOTS),
      findByIds: jest.fn().mockResolvedValue([SLOTS[0]]),
    };
    sections = { findDetail: jest.fn().mockResolvedValue(DRAFT.section) };
    subjects = {
      findById: jest.fn().mockResolvedValue({ id: 'sub-9', name: 'Biology' }),
    };
    classSubjects = {
      findForClassSession: jest
        .fn()
        .mockResolvedValue([{ subjectId: 'sub-1', groupId: null }]),
    };
    teachers = {
      findById: jest
        .fn()
        .mockResolvedValue({ id: 'tea-1', firstName: 'Mr', lastName: 'X' }),
      findByIdOrFail: jest
        .fn()
        .mockResolvedValue({ id: 'tea-1', firstName: 'Mr', lastName: 'X' }),
    };
    assignments = {
      findBySlot: jest.fn().mockResolvedValue({ teacherId: 'tea-1' }),
    };
    sessions = {
      getById: jest.fn().mockResolvedValue({
        id: 'ses-1',
        name: '2026',
        status: SessionStatus.ACTIVE,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
      }),
      getCurrent: jest.fn().mockResolvedValue({ id: 'ses-1' }),
    };
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

    service = new TimetableService(
      timetables as never,
      entries as never,
      slots as never,
      sections as never,
      subjects as never,
      classSubjects as never,
      teachers as never,
      assignments as never,
      sessions as never,
      config as never,
      permissions as never,
      { set: jest.fn() } as never,
    );
  });

  const cell = (overrides: object = {}) => ({
    day: Weekday.SAT,
    periodSlotId: 'slot-1',
    subjectId: 'sub-1',
    teacherId: 'tea-1',
    ...overrides,
  });

  describe('createDraft', () => {
    it('refuses a second draft for the same section', async () => {
      timetables.findLive.mockResolvedValue({ id: 'tt-existing' });
      await expect(
        service.createDraft({ sectionId: 'sec-1' }, actor),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses an effective date outside the session', async () => {
      await expect(
        service.createDraft(
          { sectionId: 'sec-1', effectiveFrom: '2027-03-01' },
          actor,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to touch a COMPLETED session (the M05 read-only rule)', async () => {
      sessions.getById.mockResolvedValue({
        id: 'ses-1',
        name: '2025',
        status: SessionStatus.COMPLETED,
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-12-31'),
      });
      await expect(
        service.createDraft({ sectionId: 'sec-1' }, actor),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('seeds the draft from the published routine when asked', async () => {
      timetables.findLive.mockImplementation(
        (_s: string, _sec: string, status: TimetableStatus) =>
          Promise.resolve(
            status === TimetableStatus.PUBLISHED ? { id: 'tt-pub' } : null,
          ),
      );
      await service.createDraft(
        { sectionId: 'sec-1', copyFromPublished: true },
        actor,
      );
      expect(entries.cloneInto).toHaveBeenCalledWith(
        'tt-pub',
        'tt-new',
        'actor-1',
        expect.anything(),
      );
    });
  });

  describe('replaceEntries', () => {
    it('saves a valid grid', async () => {
      const result = await service.replaceEntries(
        'tt-1',
        { entries: [cell()] },
        actor,
      );
      expect(result.saved).toBe(1);
      expect(result.conflicts).toEqual([]);
    });

    it('defaults a cell room to the section room', async () => {
      await service.replaceEntries('tt-1', { entries: [cell()] }, actor);
      expect(entries.replaceForTimetable).toHaveBeenCalledWith('tt-1', [
        expect.objectContaining({ roomNo: '101' }),
      ]);
    });

    it('rejects a lesson placed in a BREAK slot', async () => {
      await expect(
        service.replaceEntries(
          'tt-1',
          { entries: [cell({ periodSlotId: 'slot-tiffin' })] },
          actor,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a period belonging to another shift', async () => {
      await expect(
        service.replaceEntries(
          'tt-1',
          { entries: [cell({ periodSlotId: 'slot-elsewhere' })] },
          actor,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a subject that is not on the class curriculum', async () => {
      await expect(
        service.replaceEntries(
          'tt-1',
          { entries: [cell({ subjectId: 'sub-9' })] },
          actor,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects teaching on a weekly holiday', async () => {
      await expect(
        service.replaceEntries(
          'tt-1',
          { entries: [cell({ day: Weekday.FRI })] },
          actor,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a combined marker pointing at the section itself', async () => {
      await expect(
        service.replaceEntries(
          'tt-1',
          { entries: [cell({ combinedWithSectionId: 'sec-1' })] },
          actor,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses an unassigned teacher without override', async () => {
      assignments.findBySlot.mockResolvedValue({ teacherId: 'someone-else' });
      await expect(
        service.replaceEntries('tt-1', { entries: [cell()] }, actor),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses the override itself without the permission', async () => {
      assignments.findBySlot.mockResolvedValue(null);
      await expect(
        service.replaceEntries(
          'tt-1',
          { entries: [cell()], override: true },
          actor,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows an unassigned teacher with override + permission, and reports it', async () => {
      assignments.findBySlot.mockResolvedValue(null);
      permissions.getUserPermissionCodes.mockResolvedValue([
        'timetable.assign.override',
      ]);
      const result = await service.replaceEntries(
        'tt-1',
        { entries: [cell()], override: true },
        actor,
      );
      expect(result.unassignedOverrides).toHaveLength(1);
    });

    it('refuses the WHOLE payload when any cell conflicts — nothing is saved', async () => {
      entries.findForSession.mockResolvedValue([
        {
          id: 'other',
          timetableId: 'tt-2',
          teacherId: 'tea-1',
          day: Weekday.SAT,
          periodSlotId: 'slot-x',
          roomNo: null,
          combinedWithSectionId: null,
          subject: { id: 's', name: 'Math', code: 'M', type: 'THEORY' },
          teacher: { id: 'tea-1', firstName: 'Mr', lastName: 'X' },
          periodSlot: {
            id: 'slot-x',
            name: 'P1',
            startTime: time('08:00'),
            endTime: time('08:45'),
          },
          combinedWithSection: null,
          timetable: {
            sectionId: 'sec-2',
            section: { name: 'B', class: { name: 'Class 7' } },
          },
        },
      ]);
      await expect(
        service.replaceEntries('tt-1', { entries: [cell()] }, actor),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(entries.replaceForTimetable).not.toHaveBeenCalled();
    });

    it('refuses to edit anything but a DRAFT', async () => {
      timetables.findDetail.mockResolvedValue({
        ...DRAFT,
        status: TimetableStatus.PUBLISHED,
      });
      await expect(
        service.replaceEntries('tt-1', { entries: [cell()] }, actor),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('publish', () => {
    const savedCell = {
      id: 'e-1',
      timetableId: 'tt-1',
      teacherId: 'tea-1',
      day: Weekday.SAT,
      periodSlotId: 'slot-1',
      roomNo: '101',
      combinedWithSectionId: null,
      subject: { id: 'sub-1', name: 'Math', code: 'M', type: 'THEORY' },
      teacher: { id: 'tea-1', firstName: 'Mr', lastName: 'X' },
      periodSlot: {
        id: 'slot-1',
        name: 'Period 1',
        startTime: time('08:00'),
        endTime: time('08:45'),
      },
      combinedWithSection: null,
      timetable: {
        sectionId: 'sec-1',
        section: { name: 'A', class: { name: 'Class 7' } },
      },
    };

    it('refuses to publish an empty routine', async () => {
      entries.findForTimetable.mockResolvedValue([]);
      await expect(service.publish('tt-1', {}, actor)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('archives the routine it replaces BEFORE promoting the draft', async () => {
      entries.findForTimetable.mockResolvedValue([savedCell]);
      timetables.findLive.mockResolvedValue({ id: 'tt-old' });

      await service.publish('tt-1', {}, actor);

      // Order matters: uq_timetables_live_version permits only one
      // non-archived row per (session, section, status).
      const calls = timetables.setStatus.mock.calls as Array<
        [string, { status: TimetableStatus }]
      >;
      expect(calls[0][0]).toBe('tt-old');
      expect(calls[0][1]).toMatchObject({ status: TimetableStatus.ARCHIVED });
      expect(calls[1][0]).toBe('tt-1');
      expect(calls[1][1]).toMatchObject({ status: TimetableStatus.PUBLISHED });
    });

    it('re-runs the conflict engine — a clash that appeared since the last save blocks it', async () => {
      entries.findForTimetable.mockResolvedValue([savedCell]);
      entries.findForSession.mockResolvedValue([
        {
          ...savedCell,
          id: 'rival',
          timetableId: 'tt-2',
          timetable: {
            sectionId: 'sec-2',
            section: { name: 'B', class: { name: 'Class 7' } },
          },
        },
      ]);
      await expect(service.publish('tt-1', {}, actor)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(timetables.setStatus).not.toHaveBeenCalled();
    });

    it('refuses to publish something already published', async () => {
      timetables.findDetail.mockResolvedValue({
        ...DRAFT,
        status: TimetableStatus.PUBLISHED,
      });
      await expect(service.publish('tt-1', {}, actor)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('remove', () => {
    it('deletes a draft', async () => {
      await service.remove('tt-1', actor);
      expect(timetables.softDelete).toHaveBeenCalledWith('tt-1');
    });

    it('keeps published versions — they are the section history', async () => {
      timetables.findDetail.mockResolvedValue({
        ...DRAFT,
        status: TimetableStatus.PUBLISHED,
      });
      await expect(service.remove('tt-1', actor)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});
