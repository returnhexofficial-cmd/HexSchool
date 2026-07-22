import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { timeColumnMinutes } from '../../../common/utils/clock.util';
import { isoDate, parseDate } from '../../academic/calendar/date.util';
import { CalendarService } from '../../academic/services/calendar.service';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { clock, ExamClash } from '../calc/exam-clash.engine';
import { ShiftExamDayDto } from '../dto';
import { ExamSubjectsRepository } from '../repositories/exam-subjects.repository';
import { ExamsRepository } from '../repositories/exams.repository';
import { ExamClashService, isScheduled } from './exam-clash.service';
import { ExamsService } from './exams.service';

export interface RoutineSitting {
  examSubjectId: string;
  classId: string;
  className: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  startTime: string;
  endTime: string;
  durationMin: number;
  room: string | null;
  fullMarks: number;
  passMarks: number;
}

export interface RoutineDay {
  date: string;
  /** Weekly off-day or a declared holiday (M05) — worth flagging loudly. */
  holiday: boolean;
  holidayTitle?: string;
  sittings: RoutineSitting[];
}

export interface ExamRoutine {
  exam: {
    id: string;
    name: string;
    status: string;
    startDate: string;
    endDate: string;
    examTypeName: string;
    sessionName: string;
  };
  days: RoutineDay[];
  unscheduled: Array<{
    examSubjectId: string;
    classId: string;
    className: string;
    subjectId: string;
    subjectName: string;
  }>;
  /** Clashes the CURRENT saved routine has, recomputed on read. */
  clashes: ExamClash[];
}

/**
 * The exam routine read view and the postponement tool.
 *
 * Read side recomputes clashes rather than trusting what was legal at
 * save time: another exam may have booked a room since, or the exam
 * window may have been narrowed — the grid should show that in red
 * without needing a pointless re-save (the M13 routine convention).
 */
@Injectable()
export class ExamRoutineService {
  constructor(
    private readonly examSubjects: ExamSubjectsRepository,
    private readonly examsRepo: ExamsRepository,
    private readonly exams: ExamsService,
    private readonly clashes: ExamClashService,
    private readonly calendar: CalendarService,
    private readonly auditContext: AuditContextService,
  ) {}

  async getRoutine(examId: string, schoolId: string): Promise<ExamRoutine> {
    const exam = await this.exams.loadExam(examId, schoolId);
    const papers = await this.examSubjects.findForExam(examId);

    const scheduled = papers.filter((p) => p.examDate !== null);
    const byDate = new Map<string, RoutineSitting[]>();

    for (const paper of scheduled) {
      const date = isoDate(paper.examDate!);
      const startMinutes = paper.startTime
        ? timeColumnMinutes(paper.startTime)
        : 0;
      byDate.set(date, [
        ...(byDate.get(date) ?? []),
        {
          examSubjectId: paper.id,
          classId: paper.classId,
          className: paper.class.name,
          subjectId: paper.subjectId,
          subjectName: paper.subject.name,
          subjectCode: paper.subject.code,
          startTime: clock(startMinutes),
          endTime: clock(startMinutes + (paper.durationMin ?? 0)),
          durationMin: paper.durationMin ?? 0,
          room: paper.room,
          fullMarks: paper.fullMarks,
          passMarks: paper.passMarks,
        },
      ]);
    }

    const days: RoutineDay[] = [];
    for (const date of [...byDate.keys()].sort()) {
      const holiday = await this.calendar.isHoliday(schoolId, parseDate(date));
      days.push({
        date,
        holiday: holiday.holiday,
        ...(holiday.holiday && holiday.title
          ? { holidayTitle: holiday.title }
          : {}),
        sittings: (byDate.get(date) ?? []).sort(
          (a, b) =>
            a.startTime.localeCompare(b.startTime) ||
            a.className.localeCompare(b.className),
        ),
      });
    }

    return {
      exam: {
        id: exam.id,
        name: exam.name,
        status: exam.status,
        startDate: isoDate(exam.startDate),
        endDate: isoDate(exam.endDate),
        examTypeName: exam.examType.name,
        sessionName: exam.session.name,
      },
      days,
      unscheduled: papers
        .filter((p) => p.examDate === null)
        .map((p) => ({
          examSubjectId: p.id,
          classId: p.classId,
          className: p.class.name,
          subjectId: p.subjectId,
          subjectName: p.subject.name,
        })),
      clashes: await this.clashes.detect(
        exam,
        scheduled.map((p) => this.clashes.toSitting(p)).filter(isScheduled),
      ),
    };
  }

  /**
   * Move every sitting of one date to another (roadmap M14 §8). In
   * Bangladesh a strike or a cyclone postpones an exam day often enough
   * that doing it as 30 individual edits is a real source of mistakes —
   * so it is one audited operation that re-runs the clash engine on the
   * result.
   */
  async shiftDay(
    examId: string,
    dto: ShiftExamDayDto,
    actor: AccessTokenPayload,
  ): Promise<{ moved: number; routine: ExamRoutine }> {
    const schoolId = actor.schoolId;
    const exam = await this.exams.loadExam(examId, schoolId);

    if (exam.status === 'PUBLISHED' || exam.status === 'ARCHIVED') {
      throw new ConflictException(
        `${exam.name} is ${exam.status} — its routine is frozen`,
      );
    }
    if (dto.fromDate === dto.toDate) {
      throw new BadRequestException('The new date is the same as the old one');
    }

    const from = parseDate(dto.fromDate);
    const to = parseDate(dto.toDate);

    const moving = await this.examSubjects.findForExamDate(examId, from);
    if (moving.length === 0) {
      throw new BadRequestException(
        `No sittings are scheduled for ${dto.fromDate}`,
      );
    }

    // Extending the window is opt-in: silently stretching an exam past
    // its declared end date would surprise fees, attendance and reports.
    let endDate = exam.endDate;
    if (to.getTime() > exam.endDate.getTime()) {
      if (!dto.extendExamWindow) {
        throw new ConflictException(
          `${dto.toDate} is past the exam's end date (${isoDate(exam.endDate)}) — pass extendExamWindow=true to move it`,
        );
      }
      endDate = to;
    }
    if (to.getTime() < exam.startDate.getTime()) {
      throw new BadRequestException(
        `${dto.toDate} is before the exam starts (${isoDate(exam.startDate)})`,
      );
    }

    // Validate the POST-move routine, against the (possibly extended)
    // window rather than the old one.
    const all = await this.examSubjects.findForExam(examId);
    const movingIds = new Set(moving.map((m) => m.id));
    const projected = all
      .filter((p) => p.examDate !== null)
      .map((p) => {
        const sitting = this.clashes.toSitting(p);
        return movingIds.has(p.id) ? { ...sitting, date: dto.toDate } : sitting;
      })
      .filter(isScheduled);

    await this.clashes.assertScheduleAllowed(
      { ...exam, endDate },
      projected,
      dto.override ?? false,
      actor,
    );

    const moved = await this.examsRepo.withTransaction(async (tx) => {
      if (endDate !== exam.endDate) {
        await this.examsRepo.setStatus(
          examId,
          { endDate, updatedBy: actor.sub },
          tx,
        );
      }
      return this.examSubjects.shiftDate(examId, from, to, actor.sub, tx);
    });

    this.auditContext.set({
      entityType: 'Exam',
      entityId: examId,
      oldValues: { date: dto.fromDate, endDate: isoDate(exam.endDate) },
      newValues: {
        action: 'SHIFT_EXAM_DAY',
        date: dto.toDate,
        endDate: isoDate(endDate),
        sittings: moved,
        ...(dto.reason ? { reason: dto.reason } : {}),
      },
    });

    return { moved, routine: await this.getRoutine(examId, schoolId) };
  }

  /** Pre-flight probe for the routine editor's date/time picker. */
  async probe(
    examId: string,
    schoolId: string,
    candidate: {
      examSubjectId?: string;
      classId: string;
      subjectId: string;
      date: string;
      startTime: string;
      durationMin: number;
      room?: string;
    },
  ): Promise<ExamClash[]> {
    const exam = await this.exams.loadExam(examId, schoolId);
    const papers = await this.examSubjects.findForExam(examId);
    const paper = papers.find((p) => p.id === candidate.examSubjectId);

    const siblings = papers
      .filter((p) => p.id !== candidate.examSubjectId)
      .map((p) => this.clashes.toSitting(p))
      .filter(isScheduled);

    const startMinutes = timeMinutes(candidate.startTime);
    return this.clashes.detect(exam, [
      ...siblings,
      {
        examSubjectId: candidate.examSubjectId ?? null,
        examId,
        classId: candidate.classId,
        classLabel:
          paper?.class.name ??
          exam.examClasses.find((c) => c.classId === candidate.classId)?.class
            .name ??
          candidate.classId,
        subjectId: candidate.subjectId,
        subjectName: paper?.subject.name ?? candidate.subjectId,
        date: candidate.date,
        startMinutes,
        endMinutes: startMinutes + candidate.durationMin,
        room: candidate.room?.trim() || null,
      },
    ]);
  }
}

function timeMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
