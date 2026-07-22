import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ResultStatus } from '../../../common/constants';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { ExamsService } from '../../exam/services/exams.service';
import { parseGradingSnapshot } from '../calc/grading-snapshot';
import { evaluateSubjects, MarkEntry } from '../calc/subject-result.engine';
import {
  PublicResultSearchDto,
  ResultQueryDto,
  TranscriptQueryDto,
  WithholdResultDto,
} from '../dto';
import { MarksRepository } from '../repositories/marks.repository';
import { ResultPublicationsRepository } from '../repositories/result-publications.repository';
import {
  ResultsRepository,
  ResultWithRelations,
} from '../repositories/results.repository';
import { ResultCandidatesService } from './result-candidates.service';
import { ResultSettingsService } from './result-settings.service';

export interface ResultSubjectRow {
  examSubjectId: string;
  subjectId: string;
  subjectName: string;
  subjectNameBn: string | null;
  subjectCode: string | null;
  isOptional: boolean;
  fullMarks: number;
  passMarks: number;
  cq: number | null;
  mcq: number | null;
  practical: number | null;
  ca: number | null;
  obtained: number;
  graceApplied: number;
  isAbsent: boolean;
  grade: string;
  gradePoint: number;
  passed: boolean;
  failedComponents: string[];
}

export interface ResultDetail {
  result: ResultWithRelations;
  subjects: ResultSubjectRow[];
  published: boolean;
}

/**
 * Reading results, and the two things an administrator may do to one by
 * hand: withhold it and release it.
 *
 * Everything numeric is read back rather than recomputed — the grades on
 * `marks` and the totals on `results` were written by a processing run
 * against a frozen scale, and re-deriving them here would open the door
 * to a report card and a portal disagreeing. The one exception is the
 * per-subject pass/fail *explanation*, which the engine reproduces from
 * the stored marks so a parent can be told **why** a subject failed.
 */
@Injectable()
export class ResultsService {
  constructor(
    private readonly results: ResultsRepository,
    private readonly marks: MarksRepository,
    private readonly publications: ResultPublicationsRepository,
    private readonly candidates: ResultCandidatesService,
    private readonly exams: ExamsService,
    private readonly config: ResultSettingsService,
    private readonly auditContext: AuditContextService,
  ) {}

  // ── read ────────────────────────────────────────────────────────────

  async list(
    examId: string,
    query: ResultQueryDto,
    schoolId: string,
  ): Promise<{ results: ResultWithRelations[]; published: boolean }> {
    await this.exams.loadExam(examId, schoolId);
    const [results, published] = await Promise.all([
      this.results.findForExam(examId, query),
      this.publications.isPublished(examId),
    ]);
    return { results, published };
  }

  async getById(id: string, schoolId: string): Promise<ResultDetail> {
    const result = await this.results.findById(id, schoolId);
    if (!result) throw new NotFoundException(`Result ${id} not found`);
    return this.detail(result, schoolId);
  }

  async getForCandidate(
    examId: string,
    enrollmentId: string,
    schoolId: string,
  ): Promise<ResultDetail> {
    const result = await this.results.findForCandidate(examId, enrollmentId);
    if (!result) {
      throw new NotFoundException(
        'No result has been processed for this candidate',
      );
    }
    return this.detail(result, schoolId);
  }

  /** The subject rows behind a result — the report card's body. */
  async detail(
    result: ResultWithRelations,
    schoolId: string,
  ): Promise<ResultDetail> {
    const papers = await this.candidates.loadPapers(
      result.examId,
      result.exam.sessionId,
      schoolId,
    );
    const theirPapers = papers.filter(
      (paper) =>
        paper.classId === result.enrollment.classId &&
        (!paper.isOptional ||
          result.enrollment.optionalSubjectId === paper.subjectId),
    );

    const marks = await this.marks.findForExam(
      result.examId,
      result.enrollmentId,
    );
    const byPaper = new Map(marks.map((m) => [m.examSubjectId, m]));

    const config = await this.config.load(schoolId);
    const snapshot = parseGradingSnapshot(result.gradingSnapshot);
    const entries = new Map<string, MarkEntry>(
      marks.map((m) => [
        m.examSubjectId,
        {
          cq: m.cq === null ? null : Number(m.cq),
          mcq: m.mcq === null ? null : Number(m.mcq),
          practical: m.practical === null ? null : Number(m.practical),
          ca: m.ca === null ? null : Number(m.ca),
          total: Number(m.total),
          isAbsent: m.isAbsent,
        },
      ]),
    );

    // Re-run the pure engine over the STORED marks purely to recover the
    // per-component explanation ("Practical 8/10"); the grade printed is
    // still the one the run wrote, so this can never restate a result.
    const outcomes = evaluateSubjects(theirPapers, entries, snapshot, {
      graceMarks: config.graceMarks,
      graceMaxSubjects: config.graceMaxSubjects,
    });

    const subjects: ResultSubjectRow[] = theirPapers.map((paper, index) => {
      const mark = byPaper.get(paper.examSubjectId);
      const outcome = outcomes[index];
      return {
        examSubjectId: paper.examSubjectId,
        subjectId: paper.subjectId,
        subjectName: paper.subjectName,
        subjectNameBn: paper.subjectNameBn,
        subjectCode: paper.subjectCode,
        isOptional: paper.isOptional,
        fullMarks: paper.fullMarks,
        passMarks: paper.passMarks,
        cq: mark?.cq === null || mark === undefined ? null : Number(mark.cq),
        mcq: mark?.mcq === null || mark === undefined ? null : Number(mark.mcq),
        practical:
          mark?.practical === null || mark === undefined
            ? null
            : Number(mark.practical),
        ca: mark?.ca === null || mark === undefined ? null : Number(mark.ca),
        obtained: outcome.obtained,
        graceApplied: mark ? Number(mark.graceApplied) : 0,
        isAbsent: mark?.isAbsent ?? false,
        grade: mark?.grade ?? outcome.grade,
        gradePoint: mark?.gradePoint
          ? Number(mark.gradePoint)
          : outcome.gradePoint,
        passed: outcome.passed,
        failedComponents: outcome.failedComponents,
      };
    });

    return {
      result,
      subjects,
      published: result.publishedAt !== null,
    };
  }

  /** Every exam a student sat in a session — the transcript's data. */
  async transcript(
    studentId: string,
    query: TranscriptQueryDto,
    schoolId: string,
  ): Promise<ResultWithRelations[]> {
    return query.sessionId
      ? this.results.findForStudentSession(studentId, query.sessionId, schoolId)
      : this.results.findForStudent(studentId, schoolId);
  }

  // ── write ───────────────────────────────────────────────────────────

  /**
   * Withhold or release one candidate (roadmap §6 — dues, discipline, an
   * enquiry). A withheld result vanishes from the portal and the public
   * search but is never deleted, and a later processing run will not
   * quietly release it.
   */
  async setWithheld(
    id: string,
    dto: WithholdResultDto,
    actor: AccessTokenPayload,
  ): Promise<ResultWithRelations> {
    const result = await this.results.findById(id, actor.schoolId);
    if (!result) throw new NotFoundException(`Result ${id} not found`);

    if (dto.withheld) {
      if (!dto.reason?.trim()) {
        throw new BadRequestException(
          'Withholding a result requires a reason — it is an administrative act, not a computation',
        );
      }
      if (result.status === ResultStatus.WITHHELD) {
        throw new ConflictException('This result is already withheld');
      }
    } else if (result.status !== ResultStatus.WITHHELD) {
      throw new ConflictException('This result is not withheld');
    }

    // Releasing restores the computed verdict, which means recomputing
    // it from what is on file rather than guessing PASSED.
    const restored = dto.withheld
      ? ResultStatus.WITHHELD
      : Number(result.gpa) > 0
        ? ResultStatus.PASSED
        : ResultStatus.FAILED;

    const updated = await this.results.update(id, {
      status: restored,
      withheldReason: dto.withheld ? dto.reason!.trim() : null,
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'Result',
      entityId: id,
      oldValues: {
        status: result.status,
        withheldReason: result.withheldReason,
      },
      newValues: {
        status: restored,
        withheldReason: dto.withheld ? dto.reason : null,
      },
    });

    return updated;
  }

  // ── public search (roadmap M15 §4, the website endpoint) ────────────

  async publicSearch(
    dto: PublicResultSearchDto,
    schoolId: string,
  ): Promise<{
    student: {
      name: string;
      uid: string;
      rollNo: number;
      className: string;
      sectionName: string;
    };
    exam: { id: string; name: string };
    gpa: number;
    grade: string;
    status: ResultStatus;
    meritPositionClass: number | null;
    subjects: Array<{ subjectName: string; grade: string; gradePoint: number }>;
  }> {
    const config = await this.config.load(schoolId);
    if (!config.publicSearchEnabled) {
      throw new NotFoundException('Public result search is disabled');
    }
    if ((dto.rollNo === undefined) === (dto.studentUid === undefined)) {
      throw new BadRequestException(
        'Provide exactly one of rollNo or studentUid',
      );
    }

    // Visibility is the ACTIVE publication, not `exams.status`: the exam
    // status machine cannot rewind past PUBLISHED (M14), so unpublishing
    // had to get its own switch.
    const active = await this.publications.findActive(dto.examId);
    if (!active || !isChannelOn(active.channels, 'website')) {
      throw new NotFoundException('No published result matches that search');
    }

    const result = await this.results.findPublished(dto.examId, dto.classId, {
      rollNo: dto.rollNo,
      studentUid: dto.studentUid,
    });
    // Deliberately the same 404 for "no such student" and "withheld" —
    // a public endpoint must not confirm that a person exists.
    if (!result || result.schoolId !== schoolId) {
      throw new NotFoundException('No published result matches that search');
    }

    const detail = await this.detail(result, schoolId);
    return {
      student: {
        name: `${result.enrollment.student.firstName} ${result.enrollment.student.lastName}`.trim(),
        uid: result.enrollment.student.studentUid,
        rollNo: result.enrollment.rollNo,
        className: result.enrollment.class.name,
        sectionName: result.enrollment.section.name,
      },
      exam: { id: result.exam.id, name: result.exam.name },
      gpa: Number(result.gpa),
      grade: result.grade,
      status: result.status,
      meritPositionClass: result.meritPositionClass,
      subjects: detail.subjects.map((s) => ({
        subjectName: s.subjectName,
        grade: s.grade,
        gradePoint: s.gradePoint,
      })),
    };
  }
}

export function isChannelOn(channels: unknown, key: string): boolean {
  if (channels === null || typeof channels !== 'object') return false;
  return (channels as Record<string, unknown>)[key] === true;
}
