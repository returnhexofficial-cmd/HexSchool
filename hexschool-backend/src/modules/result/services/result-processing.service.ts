import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ResultRun } from '@prisma/client';
import {
  ExamStatus,
  MarkStatus,
  ResultRunStatus,
  ResultStatus,
} from '../../../common/constants';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { ExamsRepository } from '../../exam/repositories/exams.repository';
import type { ExamWithRelations } from '../../exam/repositories/exams.repository';
import { GradingSystemsRepository } from '../../school/repositories/grading-systems.repository';
import { aggregate } from '../calc/gpa.engine';
import {
  GradingSnapshot,
  parseGradingSnapshot,
} from '../calc/grading-snapshot';
import { rankScopes } from '../calc/merit.engine';
import { evaluateSubjects, MarkEntry } from '../calc/subject-result.engine';
import { ProcessResultsDto } from '../dto';
import { MarksRepository } from '../repositories/marks.repository';
import { ResultRunsRepository } from '../repositories/result-runs.repository';
import { ResultsRepository } from '../repositories/results.repository';
import { ResultCandidatesService } from './result-candidates.service';
import { ResultSettingsService } from './result-settings.service';

export interface RunIssue {
  enrollmentId: string;
  studentName: string;
  rollNo: number;
  kind: 'MISSING_MARKS' | 'INACTIVE_ENROLLMENT';
  detail: string;
}

export interface ProcessingStatus {
  run: ResultRun | null;
  results: number;
  byStatus: Array<{ status: ResultStatus; count: number }>;
  /** Papers still short of LOCKED — why a run would be refused. */
  unlockedPapers: number;
  /** Marks changed since the last completed run: results are stale. */
  stale: boolean;
}

/**
 * The processing run (roadmap M15 §4): marks → subject grades → GPA →
 * merit positions → `results` rows.
 *
 * **Idempotent by construction.** Everything it writes is an upsert on
 * `uq_results_exam_candidate`, so re-running is safe, cheap and the
 * normal way to fix anything — which matters because the correction flow
 * re-runs it for a single candidate on every re-check.
 *
 * **The grade scale is frozen on the first run, not at publication.**
 * Module 14 froze `exams.grading_snapshot` at PUBLISH, which left a real
 * hole: results computed during PROCESSING would be graded through the
 * live table, and an edit to a band between processing and publication
 * would freeze a scale that no result on file was ever computed
 * against. Freezing here, and having M14's publish step keep an existing
 * snapshot rather than overwrite it, closes that gap — the scale a
 * result was graded through is the scale that gets published.
 *
 * **Merit is a second pass.** Positions are relative, so they can only
 * be assigned once every candidate has a GPA; the upsert deliberately
 * NULLs them first so a re-run can never leave a stale rank behind.
 */
@Injectable()
export class ResultProcessingService {
  private readonly logger = new Logger(ResultProcessingService.name);

  constructor(
    private readonly runs: ResultRunsRepository,
    private readonly results: ResultsRepository,
    private readonly marks: MarksRepository,
    private readonly candidates: ResultCandidatesService,
    private readonly exams: ExamsRepository,
    private readonly gradingSystems: GradingSystemsRepository,
    private readonly config: ResultSettingsService,
    private readonly auditContext: AuditContextService,
  ) {}

  // ── read ────────────────────────────────────────────────────────────

  async status(examId: string, schoolId: string): Promise<ProcessingStatus> {
    const exam = await this.loadExam(examId, schoolId);
    const [run, results, byStatus, lastRun, lastMarkChange] = await Promise.all(
      [
        this.runs.findLatest(exam.id),
        this.results.countForExam(exam.id),
        this.results.countByStatus(exam.id),
        this.runs.findLatestCompleted(exam.id),
        this.marks.lastChangedAt(exam.id),
      ],
    );

    const unlocked = await this.countUnlockedPapers(exam, schoolId);

    return {
      run,
      results,
      byStatus,
      unlockedPapers: unlocked.length,
      // A mark edited after the last run means the results on file no
      // longer describe the marks on file — the publication gate's
      // single most useful check.
      stale:
        results > 0 &&
        lastMarkChange !== null &&
        (lastRun?.finishedAt ?? null) !== null &&
        lastMarkChange > (lastRun as ResultRun).finishedAt!,
    };
  }

  async history(examId: string, schoolId: string): Promise<ResultRun[]> {
    await this.loadExam(examId, schoolId);
    return this.runs.findRecent(examId);
  }

  // ── write ───────────────────────────────────────────────────────────

  /**
   * Queue a run. The row is created QUEUED here and executed by the
   * processor (or inline, when the queue cannot take it) — the caller
   * gets an id to poll rather than a request that hangs for a minute on
   * a 2,000-candidate exam.
   */
  async enqueue(
    examId: string,
    dto: ProcessResultsDto,
    actor: AccessTokenPayload,
  ): Promise<ResultRun> {
    const schoolId = actor.schoolId;
    const exam = await this.loadExam(examId, schoolId);

    if (
      exam.status === ExamStatus.DRAFT ||
      exam.status === ExamStatus.SCHEDULED
    ) {
      throw new ConflictException(
        `${exam.name} is ${exam.status} — there are no marks to process yet`,
      );
    }
    if (exam.status === ExamStatus.ARCHIVED) {
      throw new ConflictException(`${exam.name} is ARCHIVED`);
    }

    // Two concurrent runs would race the merit pass and leave half the
    // exam ranked against the other half's GPAs.
    const active = await this.runs.findActive(exam.id);
    if (active) {
      throw new ConflictException(
        `A processing run for ${exam.name} is already ${active.status}`,
      );
    }

    const config = await this.config.load(schoolId);
    const override = dto.override ?? false;

    if (config.requireLockedMarks && !override) {
      const unlocked = await this.countUnlockedPapers(exam, schoolId);
      if (unlocked.length > 0) {
        throw new ConflictException({
          message: `${unlocked.length} paper(s) are not LOCKED — lock them, or process with override to produce INCOMPLETE results`,
          details: { unlockedPapers: unlocked },
        });
      }
    }

    const run = await this.runs.create({
      schoolId,
      examId: exam.id,
      status: ResultRunStatus.QUEUED,
      override,
      scopeEnrollmentId: dto.enrollmentId ?? null,
      triggeredBy: actor.sub,
    });

    // Processing is the status the exam wears while a run is in flight;
    // moving it here (rather than asking the user to) is what makes
    // "process" a single button.
    if (exam.status === ExamStatus.MARK_ENTRY) {
      await this.exams.setStatus(exam.id, {
        status: ExamStatus.PROCESSING,
        updatedBy: actor.sub,
      });
    }

    this.auditContext.set({
      entityType: 'ResultRun',
      entityId: run.id,
      newValues: {
        examId: exam.id,
        exam: exam.name,
        override,
        scopeEnrollmentId: dto.enrollmentId ?? null,
      },
    });

    return run;
  }

  /**
   * Execute a queued run. Called by the BullMQ processor, and directly
   * by the correction flow (a single-candidate reprocess is fast enough
   * that queueing it would only add latency to a re-check).
   */
  async execute(runId: string, schoolId: string): Promise<ResultRun> {
    const run = await this.runs.findById(runId, schoolId);
    if (!run) throw new NotFoundException(`Processing run ${runId} not found`);
    if (run.status === ResultRunStatus.COMPLETED) return run;

    const exam = await this.loadExam(run.examId, schoolId);
    await this.runs.update(run.id, {
      status: ResultRunStatus.RUNNING,
      startedAt: new Date(),
    });

    try {
      const outcome = await this.compute(exam, run, schoolId);
      return await this.runs.update(run.id, {
        status: ResultRunStatus.COMPLETED,
        total: outcome.total,
        processed: outcome.processed,
        issues: outcome.issues as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Result run ${run.id} failed: ${message}`);
      return this.runs.update(run.id, {
        status: ResultRunStatus.FAILED,
        error: message.slice(0, 1000),
        finishedAt: new Date(),
      });
    }
  }

  /** Enqueue + execute, for callers that want the finished run back. */
  async processNow(
    examId: string,
    dto: ProcessResultsDto,
    actor: AccessTokenPayload,
  ): Promise<ResultRun> {
    const run = await this.enqueue(examId, dto, actor);
    return this.execute(run.id, actor.schoolId);
  }

  // ── the computation ─────────────────────────────────────────────────

  private async compute(
    exam: ExamWithRelations,
    run: ResultRun,
    schoolId: string,
  ): Promise<{ total: number; processed: number; issues: RunIssue[] }> {
    const config = await this.config.load(schoolId);
    const snapshot = await this.freezeGradingScale(exam, schoolId);

    const papers = await this.candidates.loadPapers(
      exam.id,
      exam.sessionId,
      schoolId,
    );
    if (papers.length === 0) {
      throw new BadRequestException(
        `${exam.name} has no papers — there is nothing to process`,
      );
    }

    const roster = await this.candidates.candidatesForExam(
      papers,
      exam.sessionId,
      schoolId,
    );
    const scoped = run.scopeEnrollmentId
      ? [...roster.values()].filter((e) => e.id === run.scopeEnrollmentId)
      : [...roster.values()];

    const allMarks = await this.marks.findForExam(
      exam.id,
      run.scopeEnrollmentId ?? undefined,
    );
    const marksByCandidate = new Map<string, Map<string, MarkEntry>>();
    for (const mark of allMarks) {
      const map =
        marksByCandidate.get(mark.enrollmentId) ?? new Map<string, MarkEntry>();
      map.set(mark.examSubjectId, {
        cq: numberOrNull(mark.cq),
        mcq: numberOrNull(mark.mcq),
        practical: numberOrNull(mark.practical),
        ca: numberOrNull(mark.ca),
        total: Number(mark.total),
        isAbsent: mark.isAbsent,
      });
      marksByCandidate.set(mark.enrollmentId, map);
    }
    const markRowByKey = new Map(
      allMarks.map((m) => [`${m.enrollmentId}:${m.examSubjectId}`, m]),
    );

    const issues: RunIssue[] = [];
    const ranked: Array<{
      key: string;
      gpa: number;
      obtainedMarks: number;
      rollNo: number;
      sectionId: string;
      classId: string;
    }> = [];
    const resultIdByEnrollment = new Map<string, string>();
    let processed = 0;

    await this.results.withTransaction(async (tx) => {
      for (const enrollment of scoped) {
        const theirPapers = this.candidates.papersForCandidate(
          enrollment,
          papers,
        );
        if (theirPapers.length === 0) continue;

        const outcomes = evaluateSubjects(
          theirPapers,
          marksByCandidate.get(enrollment.id) ?? new Map<string, MarkEntry>(),
          snapshot,
          {
            graceMarks: config.graceMarks,
            graceMaxSubjects: config.graceMaxSubjects,
          },
        );
        const summary = aggregate(outcomes, snapshot, {
          optionalBonusBase: config.optionalBonusBase,
        });

        // Write each subject's computed grade back onto its mark, so the
        // report card, tabulation sheet and portal all read one number
        // rather than three services re-deriving it.
        for (const outcome of outcomes) {
          const row = markRowByKey.get(
            `${enrollment.id}:${outcome.examSubjectId}`,
          );
          if (!row) continue;
          await this.marks.setGrade(
            row.id,
            {
              grade: outcome.grade,
              gradePoint: outcome.gradePoint,
              graceApplied: outcome.graceApplied,
            },
            tx,
          );
        }

        if (summary.missingSubjects.length > 0) {
          issues.push({
            enrollmentId: enrollment.id,
            studentName:
              `${enrollment.student.firstName} ${enrollment.student.lastName}`.trim(),
            rollNo: enrollment.rollNo,
            kind: 'MISSING_MARKS',
            detail: `No marks for ${summary.missingSubjects.join(', ')}`,
          });
        }

        // A result already WITHHELD stays withheld: withholding is an
        // administrative decision about a person, and a re-run of the
        // arithmetic must not quietly release it.
        const existing = await this.results.findForCandidate(
          exam.id,
          enrollment.id,
        );
        const status =
          existing?.status === ResultStatus.WITHHELD
            ? ResultStatus.WITHHELD
            : summary.status;

        const id = await this.results.upsert(
          {
            schoolId,
            examId: exam.id,
            enrollmentId: enrollment.id,
            totalMarks: summary.totalMarks,
            obtainedMarks: summary.obtainedMarks,
            gpa: summary.gpa,
            gpaWithoutOptional: summary.gpaWithoutOptional,
            grade: summary.grade,
            subjectsCount: summary.subjectsCount,
            failedSubjects: summary.failedSubjects,
            status,
            gradingSnapshot: snapshot as unknown as Prisma.InputJsonValue,
            withheldReason: existing?.withheldReason ?? null,
            processedAt: new Date(),
            publishedAt: existing?.publishedAt ?? null,
            createdBy: run.triggeredBy,
            updatedBy: run.triggeredBy,
          },
          tx,
        );
        resultIdByEnrollment.set(enrollment.id, id);
        processed += 1;

        if (status === ResultStatus.PASSED) {
          ranked.push({
            key: enrollment.id,
            gpa: summary.gpa,
            obtainedMarks: summary.obtainedMarks,
            rollNo: enrollment.rollNo,
            sectionId: enrollment.sectionId,
            classId: enrollment.classId,
          });
        }
      }
    });

    await this.assignMerit(
      exam,
      schoolId,
      config.meritTiebreak,
      run.scopeEnrollmentId !== null,
      resultIdByEnrollment,
      ranked,
    );

    return { total: scoped.length, processed, issues };
  }

  /**
   * Merit positions, in a second pass over the WHOLE exam.
   *
   * A single-candidate reprocess still has to re-rank everyone: their
   * new GPA may have moved them past three classmates, and leaving the
   * others' positions untouched would publish two students at rank 4.
   */
  private async assignMerit(
    exam: ExamWithRelations,
    schoolId: string,
    tiebreak: 'NONE' | 'ROLL_ASC',
    scoped: boolean,
    scopedIds: Map<string, string>,
    scopedRanked: Array<{
      key: string;
      gpa: number;
      obtainedMarks: number;
      rollNo: number;
      sectionId: string;
      classId: string;
    }>,
  ): Promise<void> {
    let rows = scopedRanked;
    let idByEnrollment = scopedIds;

    if (scoped) {
      const all = await this.results.findForExam(exam.id);
      rows = all
        .filter((r) => r.status === ResultStatus.PASSED)
        .map((r) => ({
          key: r.enrollmentId,
          gpa: Number(r.gpa),
          obtainedMarks: Number(r.obtainedMarks),
          rollNo: r.enrollment.rollNo,
          sectionId: r.enrollment.sectionId,
          classId: r.enrollment.classId,
        }));
      idByEnrollment = new Map(all.map((r) => [r.enrollmentId, r.id]));
    }

    const positions = rankScopes(rows, tiebreak);
    await this.results.withTransaction(async (tx) => {
      for (const [enrollmentId, resultId] of idByEnrollment) {
        await this.results.setMerit(
          resultId,
          positions.get(enrollmentId) ?? { section: null, class: null },
          tx,
        );
      }
    });
  }

  /**
   * The exam's grade scale, frozen on first use. Later runs reuse the
   * frozen copy verbatim — re-reading the live table would mean two runs
   * of the same exam could grade the same mark differently.
   */
  private async freezeGradingScale(
    exam: ExamWithRelations,
    schoolId: string,
  ): Promise<GradingSnapshot> {
    if (exam.gradingSnapshot) {
      return parseGradingSnapshot(exam.gradingSnapshot);
    }

    const system = await this.gradingSystems.findByIdWithPoints(
      exam.gradingSystemId,
      schoolId,
    );
    if (!system) {
      throw new BadRequestException(
        'The exam’s grading system no longer exists — nothing to grade against',
      );
    }
    const snapshot = {
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

    await this.exams.setStatus(exam.id, {
      gradingSnapshot: snapshot,
    });
    this.logger.log(
      `Froze grade scale "${system.name}" onto exam ${exam.id} at first processing`,
    );

    return parseGradingSnapshot(snapshot);
  }

  /** Papers whose marks have not all reached LOCKED. */
  private async countUnlockedPapers(
    exam: ExamWithRelations,
    schoolId: string,
  ): Promise<Array<{ examSubjectId: string; label: string; status: string }>> {
    const papers = await this.candidates.loadPapers(
      exam.id,
      exam.sessionId,
      schoolId,
    );
    const counts = await this.marks.countByStatusForExam(exam.id);
    const byPaper = new Map<string, Set<MarkStatus>>();
    for (const row of counts) {
      const set = byPaper.get(row.examSubjectId) ?? new Set<MarkStatus>();
      if (row.count > 0) set.add(row.status);
      byPaper.set(row.examSubjectId, set);
    }

    return papers
      .filter((paper) => {
        const set = byPaper.get(paper.examSubjectId);
        // No marks at all counts as unlocked — an untouched paper is
        // exactly the case the gate exists to catch.
        return !set || set.size === 0 || !onlyLocked(set);
      })
      .map((paper) => ({
        examSubjectId: paper.examSubjectId,
        label: `${paper.className} — ${paper.subjectName}`,
        status: statusLabel(byPaper.get(paper.examSubjectId)),
      }));
  }

  private async loadExam(
    examId: string,
    schoolId: string,
  ): Promise<ExamWithRelations> {
    const exam = await this.exams.findDetail(examId, schoolId);
    if (!exam) throw new NotFoundException(`Exam ${examId} not found`);
    return exam;
  }
}

function onlyLocked(statuses: Set<MarkStatus>): boolean {
  return statuses.size === 1 && statuses.has(MarkStatus.LOCKED);
}

function statusLabel(statuses: Set<MarkStatus> | undefined): string {
  if (!statuses || statuses.size === 0) return 'NO_MARKS';
  return [...statuses].join('|');
}

function numberOrNull(value: Prisma.Decimal | null): number | null {
  return value === null ? null : Number(value);
}
