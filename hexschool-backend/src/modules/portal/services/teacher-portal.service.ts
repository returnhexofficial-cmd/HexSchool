import { ForbiddenException, Injectable } from '@nestjs/common';
import { Weekday } from '@prisma/client';
import { dhakaToday } from '../../../common/utils/clock.util';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { EnrollmentsService } from '../../enrollment/services/enrollments.service';
import { NoticesRepository } from '../../communication/repositories/notices.repository';
import { RoutineService } from '../../timetable/services/routine.service';
import { SessionsService } from '../../academic/services/sessions.service';

// Indexed by JS getUTCDay() (0 = Sunday). The PG enum uses 3-letter codes.
const WEEKDAYS: Weekday[] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/**
 * The teacher experience (roadmap M18 §5): today's periods, the weekly
 * routine, the sections they teach, and notices — composed from the
 * exported `RoutineService` (which already draws a teacher's week across
 * shifts) and the roster service. A section roster is only readable by a
 * teacher who actually appears in that section's routine (ownership).
 */
@Injectable()
export class TeacherPortalService {
  constructor(
    private readonly routine: RoutineService,
    private readonly enrollments: EnrollmentsService,
    private readonly sessions: SessionsService,
    private readonly notices: NoticesRepository,
    private readonly prisma: PrismaService,
  ) {}

  async overview(teacherId: string, schoolId: string) {
    const session = await this.sessions.getCurrent(schoolId);
    const notices = await this.notices.publishedFeed(schoolId, { take: 5 });

    // Brand-new school with no current session yet (roadmap §8): return a
    // graceful zero-state rather than 400-ing the teacher's landing page.
    if (!session) {
      const row = await this.prisma.teacher.findFirst({
        where: { id: teacherId, schoolId, deletedAt: null },
        select: { id: true, firstName: true, lastName: true, employeeId: true },
      });
      return {
        teacher: {
          id: teacherId,
          name: row ? `${row.firstName} ${row.lastName}`.trim() : '',
          employeeId: row?.employeeId ?? '',
        },
        session: null,
        todayPeriods: [],
        periodsPerWeek: 0,
        freeToday: 0,
        sections: [],
        notices: notices.map((n) => ({
          id: n.id,
          title: n.title,
          body: n.body,
          pinned: n.pinned,
          createdAt: n.createdAt,
        })),
      };
    }

    const week = await this.routine.teacherRoutine(
      teacherId,
      { sessionId: session.id },
      schoolId,
    );

    const today = WEEKDAYS[new Date(`${dhakaToday()}T00:00:00Z`).getUTCDay()];
    const timeBySlot = new Map(week.slots.map((s) => [s.id, s.startTime]));
    const todayPeriods = week.cells
      .filter((c) => c.day === today)
      .map((c) => ({
        subject: c.subject.name,
        section: c.sectionLabel,
        roomNo: c.roomNo,
        time: timeBySlot.get(c.periodSlotId) ?? '',
      }))
      .sort((a, b) => a.time.localeCompare(b.time));

    const sections = [
      ...new Map(
        week.cells.map((c) => [c.sectionId, c.sectionLabel]),
      ).entries(),
    ].map(([id, label]) => ({ id, label }));

    return {
      teacher: week.teacher,
      session: week.session,
      todayPeriods,
      periodsPerWeek: week.periodsPerWeek,
      freeToday: week.freeByDay[today] ?? 0,
      sections,
      notices: notices.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        pinned: n.pinned,
        createdAt: n.createdAt,
      })),
    };
  }

  routineFor(teacherId: string, schoolId: string) {
    return this.routine.teacherRoutine(teacherId, {}, schoolId);
  }

  /** Roster of a section this teacher teaches (ownership-checked). */
  async sectionRoster(teacherId: string, sectionId: string, schoolId: string) {
    const week = await this.routine.teacherRoutine(teacherId, {}, schoolId);
    const teaches = week.cells.some((c) => c.sectionId === sectionId);
    if (!teaches) {
      throw new ForbiddenException('You do not teach this section');
    }
    const roster = await this.enrollments.getSectionStudents(
      sectionId,
      schoolId,
    );
    return roster.map((e) => ({
      enrollmentId: e.id,
      studentId: e.studentId,
      rollNo: e.rollNo,
      name: `${e.student.firstName} ${e.student.lastName}`.trim(),
      studentUid: e.student.studentUid,
    }));
  }
}
