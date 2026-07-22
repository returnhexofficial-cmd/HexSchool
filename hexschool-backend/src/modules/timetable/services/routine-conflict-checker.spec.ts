import { ConflictException } from '@nestjs/common';
import { Weekday } from '../../../common/constants';
import { RoutineConflictChecker } from './routine-conflict-checker';

const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);

/**
 * The M08 hook, live as of M13. The question here is narrower than the
 * builder's: given a routine that already exists, would handing these
 * cells to a different teacher put that person in two rooms at once?
 */
describe('RoutineConflictChecker', () => {
  const CHECK = {
    schoolId: 'school-1',
    sessionId: 'ses-1',
    sectionId: 'sec-a',
    subjectId: 'sub-math',
    teacherId: 'tea-incoming',
  };

  const cell = (overrides: Record<string, unknown> = {}) => ({
    id: 'e-1',
    day: Weekday.SAT,
    subjectId: 'sub-math',
    teacherId: 'tea-outgoing',
    combinedWithSectionId: null,
    periodSlot: {
      id: 'slot-1',
      name: 'Period 1',
      startTime: time('08:00'),
      endTime: time('08:45'),
    },
    timetable: {
      sectionId: 'sec-a',
      section: { name: 'A', class: { name: 'Class 7' } },
    },
    ...overrides,
  });

  /** Something the incoming teacher already does, elsewhere. */
  const elsewhere = (overrides: Record<string, unknown> = {}) =>
    cell({
      id: 'e-2',
      teacherId: 'tea-incoming',
      subjectId: 'sub-other',
      timetable: {
        sectionId: 'sec-b',
        section: { name: 'B', class: { name: 'Class 8' } },
      },
      ...overrides,
    });

  let entries: Record<string, jest.Mock>;
  let checker: RoutineConflictChecker;

  beforeEach(() => {
    entries = { findForSession: jest.fn().mockResolvedValue([]) };
    checker = new RoutineConflictChecker(entries as never);
  });

  it('passes when the section has no routine cells for that subject', async () => {
    await expect(checker.assertNoConflict(CHECK)).resolves.toBeUndefined();
  });

  it('passes when the incoming teacher is free at those times', async () => {
    entries.findForSession.mockResolvedValue([
      cell(),
      elsewhere({
        periodSlot: {
          id: 'slot-3',
          name: 'Period 3',
          startTime: time('10:00'),
          endTime: time('10:45'),
        },
      }),
    ]);
    await expect(checker.assertNoConflict(CHECK)).resolves.toBeUndefined();
  });

  it('refuses when the routine would double-book the incoming teacher', async () => {
    entries.findForSession.mockResolvedValue([cell(), elsewhere()]);
    await expect(checker.assertNoConflict(CHECK)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('names both sections so the message says what to fix', async () => {
    entries.findForSession.mockResolvedValue([cell(), elsewhere()]);
    await expect(checker.assertNoConflict(CHECK)).rejects.toThrow(
      /Class 7 — A.*Class 8 — B/s,
    );
  });

  it('ignores an overlap on a different day', async () => {
    entries.findForSession.mockResolvedValue([
      cell(),
      elsewhere({ day: Weekday.SUN }),
    ]);
    await expect(checker.assertNoConflict(CHECK)).resolves.toBeUndefined();
  });

  it("ignores the teacher's OWN cells in the section being reassigned", async () => {
    entries.findForSession.mockResolvedValue([
      cell(),
      // Same section, so not competition — this is the slot being handed over.
      cell({ id: 'e-3', teacherId: 'tea-incoming', subjectId: 'sub-other' }),
    ]);
    await expect(checker.assertNoConflict(CHECK)).resolves.toBeUndefined();
  });

  it('allows a combined class — the pair is one lesson, not two', async () => {
    entries.findForSession.mockResolvedValue([
      cell({ combinedWithSectionId: 'sec-b' }),
      elsewhere({ combinedWithSectionId: 'sec-a' }),
    ]);
    await expect(checker.assertNoConflict(CHECK)).resolves.toBeUndefined();
  });
});
