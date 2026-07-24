import { Injectable, NotFoundException } from '@nestjs/common';
import { dhakaToday } from '../../../common/utils/clock.util';
import { EnrollmentsService } from '../../enrollment/services/enrollments.service';
import { LedgerService } from '../../fee/services/ledger.service';
import { NoticesRepository } from '../../communication/repositories/notices.repository';
import { RoutineService } from '../../timetable/services/routine.service';
import { SessionsService } from '../../academic/services/sessions.service';
import { StudentsService } from '../../student/services/students.service';

// Indexed by JS getUTCDay() (0 = Sunday). The PG enum uses 3-letter codes.
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

/**
 * The student experience, assembled from existing per-student services
 * (roadmap M18 §1 "mostly frontend composition"). Every method is keyed
 * on a `studentId` the caller has already proven ownership of (the portal
 * controller runs `OwnershipGuard` + `assertOwnsStudent` first), so the
 * same service serves a student reading themselves and a parent reading a
 * linked child.
 *
 * It reuses the already-scoped reads — `StudentsService.performanceHistory`
 * / `attendanceHistory`, `LedgerService.studentLedger`,
 * `RoutineService.sectionRoutine` — rather than re-querying, so the portal
 * can never disagree with the admin views.
 */
@Injectable()
export class StudentPortalService {
  constructor(
    private readonly students: StudentsService,
    private readonly enrollments: EnrollmentsService,
    private readonly ledger: LedgerService,
    private readonly routine: RoutineService,
    private readonly sessions: SessionsService,
    private readonly notices: NoticesRepository,
  ) {}

  async overview(studentId: string, schoolId: string) {
    const session = await this.sessions.getCurrent(schoolId);
    const [detail, enrollment, attendance, performance, notices] =
      await Promise.all([
        this.students.getDetail(studentId, schoolId),
        session
          ? this.enrollments.getStudentCurrentEnrollment(
              studentId,
              session.id,
              schoolId,
            )
          : Promise.resolve(null),
        this.students.attendanceHistory(studentId, schoolId),
        this.students.performanceHistory(studentId, schoolId),
        this.notices.publishedFeed(schoolId, { take: 5 }),
      ]);

    const dues = session
      ? await this.ledger.studentLedger(studentId, schoolId, session.id)
      : null;

    const todayPeriods =
      enrollment && session
        ? await this.todayRoutine(enrollment.sectionId, session.id, schoolId)
        : [];

    const latestResult =
      performance.items
        .filter((r) => r.publishedAt !== null)
        .sort((a, b) => (b.publishedAt! > a.publishedAt! ? 1 : -1))[0] ?? null;

    return {
      student: {
        id: detail.id,
        name: `${detail.firstName} ${detail.lastName}`.trim(),
        studentUid: detail.studentUid,
        status: detail.status,
        photoUrl: detail.photoUrl ?? null,
      },
      enrollment: enrollment
        ? {
            className: enrollment.class.name,
            sectionName: enrollment.section.name,
            rollNo: enrollment.rollNo,
            groupName: enrollment.group?.name ?? null,
            shiftName: enrollment.shift?.name ?? null,
          }
        : null,
      attendance: {
        percentage: attendance.percentage,
        markedDays: attendance.markedDays,
        present: attendance.counts.PRESENT ?? 0,
        absent: attendance.counts.ABSENT ?? 0,
      },
      result: latestResult,
      averageGpa: performance.averageGpa,
      dues: dues
        ? { outstanding: dues.outstanding, totalBilled: dues.totalBilled }
        : { outstanding: 0, totalBilled: 0 },
      todayPeriods,
      notices: notices.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        pinned: n.pinned,
        createdAt: n.createdAt,
      })),
    };
  }

  attendance(studentId: string, schoolId: string) {
    return this.students.attendanceHistory(studentId, schoolId);
  }

  results(studentId: string, schoolId: string) {
    return this.students.performanceHistory(studentId, schoolId);
  }

  async dues(studentId: string, schoolId: string) {
    const session = await this.sessions.getCurrent(schoolId);
    return this.ledger.studentLedger(studentId, schoolId, session?.id);
  }

  async routineFor(studentId: string, schoolId: string) {
    const session = await this.sessions.getCurrent(schoolId);
    if (!session) throw new NotFoundException('No current session');
    const enrollment = await this.enrollments.getStudentCurrentEnrollment(
      studentId,
      session.id,
      schoolId,
    );
    if (!enrollment) {
      return { available: false, reason: 'Not enrolled this session' };
    }
    const routine = await this.routine.sectionRoutine(
      enrollment.sectionId,
      { sessionId: session.id },
      schoolId,
    );
    return { available: true, ...routine };
  }

  private async todayRoutine(
    sectionId: string,
    sessionId: string,
    schoolId: string,
  ): Promise<
    Array<{
      subject: string;
      teacher: string;
      roomNo: string | null;
      time: string;
    }>
  > {
    try {
      const routine = await this.routine.sectionRoutine(
        sectionId,
        { sessionId },
        schoolId,
      );
      const today = WEEKDAYS[new Date(`${dhakaToday()}T00:00:00Z`).getUTCDay()];
      const timeBySlot = new Map(routine.slots.map((s) => [s.id, s.startTime]));
      return routine.cells
        .filter((c) => c.day === today)
        .map((c) => ({
          subject: c.subject.name,
          teacher: c.teacher.name,
          roomNo: c.roomNo,
          time: timeBySlot.get(c.periodSlotId) ?? '',
        }));
    } catch {
      return [];
    }
  }
}
