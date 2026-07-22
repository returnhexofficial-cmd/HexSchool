import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ExamStatus, SessionStatus, UserType } from '../../../common/constants';
import { PaginatedResult } from '../../../common/dto/paginated.dto';
import { isoDate, parseDate } from '../../academic/calendar/date.util';
import { ClassesRepository } from '../../academic/repositories/classes.repository';
import { ClassSubjectsRepository } from '../../academic/repositories/class-subjects.repository';
import { SessionsService } from '../../academic/services/sessions.service';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { PermissionsService } from '../../rbac/services/permissions.service';
import { GradingSystemsRepository } from '../../school/repositories/grading-systems.repository';
import {
  isShapeEditable,
  transitionRefusal,
} from '../calc/exam-status.machine';
import { defaultDistribution } from '../calc/mark-distribution';
import {
  ChangeExamStatusDto,
  CreateExamDto,
  ExamListQueryDto,
  SetExamClassesDto,
  UpdateExamDto,
} from '../dto';
import { ExamSubjectsRepository } from '../repositories/exam-subjects.repository';
import { ExamsRepository } from '../repositories/exams.repository';
import type { ExamWithRelations } from '../repositories/exams.repository';
import { SeatPlansRepository } from '../repositories/seat-plans.repository';
import { ExamSettingsService } from './exam-settings.service';
import { EXAM_RESULT_GATE } from './exam.gates';
import type { ExamResultGate } from './exam.gates';

export interface ExamOverview {
  exam: ExamWithRelations;
  papers: { total: number; scheduled: number; unscheduled: number };
  seatPlans: number;
  /** Statuses this exam may legally move to next. */
  nextStatuses: ExamStatus[];
  shapeEditable: boolean;
}

/**
 * The exam aggregate (roadmap M14 §4): create → attach classes → papers
 * seeded from the curriculum → schedule → walk the status machine.
 *
 * Two invariants are worth calling out because they shape everything
 * else:
 *
 *   - **the exam window lives inside the session.** Dates outside it
 *     cannot be reconciled with attendance, enrollment or the routine,
 *     so they are refused rather than warned about.
 *   - **the grading system is frozen at PUBLISH** (roadmap §6). The live
 *     `grading_system_id` is what the exam is being built against; the
 *     `grading_snapshot` written at publication is what Module 15 reads
 *     forever after, so editing a grade band later can never silently
 *     restate a result that has already gone home with a student.
 */
@Injectable()
export class ExamsService {
  constructor(
    private readonly exams: ExamsRepository,
    private readonly examSubjects: ExamSubjectsRepository,
    private readonly seatPlans: SeatPlansRepository,
    private readonly classes: ClassesRepository,
    private readonly classSubjects: ClassSubjectsRepository,
    private readonly gradingSystems: GradingSystemsRepository,
    private readonly sessions: SessionsService,
    private readonly config: ExamSettingsService,
    private readonly permissions: PermissionsService,
    private readonly auditContext: AuditContextService,
    @Inject(EXAM_RESULT_GATE) private readonly resultGate: ExamResultGate,
  ) {}

  // ── read ────────────────────────────────────────────────────────────

  async list(
    query: ExamListQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<ExamWithRelations>> {
    const sessionId =
      query.sessionId ?? (await this.currentSessionId(schoolId));
    return this.exams.paginateList({ ...query, sessionId }, schoolId);
  }

  async getDetail(id: string, schoolId: string): Promise<ExamOverview> {
    const exam = await this.loadExam(id, schoolId);
    const [total, unscheduled, seatPlans] = await Promise.all([
      this.examSubjects.countForExam(id),
      this.examSubjects.countUnscheduled(id),
      this.seatPlans.countForExam(id),
    ]);

    return {
      exam,
      papers: { total, scheduled: total - unscheduled, unscheduled },
      seatPlans,
      nextStatuses: this.nextStatuses(exam.status),
      shapeEditable: isShapeEditable(exam.status),
    };
  }

  /** Loaded-or-404 helper the sibling services share. */
  async loadExam(id: string, schoolId: string): Promise<ExamWithRelations> {
    const exam = await this.exams.findDetail(id, schoolId);
    if (!exam) throw new NotFoundException(`Exam ${id} not found`);
    return exam;
  }

  // ── write ───────────────────────────────────────────────────────────

  async create(
    dto: CreateExamDto,
    actor: AccessTokenPayload,
  ): Promise<ExamWithRelations> {
    const schoolId = actor.schoolId;
    const sessionId = dto.sessionId ?? (await this.currentSessionId(schoolId));
    const session = await this.sessions.getById(sessionId, schoolId);
    this.assertSessionWritable(session);

    const { startDate, endDate } = this.parseWindow(
      dto.startDate,
      dto.endDate,
      session,
    );

    const type = await this.exams.findByName(schoolId, sessionId, dto.name);
    if (type) {
      throw new ConflictException(
        `An exam named "${dto.name.trim()}" already exists in ${session.name}`,
      );
    }

    const gradingSystemId = await this.resolveGradingSystem(
      dto.gradingSystemId,
      schoolId,
    );
    const classIds = await this.validateClassIds(dto.classIds ?? [], schoolId);

    const created = await this.exams.withTransaction(async (tx) => {
      const exam = await this.exams.create(
        {
          schoolId,
          sessionId,
          examTypeId: dto.examTypeId,
          name: dto.name.trim(),
          startDate,
          endDate,
          gradingSystemId,
          status: ExamStatus.DRAFT,
          instructions: dto.instructions ?? null,
          createdBy: actor.sub,
          updatedBy: actor.sub,
        },
        tx,
      );
      if (classIds.length > 0) {
        await this.exams.setClasses(exam.id, classIds, tx);
        await this.seedPapers(
          exam.id,
          schoolId,
          sessionId,
          classIds,
          actor,
          tx,
        );
      }
      return exam;
    });

    this.auditContext.set({
      entityType: 'Exam',
      entityId: created.id,
      newValues: {
        name: created.name,
        sessionId,
        examTypeId: dto.examTypeId,
        startDate: dto.startDate,
        endDate: dto.endDate,
        gradingSystemId,
        classIds,
      },
    });

    return this.loadExam(created.id, schoolId);
  }

  async update(
    id: string,
    dto: UpdateExamDto,
    actor: AccessTokenPayload,
  ): Promise<ExamWithRelations> {
    const schoolId = actor.schoolId;
    const exam = await this.loadExam(id, schoolId);
    this.assertShapeEditable(exam);
    const session = await this.sessions.getById(exam.sessionId, schoolId);
    this.assertSessionWritable(session);

    const startIso = dto.startDate ?? isoDate(exam.startDate);
    const endIso = dto.endDate ?? isoDate(exam.endDate);
    const { startDate, endDate } = this.parseWindow(startIso, endIso, session);

    if (dto.name && dto.name.trim().toLowerCase() !== exam.name.toLowerCase()) {
      const clash = await this.exams.findByName(
        schoolId,
        exam.sessionId,
        dto.name,
        id,
      );
      if (clash) {
        throw new ConflictException(
          `An exam named "${dto.name.trim()}" already exists in ${session.name}`,
        );
      }
    }

    // Narrowing the window must not orphan sittings outside the new one.
    if (dto.startDate || dto.endDate) {
      await this.assertSittingsInsideWindow(id, startIso, endIso);
    }

    const gradingSystemId = dto.gradingSystemId
      ? await this.resolveGradingSystem(dto.gradingSystemId, schoolId)
      : undefined;

    await this.exams.update(id, {
      ...(dto.examTypeId ? { examTypeId: dto.examTypeId } : {}),
      ...(dto.name ? { name: dto.name.trim() } : {}),
      startDate,
      endDate,
      ...(gradingSystemId ? { gradingSystemId } : {}),
      ...(dto.instructions !== undefined
        ? { instructions: dto.instructions }
        : {}),
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'Exam',
      entityId: id,
      oldValues: {
        name: exam.name,
        startDate: isoDate(exam.startDate),
        endDate: isoDate(exam.endDate),
        gradingSystemId: exam.gradingSystemId,
      },
      newValues: {
        name: dto.name?.trim() ?? exam.name,
        startDate: startIso,
        endDate: endIso,
        gradingSystemId: gradingSystemId ?? exam.gradingSystemId,
      },
    });

    return this.loadExam(id, schoolId);
  }

  /**
   * Replace the attached class set. Newly attached classes get papers
   * seeded from their curriculum; detached classes lose theirs (blocked
   * once marks exist — Module 15 arms that guard).
   */
  async setClasses(
    id: string,
    dto: SetExamClassesDto,
    actor: AccessTokenPayload,
  ): Promise<ExamWithRelations> {
    const schoolId = actor.schoolId;
    const exam = await this.loadExam(id, schoolId);
    this.assertShapeEditable(exam);

    const classIds = await this.validateClassIds(dto.classIds, schoolId);
    const previous = await this.exams.findClassIds(id);
    const added = classIds.filter((c) => !previous.includes(c));
    const removed = previous.filter((c) => !classIds.includes(c));

    await this.exams.withTransaction(async (tx) => {
      await this.exams.setClasses(id, classIds, tx);
      if (removed.length > 0) {
        await this.examSubjects.deleteForClasses(id, removed, tx);
      }
      if (added.length > 0 && (dto.seedSubjects ?? true)) {
        await this.seedPapers(id, schoolId, exam.sessionId, added, actor, tx);
      }
    });

    this.auditContext.set({
      entityType: 'Exam',
      entityId: id,
      oldValues: { classIds: previous },
      newValues: { classIds, added, removed },
    });

    return this.loadExam(id, schoolId);
  }

  /**
   * Walk the status machine. Three guards sit on top of the pure
   * transition table, each owned by a different concern:
   *   - SCHEDULED needs a complete routine (this module);
   *   - MARK_ENTRY needs the exam to be over, unless overridden;
   *   - PUBLISHED needs Module 15 to say the results are processed.
   */
  async changeStatus(
    id: string,
    dto: ChangeExamStatusDto,
    actor: AccessTokenPayload,
  ): Promise<ExamWithRelations> {
    const schoolId = actor.schoolId;
    const exam = await this.loadExam(id, schoolId);

    const refusal = transitionRefusal(exam.status, dto.status);
    if (refusal) throw new BadRequestException(refusal);

    if (dto.status === ExamStatus.SCHEDULED) {
      await this.assertSchedulable(exam);
    }
    if (dto.status === ExamStatus.MARK_ENTRY) {
      await this.assertExamOver(exam, dto.override ?? false, actor);
    }

    let gradingSnapshot: unknown;
    if (dto.status === ExamStatus.PUBLISHED) {
      const readiness = await this.resultGate.canPublish(id, schoolId);
      if (!readiness.ready) {
        throw new ConflictException({
          message:
            readiness.reason ??
            'Results are not processed yet — cannot publish',
          details: readiness.detail ?? {},
        });
      }
      gradingSnapshot = await this.snapshotGradingSystem(exam, schoolId);
    }

    await this.exams.setStatus(id, {
      status: dto.status,
      ...(dto.status === ExamStatus.PUBLISHED
        ? {
            resultPublishAt: new Date(),
            gradingSnapshot: gradingSnapshot as never,
          }
        : {}),
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'Exam',
      entityId: id,
      oldValues: { status: exam.status },
      newValues: {
        status: dto.status,
        ...(dto.reason ? { reason: dto.reason } : {}),
        ...(dto.override ? { override: true } : {}),
        ...(gradingSnapshot ? { gradingFrozen: true } : {}),
      },
    });

    return this.loadExam(id, schoolId);
  }

  /** Soft-delete a draft. Anything further along is the school's record. */
  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const exam = await this.loadExam(id, actor.schoolId);
    if (exam.status !== ExamStatus.DRAFT) {
      throw new ConflictException(
        `Only DRAFT exams can be deleted — ${exam.name} is ${exam.status}; archive it instead`,
      );
    }

    await this.exams.softDelete(id);
    this.auditContext.set({
      entityType: 'Exam',
      entityId: id,
      oldValues: { name: exam.name, status: exam.status },
    });
  }

  // ── internals ───────────────────────────────────────────────────────

  private nextStatuses(status: ExamStatus): ExamStatus[] {
    return Object.values(ExamStatus).filter(
      (target) => transitionRefusal(status, target) === null,
    );
  }

  /**
   * Seed one paper per curriculum subject of each class. Optional (4th)
   * subjects are included — students who did not choose one simply never
   * become candidates for that paper (roadmap §6).
   */
  private async seedPapers(
    examId: string,
    schoolId: string,
    sessionId: string,
    classIds: string[],
    actor: AccessTokenPayload,
    tx?: Parameters<typeof this.examSubjects.createMany>[1],
  ): Promise<number> {
    const config = await this.config.load(schoolId);
    const rows = [];

    for (const classId of classIds) {
      const curriculum = await this.classSubjects.findForClassSession(
        classId,
        sessionId,
        schoolId,
      );
      // One paper per subject even when it is mapped for several groups —
      // Science and Commerce sit the same Bangla paper.
      const seen = new Set<string>();
      for (const row of curriculum) {
        if (seen.has(row.subjectId)) continue;
        seen.add(row.subjectId);

        const fullMarks = row.fullMarksDefault ?? config.defaultFullMarks;
        const passMarks = Math.min(config.defaultPassMark, fullMarks);
        const distribution = defaultDistribution(
          fullMarks,
          passMarks,
          row.subject.type !== 'THEORY',
        );

        rows.push({
          schoolId,
          examId,
          classId,
          subjectId: row.subjectId,
          fullMarks: distribution.fullMarks,
          passMarks: distribution.passMarks,
          cqMarks: distribution.cqMarks ?? null,
          mcqMarks: distribution.mcqMarks ?? null,
          practicalMarks: distribution.practicalMarks ?? null,
          caMarks: distribution.caMarks ?? null,
          createdBy: actor.sub,
          updatedBy: actor.sub,
        });
      }
    }

    return this.examSubjects.createMany(rows, tx);
  }

  private async validateClassIds(
    classIds: string[],
    schoolId: string,
  ): Promise<string[]> {
    const unique = [...new Set(classIds)];
    for (const classId of unique) {
      const found = await this.classes.findById(classId, schoolId);
      if (!found) {
        throw new BadRequestException(`Class ${classId} not found`);
      }
    }
    return unique;
  }

  private async resolveGradingSystem(
    gradingSystemId: string | undefined,
    schoolId: string,
  ): Promise<string> {
    if (gradingSystemId) {
      const system = await this.gradingSystems.findById(
        gradingSystemId,
        schoolId,
      );
      if (!system) {
        throw new BadRequestException(
          `Grading system ${gradingSystemId} not found`,
        );
      }
      return system.id;
    }

    const all = await this.gradingSystems.findAllWithPoints(schoolId);
    const fallback = all.find((s) => s.isDefault);
    if (!fallback) {
      throw new BadRequestException(
        'No default grading system configured — set one in Settings → Grading first',
      );
    }
    return fallback.id;
  }

  /**
   * Copy the grade bands onto the exam. Everything Module 15 needs to
   * grade a mark lives in this blob, so a later edit to the live grading
   * system cannot restate a published result (roadmap §6).
   */
  private async snapshotGradingSystem(
    exam: ExamWithRelations,
    schoolId: string,
  ): Promise<Record<string, unknown>> {
    const system = await this.gradingSystems.findByIdWithPoints(
      exam.gradingSystemId,
      schoolId,
    );
    if (!system) {
      throw new ConflictException(
        'The exam’s grading system no longer exists — cannot freeze a grade scale to publish against',
      );
    }
    return {
      gradingSystemId: system.id,
      name: system.name,
      frozenAt: new Date().toISOString(),
      gradePoints: system.gradePoints.map((p) => ({
        grade: p.grade,
        point: p.point.toString(),
        minMark: p.minMark,
        maxMark: p.maxMark,
      })),
    };
  }

  private parseWindow(
    startIso: string,
    endIso: string,
    session: { name: string; startDate: Date; endDate: Date },
  ): { startDate: Date; endDate: Date } {
    const startDate = parseDate(startIso);
    const endDate = parseDate(endIso);

    if (startDate.getTime() > endDate.getTime()) {
      throw new BadRequestException(
        'Exam end date must be on or after its start date',
      );
    }
    if (
      startDate.getTime() < session.startDate.getTime() ||
      endDate.getTime() > session.endDate.getTime()
    ) {
      throw new BadRequestException(
        `Exam dates must fall inside session ${session.name} (${isoDate(session.startDate)} → ${isoDate(session.endDate)})`,
      );
    }
    return { startDate, endDate };
  }

  private async assertSittingsInsideWindow(
    examId: string,
    startIso: string,
    endIso: string,
  ): Promise<void> {
    const dates = await this.examSubjects.findExamDates(examId);
    const stranded = dates
      .map(isoDate)
      .filter((d) => d < startIso || d > endIso);
    if (stranded.length > 0) {
      throw new ConflictException(
        `${stranded.length} sitting date(s) would fall outside the new window (${stranded.join(', ')}) — reschedule them first`,
      );
    }
  }

  /** An exam goes SCHEDULED only when its routine is actually complete. */
  private async assertSchedulable(exam: ExamWithRelations): Promise<void> {
    if (exam.examClasses.length === 0) {
      throw new BadRequestException(
        'Attach at least one class before scheduling this exam',
      );
    }
    const total = await this.examSubjects.countForExam(exam.id);
    if (total === 0) {
      throw new BadRequestException(
        'This exam has no papers — add subjects before scheduling',
      );
    }
    const unscheduled = await this.examSubjects.countUnscheduled(exam.id);
    if (unscheduled > 0) {
      throw new BadRequestException(
        `${unscheduled} paper(s) still have no date/time — complete the routine before scheduling`,
      );
    }
  }

  /**
   * Mark entry opens after the last paper is sat. Opening it early is a
   * legitimate need (a class finishes ahead of the others), so it is an
   * override rather than a refusal — but it needs `exam.status` and is
   * audited.
   */
  private async assertExamOver(
    exam: ExamWithRelations,
    override: boolean,
    actor: AccessTokenPayload,
  ): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    if (today > isoDate(exam.endDate)) return;

    if (!override) {
      throw new ConflictException(
        `${exam.name} runs until ${isoDate(exam.endDate)} — pass override=true to open mark entry early`,
      );
    }
    if (actor.userType === UserType.SUPER_ADMIN) return;
    const codes = await this.permissions.getUserPermissionCodes(actor.sub);
    if (!codes.includes('exam.status')) {
      throw new ForbiddenException(
        'Opening mark entry before the exam ends requires exam.status',
      );
    }
  }

  private assertShapeEditable(exam: ExamWithRelations): void {
    if (!isShapeEditable(exam.status)) {
      throw new ConflictException(
        `${exam.name} is ${exam.status} — its classes and papers are frozen`,
      );
    }
  }

  /** The M05 read-only rule, as enforced by M12 attendance and M13 routines. */
  private assertSessionWritable(session: {
    name: string;
    status: SessionStatus;
  }): void {
    if (
      session.status === SessionStatus.COMPLETED ||
      session.status === SessionStatus.ARCHIVED
    ) {
      throw new BadRequestException(
        `Session ${session.name} is ${session.status} — exams are read-only`,
      );
    }
  }

  private async currentSessionId(schoolId: string): Promise<string> {
    const current = await this.sessions.getCurrent(schoolId);
    if (!current) {
      throw new BadRequestException(
        'No current academic session — pass sessionId explicitly',
      );
    }
    return current.id;
  }
}
