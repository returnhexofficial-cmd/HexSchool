import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SeatPlanStrategy } from '../../../common/constants';
import { parseDate } from '../../academic/calendar/date.util';
import { ClassSubjectsRepository } from '../../academic/repositories/class-subjects.repository';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { EnrollmentsRepository } from '../../enrollment/repositories/enrollments.repository';
import {
  appendCandidate,
  Candidate,
  generateSeatPlan,
  RoomAllocation,
  totalCapacity,
} from '../calc/seat-plan.engine';
import { AppendCandidateDto, GenerateSeatPlanDto } from '../dto';
import { ExamSubjectsRepository } from '../repositories/exam-subjects.repository';
import {
  SeatPlansRepository,
  SeatPlanWithEntries,
} from '../repositories/seat-plans.repository';
import { ExamSettingsService } from './exam-settings.service';
import { ExamsService } from './exams.service';

export interface CandidateRow extends Candidate {
  studentId: string;
  studentUid: string;
  studentName: string;
  className: string;
  sectionName: string;
}

export interface SeatPlanGenerationResult {
  date: string;
  strategy: SeatPlanStrategy;
  rooms: number;
  seated: number;
  candidates: number;
  capacity: number;
  plans: SeatPlanWithEntries[];
}

/**
 * Seat plans (roadmap M14 §4).
 *
 * The interesting part is not the seating — that is the pure engine —
 * but **who counts as a candidate** (roadmap §6):
 *
 *   - only ACTIVE enrollments of the classes that actually sit a paper
 *     that day, and
 *   - for an OPTIONAL (4th) subject, only the students who chose it.
 *
 * Seating a whole class for an optional paper is the mistake this rule
 * exists to prevent: two-thirds of the hall would be empty and the
 * invigilator's register would be wrong.
 */
@Injectable()
export class SeatPlansService {
  constructor(
    private readonly seatPlans: SeatPlansRepository,
    private readonly examSubjects: ExamSubjectsRepository,
    private readonly enrollments: EnrollmentsRepository,
    private readonly classSubjects: ClassSubjectsRepository,
    private readonly exams: ExamsService,
    private readonly config: ExamSettingsService,
    private readonly auditContext: AuditContextService,
  ) {}

  // ── read ────────────────────────────────────────────────────────────

  async list(
    examId: string,
    schoolId: string,
    date?: string,
  ): Promise<SeatPlanWithEntries[]> {
    await this.exams.loadExam(examId, schoolId);
    return this.seatPlans.findForExam(
      examId,
      date ? parseDate(date) : undefined,
    );
  }

  /** Who would be seated for a date — the generator's dry run. */
  async candidates(
    examId: string,
    schoolId: string,
    date: string,
  ): Promise<CandidateRow[]> {
    const exam = await this.exams.loadExam(examId, schoolId);
    return this.resolveCandidates(exam.id, exam.sessionId, schoolId, date);
  }

  // ── write ───────────────────────────────────────────────────────────

  async generate(
    examId: string,
    dto: GenerateSeatPlanDto,
    actor: AccessTokenPayload,
  ): Promise<SeatPlanGenerationResult> {
    const schoolId = actor.schoolId;
    const exam = await this.exams.loadExam(examId, schoolId);
    if (exam.status === 'ARCHIVED') {
      throw new ConflictException(`${exam.name} is ARCHIVED`);
    }

    const date = parseDate(dto.date);
    const config = await this.config.load(schoolId);
    const strategy = dto.strategy ?? config.seatPlanDefaultStrategy;

    const papers = await this.examSubjects.findForExamDate(examId, date);
    if (papers.length === 0) {
      throw new BadRequestException(
        `No papers are scheduled for ${dto.date} — build the routine first`,
      );
    }

    const candidates = await this.resolveCandidates(
      examId,
      exam.sessionId,
      schoolId,
      dto.date,
    );
    if (candidates.length === 0) {
      throw new BadRequestException(
        `No active candidates sit any paper on ${dto.date}`,
      );
    }

    // Duplicate room names would collapse into one row on
    // `uq_seat_plans_room_date` and silently lose seats.
    const names = dto.rooms.map((r) => r.room.trim().toLowerCase());
    if (new Set(names).size !== names.length) {
      throw new BadRequestException('Room names must be unique within a date');
    }

    const capacity = totalCapacity(dto.rooms);
    if (capacity < candidates.length) {
      throw new ConflictException(
        `${candidates.length} candidate(s) but only ${capacity} seat(s) across ${dto.rooms.length} room(s) — add rooms or capacity`,
      );
    }

    const result = generateSeatPlan(
      candidates,
      dto.rooms.map((r) => ({ room: r.room.trim(), capacity: r.capacity })),
      strategy,
    );
    if (result.unseated.length > 0) {
      // Defensive: the capacity pre-check should already have caught this.
      throw new ConflictException(
        `${result.unseated.length} candidate(s) could not be seated`,
      );
    }

    const written = await this.seatPlans.replaceForDate(
      examId,
      schoolId,
      date,
      result.rooms.map((room) => ({ ...room, strategy })),
      actor.sub,
    );

    this.auditContext.set({
      entityType: 'Exam',
      entityId: examId,
      newValues: {
        action: 'GENERATE_SEAT_PLAN',
        date: dto.date,
        strategy,
        rooms: written.rooms,
        seats: written.seats,
        candidates: candidates.length,
      },
    });

    return {
      date: dto.date,
      strategy,
      rooms: written.rooms,
      seated: written.seats,
      candidates: candidates.length,
      capacity,
      plans: await this.seatPlans.findForExam(examId, date),
    };
  }

  /**
   * Seat one candidate the generator never saw (roadmap §8) rather than
   * regenerating the whole date — regeneration would move every other
   * student, invalidating admit cards already printed and handed out.
   */
  async appendCandidate(
    examId: string,
    dto: AppendCandidateDto,
    actor: AccessTokenPayload,
  ): Promise<{ room: string; seatNo: number }> {
    const schoolId = actor.schoolId;
    await this.exams.loadExam(examId, schoolId);
    const date = parseDate(dto.date);

    const plans = await this.seatPlans.findForExam(examId, date);
    if (plans.length === 0) {
      throw new BadRequestException(
        `No seat plan exists for ${dto.date} — generate one first`,
      );
    }

    const enrollment = await this.enrollments.findById(
      dto.enrollmentId,
      schoolId,
    );
    if (!enrollment) {
      throw new NotFoundException(`Enrollment ${dto.enrollmentId} not found`);
    }

    const seated = await this.seatPlans.findSeatedEnrollmentIds(examId, date);
    if (seated.has(dto.enrollmentId)) {
      throw new ConflictException(
        'This candidate already has a seat on that date',
      );
    }

    const allocation: RoomAllocation[] = plans.map((plan) => ({
      room: plan.room,
      capacity: plan.capacity,
      seats: plan.entries.map((e) => ({
        enrollmentId: e.enrollmentId,
        seatNo: e.seatNo,
      })),
    }));

    const placed = appendCandidate(allocation, dto.enrollmentId);
    if (!placed) {
      throw new ConflictException(
        'Every room is full — add a room and regenerate, or raise a room’s capacity',
      );
    }

    const plan = plans.find((p) => p.room === placed.room)!;
    await this.seatPlans.addEntry({
      schoolId,
      seatPlanId: plan.id,
      enrollmentId: dto.enrollmentId,
      seatNo: placed.seatNo,
    });

    this.auditContext.set({
      entityType: 'SeatPlan',
      entityId: plan.id,
      newValues: {
        action: 'APPEND_CANDIDATE',
        date: dto.date,
        enrollmentId: dto.enrollmentId,
        room: placed.room,
        seatNo: placed.seatNo,
      },
    });

    return placed;
  }

  async removeForDate(
    examId: string,
    date: string,
    actor: AccessTokenPayload,
  ): Promise<void> {
    await this.exams.loadExam(examId, actor.schoolId);
    const removed = await this.seatPlans.deleteForDate(examId, parseDate(date));
    if (removed === 0) {
      throw new NotFoundException(`No seat plan exists for ${date}`);
    }
    this.auditContext.set({
      entityType: 'Exam',
      entityId: examId,
      oldValues: { action: 'DELETE_SEAT_PLAN', date, rooms: removed },
    });
  }

  // ── candidate resolution (roadmap §6) ───────────────────────────────

  /**
   * ACTIVE enrollments of every class sitting a paper on `date`, minus
   * the students who did not take an optional paper being sat.
   */
  private async resolveCandidates(
    examId: string,
    sessionId: string,
    schoolId: string,
    date: string,
  ): Promise<CandidateRow[]> {
    const papers = await this.examSubjects.findForExamDate(
      examId,
      parseDate(date),
    );

    const rows = new Map<string, CandidateRow>();

    for (const paper of papers) {
      const optional = await this.isOptionalSubject(
        paper.classId,
        paper.subjectId,
        sessionId,
        schoolId,
      );

      const roster = await this.enrollments.findClassRoster(
        paper.classId,
        sessionId,
        schoolId,
      );

      for (const enrollment of roster) {
        // An optional paper is sat only by the students who chose it.
        if (optional && enrollment.optionalSubjectId !== paper.subjectId) {
          continue;
        }
        if (rows.has(enrollment.id)) continue;

        rows.set(enrollment.id, {
          enrollmentId: enrollment.id,
          classId: enrollment.classId,
          rollNo: enrollment.rollNo,
          studentId: enrollment.studentId,
          studentUid: enrollment.student.studentUid,
          studentName: `${enrollment.student.firstName} ${enrollment.student.lastName}`,
          className: enrollment.class.name,
          sectionName: enrollment.section.name,
        });
      }
    }

    return [...rows.values()].sort(
      (a, b) =>
        a.className.localeCompare(b.className) ||
        a.sectionName.localeCompare(b.sectionName) ||
        a.rollNo - b.rollNo,
    );
  }

  private async isOptionalSubject(
    classId: string,
    subjectId: string,
    sessionId: string,
    schoolId: string,
  ): Promise<boolean> {
    const curriculum = await this.classSubjects.findForClassSession(
      classId,
      sessionId,
      schoolId,
    );
    // A subject mapped as optional for ANY group of the class is optional
    // — the enrollment's own `optional_subject_id` is the authority on
    // who actually sits it.
    return curriculum.some(
      (row) => row.subjectId === subjectId && row.isOptional,
    );
  }
}
