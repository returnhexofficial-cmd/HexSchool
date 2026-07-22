import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isoDate, parseDate } from '../../academic/calendar/date.util';
import { ClassSubjectsRepository } from '../../academic/repositories/class-subjects.repository';
import { SubjectsRepository } from '../../academic/repositories/subjects.repository';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { minutesOfDay } from '../../../common/utils/clock.util';
import type { ExamClash, Sitting } from '../calc/exam-clash.engine';
import {
  defaultDistribution,
  MarkDistribution,
  validateDistribution,
} from '../calc/mark-distribution';
import {
  ExamSubjectInputDto,
  ReplaceExamSubjectsDto,
  SyncExamSubjectsDto,
  UpdateExamSubjectDto,
} from '../dto';
import {
  ExamSubjectsRepository,
  ExamSubjectWithRelations,
} from '../repositories/exam-subjects.repository';
import {
  ExamsRepository,
  type ExamWithRelations,
} from '../repositories/exams.repository';
import { ExamClashService, isScheduled } from './exam-clash.service';
import { ExamSettingsService } from './exam-settings.service';
import { ExamsService } from './exams.service';

export interface ReplaceSubjectsResult {
  saved: number;
  removed: number;
  /** Same-day warnings the caller chose to override. */
  warnings: ExamClash[];
}

export interface SubjectSyncDiff {
  /** On the class curriculum but not yet a paper (roadmap M14 §8). */
  missing: Array<{
    classId: string;
    className: string;
    subjectId: string;
    subjectName: string;
  }>;
  /** A paper whose subject has left the class curriculum. */
  stale: Array<{
    examSubjectId: string;
    classId: string;
    className: string;
    subjectId: string;
    subjectName: string;
    scheduled: boolean;
  }>;
}

/**
 * Exam papers: the mark distribution grid and the sitting schedule that
 * live on the same row.
 *
 * Validation is deliberately whole-payload — every row is checked before
 * anything is written, so a rejected save leaves the previous grid
 * exactly as it was and the UI can red-flag all bad rows at once instead
 * of walking the user through them one 400 at a time.
 */
@Injectable()
export class ExamSubjectsService {
  constructor(
    private readonly examSubjects: ExamSubjectsRepository,
    private readonly examsRepo: ExamsRepository,
    private readonly classSubjects: ClassSubjectsRepository,
    private readonly subjects: SubjectsRepository,
    private readonly exams: ExamsService,
    private readonly clashes: ExamClashService,
    private readonly config: ExamSettingsService,
    private readonly auditContext: AuditContextService,
  ) {}

  // ── read ────────────────────────────────────────────────────────────

  async list(
    examId: string,
    schoolId: string,
  ): Promise<ExamSubjectWithRelations[]> {
    await this.exams.loadExam(examId, schoolId);
    return this.examSubjects.findForExam(examId);
  }

  // ── write ───────────────────────────────────────────────────────────

  /**
   * Replace an exam's papers wholesale — the wizard's distribution step.
   * Papers absent from the payload are deleted.
   */
  async replace(
    examId: string,
    dto: ReplaceExamSubjectsDto,
    actor: AccessTokenPayload,
  ): Promise<ReplaceSubjectsResult> {
    const schoolId = actor.schoolId;
    const exam = await this.exams.loadExam(examId, schoolId);
    this.assertEditable(exam);

    const attached = new Set(exam.examClasses.map((c) => c.classId));
    const existing = await this.examSubjects.findForExam(examId);
    const byKey = new Map(
      existing.map((row) => [`${row.classId}|${row.subjectId}`, row]),
    );

    // Subject names for the clash messages — a brand-new paper has no
    // saved row to read a name from.
    const subjectNames = await this.subjectNameMap(
      dto.subjects.map((s) => s.subjectId),
      schoolId,
    );

    // ── validate the whole payload first ──
    const errors: string[] = [];
    const seen = new Set<string>();
    const candidates: Sitting[] = [];

    for (const [index, input] of dto.subjects.entries()) {
      const key = `${input.classId}|${input.subjectId}`;
      const label = `row ${index + 1}`;

      if (!attached.has(input.classId)) {
        errors.push(`${label}: class is not attached to this exam`);
        continue;
      }
      if (seen.has(key)) {
        errors.push(`${label}: duplicate class+subject`);
        continue;
      }
      seen.add(key);

      for (const error of validateDistribution(input)) {
        errors.push(`${label} (${error.field}): ${error.message}`);
      }

      const schedule = this.parseSchedule(input, label, errors);
      if (schedule) {
        candidates.push({
          examSubjectId: byKey.get(key)?.id ?? null,
          examId,
          classId: input.classId,
          classLabel:
            exam.examClasses.find((c) => c.classId === input.classId)?.class
              .name ?? input.classId,
          subjectId: input.subjectId,
          subjectName: subjectNames.get(input.subjectId) ?? input.subjectId,
          date: schedule.date,
          startMinutes: schedule.startMinutes,
          endMinutes: schedule.startMinutes + schedule.durationMin,
          room: input.room?.trim() || null,
        });
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: `${errors.length} invalid paper(s) — nothing was saved`,
        details: { errors },
      });
    }

    const warnings = await this.clashes.assertScheduleAllowed(
      exam,
      candidates.filter(isScheduled),
      dto.override ?? false,
      actor,
    );

    // ── write ──
    const keep = new Set(
      dto.subjects.map((s) => `${s.classId}|${s.subjectId}`),
    );
    const removeIds = existing
      .filter((row) => !keep.has(`${row.classId}|${row.subjectId}`))
      .map((row) => row.id);

    const result = await this.write(
      examId,
      schoolId,
      dto.subjects,
      byKey,
      removeIds,
      actor,
    );

    this.auditContext.set({
      entityType: 'Exam',
      entityId: examId,
      oldValues: { papers: existing.length },
      newValues: {
        action: 'REPLACE_SUBJECTS',
        papers: dto.subjects.length,
        removed: removeIds.length,
        ...(warnings.length > 0
          ? { override: true, warnings: warnings.length }
          : {}),
      },
    });

    return { ...result, warnings };
  }

  /** Single-paper edit from the routine grid or the subjects table. */
  async update(
    examId: string,
    subjectId: string,
    dto: UpdateExamSubjectDto,
    actor: AccessTokenPayload,
  ): Promise<ExamSubjectWithRelations> {
    const schoolId = actor.schoolId;
    const exam = await this.exams.loadExam(examId, schoolId);
    this.assertEditable(exam);

    const paper = await this.examSubjects.findById(subjectId, schoolId);
    if (!paper || paper.examId !== examId) {
      throw new NotFoundException(`Exam paper ${subjectId} not found`);
    }

    const errors = validateDistribution(dto as MarkDistribution).map(
      (e) => `${e.field}: ${e.message}`,
    );
    const scheduleErrors: string[] = [];
    const schedule = this.parseSchedule(dto, 'schedule', scheduleErrors);
    errors.push(...scheduleErrors);
    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Invalid paper',
        details: { errors },
      });
    }

    // Every OTHER paper of this exam is competition for the edited one.
    const siblings = (await this.examSubjects.findForExam(examId))
      .filter((row) => row.id !== subjectId)
      .map((row) => this.clashes.toSitting(row))
      .filter(isScheduled);

    const candidate: Sitting | null = schedule
      ? {
          examSubjectId: paper.id,
          examId,
          classId: paper.classId,
          classLabel: paper.class.name,
          subjectId: paper.subjectId,
          subjectName: paper.subject.name,
          date: schedule.date,
          startMinutes: schedule.startMinutes,
          endMinutes: schedule.startMinutes + schedule.durationMin,
          room: dto.room?.trim() || null,
        }
      : null;

    if (candidate) {
      await this.clashes.assertScheduleAllowed(
        exam,
        [candidate, ...siblings],
        dto.override ?? false,
        actor,
      );
    }

    const updated = await this.examSubjects.update(subjectId, {
      ...this.distributionColumns(dto),
      examDate: schedule ? parseDate(schedule.date) : null,
      startTime: schedule ? timeValue(schedule.startTime) : null,
      durationMin: schedule ? schedule.durationMin : null,
      room: dto.room?.trim() || null,
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'ExamSubject',
      entityId: subjectId,
      oldValues: {
        fullMarks: paper.fullMarks,
        passMarks: paper.passMarks,
        examDate: paper.examDate ? isoDate(paper.examDate) : null,
        room: paper.room,
      },
      newValues: {
        fullMarks: dto.fullMarks,
        passMarks: dto.passMarks,
        examDate: schedule?.date ?? null,
        room: dto.room?.trim() || null,
      },
    });

    return updated;
  }

  async remove(
    examId: string,
    subjectId: string,
    actor: AccessTokenPayload,
  ): Promise<void> {
    const exam = await this.exams.loadExam(examId, actor.schoolId);
    this.assertEditable(exam);

    const paper = await this.examSubjects.findById(subjectId, actor.schoolId);
    if (!paper || paper.examId !== examId) {
      throw new NotFoundException(`Exam paper ${subjectId} not found`);
    }

    await this.examSubjects.deleteMany([subjectId]);
    this.auditContext.set({
      entityType: 'ExamSubject',
      entityId: subjectId,
      oldValues: {
        examId,
        classId: paper.classId,
        subjectId: paper.subjectId,
        fullMarks: paper.fullMarks,
      },
    });
  }

  // ── curriculum sync (roadmap M14 §8) ────────────────────────────────

  /**
   * What changed on the attached classes' curricula since the exam was
   * built: subjects added to a class have no paper, subjects removed
   * still have one.
   */
  async syncPreview(
    examId: string,
    schoolId: string,
  ): Promise<SubjectSyncDiff> {
    const exam = await this.exams.loadExam(examId, schoolId);
    const papers = await this.examSubjects.findForExam(examId);
    const papersByClass = new Map<string, ExamSubjectWithRelations[]>();
    for (const paper of papers) {
      papersByClass.set(paper.classId, [
        ...(papersByClass.get(paper.classId) ?? []),
        paper,
      ]);
    }

    const diff: SubjectSyncDiff = { missing: [], stale: [] };

    for (const attached of exam.examClasses) {
      const curriculum = await this.classSubjects.findForClassSession(
        attached.classId,
        exam.sessionId,
        schoolId,
      );
      const curriculumIds = new Set(curriculum.map((r) => r.subjectId));
      const existing = papersByClass.get(attached.classId) ?? [];
      const existingIds = new Set(existing.map((p) => p.subjectId));

      for (const row of curriculum) {
        if (existingIds.has(row.subjectId)) continue;
        if (
          diff.missing.some(
            (m) =>
              m.classId === attached.classId && m.subjectId === row.subjectId,
          )
        ) {
          continue;
        }
        diff.missing.push({
          classId: attached.classId,
          className: attached.class.name,
          subjectId: row.subjectId,
          subjectName: row.subject.name,
        });
      }

      for (const paper of existing) {
        if (curriculumIds.has(paper.subjectId)) continue;
        diff.stale.push({
          examSubjectId: paper.id,
          classId: attached.classId,
          className: attached.class.name,
          subjectId: paper.subjectId,
          subjectName: paper.subject.name,
          scheduled: paper.examDate !== null,
        });
      }
    }

    return diff;
  }

  /** Apply the diff. Both directions are opt-in — removal loses a paper. */
  async syncApply(
    examId: string,
    dto: SyncExamSubjectsDto,
    actor: AccessTokenPayload,
  ): Promise<{ added: number; removed: number; diff: SubjectSyncDiff }> {
    const schoolId = actor.schoolId;
    const exam = await this.exams.loadExam(examId, schoolId);
    this.assertEditable(exam);

    const diff = await this.syncPreview(examId, schoolId);
    const config = await this.config.load(schoolId);

    let added = 0;
    if (dto.addMissing ?? true) {
      const rows: Prisma.ExamSubjectUncheckedCreateInput[] = [];
      for (const item of diff.missing) {
        const curriculum = await this.classSubjects.findForClassSession(
          item.classId,
          exam.sessionId,
          schoolId,
        );
        const mapping = curriculum.find((r) => r.subjectId === item.subjectId);
        const fullMarks = mapping?.fullMarksDefault ?? config.defaultFullMarks;
        const distribution = defaultDistribution(
          fullMarks,
          Math.min(config.defaultPassMark, fullMarks),
          mapping?.subject.type !== 'THEORY',
        );
        rows.push({
          schoolId,
          examId,
          classId: item.classId,
          subjectId: item.subjectId,
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
      added = await this.examSubjects.createMany(rows);
    }

    let removed = 0;
    if (dto.removeStale ?? false) {
      removed = await this.examSubjects.deleteMany(
        diff.stale.map((s) => s.examSubjectId),
      );
    }

    this.auditContext.set({
      entityType: 'Exam',
      entityId: examId,
      newValues: { action: 'SYNC_SUBJECTS', added, removed },
    });

    return { added, removed, diff };
  }

  // ── internals ───────────────────────────────────────────────────────

  /**
   * Apply the validated payload in one transaction: papers that survive
   * are updated in place (keeping their id, so a scheduled sitting is not
   * re-created and any Module 15 marks stay attached), papers absent from
   * the payload are dropped, new class+subject pairs are inserted.
   */
  private async write(
    examId: string,
    schoolId: string,
    inputs: ExamSubjectInputDto[],
    existing: Map<string, ExamSubjectWithRelations>,
    removeIds: string[],
    actor: AccessTokenPayload,
  ): Promise<{ saved: number; removed: number }> {
    return this.examsRepo.withTransaction(async (tx) => {
      const removed = await this.examSubjects.deleteMany(removeIds, tx);
      let saved = 0;

      for (const input of inputs) {
        const current = existing.get(`${input.classId}|${input.subjectId}`);
        const schedule = this.parseSchedule(input, 'row', []);
        const columns = {
          ...this.distributionColumns(input),
          examDate: schedule ? parseDate(schedule.date) : null,
          startTime: schedule ? timeValue(schedule.startTime) : null,
          durationMin: schedule ? schedule.durationMin : null,
          room: input.room?.trim() || null,
        };

        if (current) {
          await this.examSubjects.update(
            current.id,
            { ...columns, updatedBy: actor.sub },
            tx,
          );
        } else {
          await this.examSubjects.create(
            {
              schoolId,
              examId,
              classId: input.classId,
              subjectId: input.subjectId,
              ...columns,
              createdBy: actor.sub,
              updatedBy: actor.sub,
            },
            tx,
          );
        }
        saved += 1;
      }

      return { saved, removed };
    });
  }

  private async subjectNameMap(
    subjectIds: string[],
    schoolId: string,
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (const id of new Set(subjectIds)) {
      const subject = await this.subjects.findById(id, schoolId);
      if (subject) map.set(id, subject.name);
    }
    return map;
  }

  private distributionColumns(d: MarkDistribution) {
    return {
      fullMarks: d.fullMarks,
      passMarks: d.passMarks,
      cqMarks: d.cqMarks ?? null,
      mcqMarks: d.mcqMarks ?? null,
      practicalMarks: d.practicalMarks ?? null,
      caMarks: d.caMarks ?? null,
      cqPassMarks: d.cqPassMarks ?? null,
      mcqPassMarks: d.mcqPassMarks ?? null,
      practicalPassMarks: d.practicalPassMarks ?? null,
      caPassMarks: d.caPassMarks ?? null,
    };
  }

  /**
   * A sitting is all-or-nothing: date + time + duration together, or the
   * paper stays unscheduled (mirrors `chk_exam_subjects_schedule`).
   */
  private parseSchedule(
    input: {
      examDate?: string | null;
      startTime?: string | null;
      durationMin?: number | null;
    },
    label: string,
    errors: string[],
  ): {
    date: string;
    startTime: string;
    startMinutes: number;
    durationMin: number;
  } | null {
    const parts = [input.examDate, input.startTime, input.durationMin];
    const given = parts.filter((p) => p !== null && p !== undefined).length;
    if (given === 0) return null;
    if (given < 3) {
      errors.push(
        `${label}: a sitting needs a date, a start time and a duration together (or none at all)`,
      );
      return null;
    }

    try {
      parseDate(input.examDate!);
    } catch {
      errors.push(`${label}: "${input.examDate}" is not a valid calendar date`);
      return null;
    }

    return {
      date: input.examDate!,
      startTime: input.startTime!,
      startMinutes: minutesOfDay(input.startTime!),
      durationMin: input.durationMin!,
    };
  }

  private assertEditable(exam: ExamWithRelations): void {
    if (exam.status === 'PUBLISHED' || exam.status === 'ARCHIVED') {
      throw new ConflictException(
        `${exam.name} is ${exam.status} — its papers are frozen`,
      );
    }
  }
}

/** "HH:mm" → the 1970-01-01 Date a `TIME(0)` column round-trips through. */
function timeValue(value: string): Date {
  return new Date(`1970-01-01T${value}:00.000Z`);
}
