import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ExamStatus,
  MarkStatus,
  SessionStatus,
  UserType,
} from '../../../common/constants';
import { SessionsService } from '../../academic/services/sessions.service';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { ExamsService } from '../../exam/services/exams.service';
import { PermissionsService } from '../../rbac/services/permissions.service';
import { COMPONENTS } from '../calc/subject-result.engine';
import {
  MarkError,
  MarkInput,
  resolveTotal,
  validateMark,
} from '../calc/mark-entry.engine';
import { CorrectMarkDto, MarkGridQueryDto, SaveMarksDto } from '../dto';
import { MarkCorrectionsRepository } from '../repositories/mark-corrections.repository';
import { MarksRepository } from '../repositories/marks.repository';
import {
  ExamPaper,
  ResultCandidatesService,
} from './result-candidates.service';

export interface MarkGridRow {
  enrollmentId: string;
  studentId: string;
  studentUid: string;
  studentName: string;
  rollNo: number;
  sectionId: string;
  sectionName: string;
  markId: string | null;
  cq: number | null;
  mcq: number | null;
  practical: number | null;
  ca: number | null;
  total: number;
  isAbsent: boolean;
  grade: string | null;
  gradePoint: number | null;
  status: MarkStatus;
  remarks: string | null;
}

export interface MarkGrid {
  paper: ExamPaper;
  /** Which columns the grid renders — empty ⇒ one "Marks" column. */
  components: string[];
  /** The lowest status among the rows: what the action bar may do next. */
  status: MarkStatus;
  editable: boolean;
  entered: number;
  rows: MarkGridRow[];
}

export interface PaperMarkStatus {
  examSubjectId: string;
  classId: string;
  className: string;
  subjectId: string;
  subjectName: string;
  candidates: number;
  entered: number;
  status: MarkStatus;
  locked: boolean;
}

/**
 * Mark entry and its four-eyes lifecycle (roadmap M15 §4):
 * `DRAFT → SUBMITTED → VERIFIED → LOCKED`, with each step a separate
 * permission because they are meant to be separate people. A locked
 * mark leaves the flow entirely — it changes only through the correction
 * path, which demands a reason and writes an unerasable log row.
 *
 * Three invariants shape the code:
 *
 *   - **A paper moves as a unit.** Submitting half a section's marks
 *     would leave a verifier looking at an unfinished sheet, so submit,
 *     verify and lock all operate on the whole paper.
 *   - **A save is all-or-nothing.** One bad cell refuses the payload
 *     with every offending cell in `error.details.marks`, which is what
 *     lets the grid paint them all at once instead of surfacing them one
 *     round-trip at a time (the M14 distribution-grid contract).
 *   - **The bound the database cannot see is enforced here.** A
 *     component's ceiling is its allocation on `exam_subjects`, one join
 *     away from the mark row, so `mark-entry.engine.ts` is the only
 *     place that check can live.
 */
@Injectable()
export class MarksService {
  constructor(
    private readonly marks: MarksRepository,
    private readonly corrections: MarkCorrectionsRepository,
    private readonly candidates: ResultCandidatesService,
    private readonly exams: ExamsService,
    private readonly sessions: SessionsService,
    private readonly permissions: PermissionsService,
    private readonly auditContext: AuditContextService,
  ) {}

  // ── read ────────────────────────────────────────────────────────────

  /** The entry grid for one paper, optionally narrowed to a section. */
  async grid(
    examId: string,
    query: MarkGridQueryDto,
    schoolId: string,
  ): Promise<MarkGrid> {
    const exam = await this.exams.loadExam(examId, schoolId);
    const paper = await this.loadPaper(
      exam.id,
      exam.sessionId,
      schoolId,
      query.examSubjectId,
    );

    const [roster, existing] = await Promise.all([
      this.candidates.candidatesForPaper(
        paper,
        exam.sessionId,
        schoolId,
        query.sectionId,
      ),
      this.marks.findForPaper(paper.examSubjectId),
    ]);

    const byEnrollment = new Map(existing.map((m) => [m.enrollmentId, m]));
    const rows: MarkGridRow[] = roster.map((enrollment) => {
      const mark = byEnrollment.get(enrollment.id);
      return {
        enrollmentId: enrollment.id,
        studentId: enrollment.studentId,
        studentUid: enrollment.student.studentUid,
        studentName:
          `${enrollment.student.firstName} ${enrollment.student.lastName}`.trim(),
        rollNo: enrollment.rollNo,
        sectionId: enrollment.sectionId,
        sectionName: enrollment.section.name,
        markId: mark?.id ?? null,
        cq: toNumber(mark?.cq),
        mcq: toNumber(mark?.mcq),
        practical: toNumber(mark?.practical),
        ca: toNumber(mark?.ca),
        total: toNumber(mark?.total) ?? 0,
        isAbsent: mark?.isAbsent ?? false,
        grade: mark?.grade ?? null,
        gradePoint: toNumber(mark?.gradePoint),
        status: mark?.status ?? MarkStatus.DRAFT,
        remarks: mark?.remarks ?? null,
      };
    });

    const status = lowestStatus(rows.map((r) => r.status));
    return {
      paper,
      components: COMPONENTS.filter(
        (c) =>
          paper.componentMarks[c] !== null &&
          paper.componentMarks[c] !== undefined,
      ),
      status,
      editable: status === MarkStatus.DRAFT || status === MarkStatus.SUBMITTED,
      entered: rows.filter((r) => r.markId !== null).length,
      rows,
    };
  }

  /** Per-paper progress — the exam's Marks tab and the processing gate. */
  async paperStatuses(
    examId: string,
    schoolId: string,
  ): Promise<PaperMarkStatus[]> {
    const exam = await this.exams.loadExam(examId, schoolId);
    const papers = await this.candidates.loadPapers(
      exam.id,
      exam.sessionId,
      schoolId,
    );
    const counts = await this.marks.countByStatusForExam(exam.id);

    const byPaper = new Map<string, Map<MarkStatus, number>>();
    for (const row of counts) {
      const map =
        byPaper.get(row.examSubjectId) ?? new Map<MarkStatus, number>();
      map.set(row.status, row.count);
      byPaper.set(row.examSubjectId, map);
    }

    const statuses: PaperMarkStatus[] = [];
    for (const paper of papers) {
      const roster = await this.candidates.candidatesForPaper(
        paper,
        exam.sessionId,
        schoolId,
      );
      const map =
        byPaper.get(paper.examSubjectId) ?? new Map<MarkStatus, number>();
      const entered = [...map.values()].reduce((sum, n) => sum + n, 0);

      // A paper nobody has touched is DRAFT, not "locked because there
      // is nothing to lock" — the processing gate depends on that.
      const present = [...map.entries()]
        .filter(([, count]) => count > 0)
        .map(([status]) => status);
      const status = entered === 0 ? MarkStatus.DRAFT : lowestStatus(present);

      statuses.push({
        examSubjectId: paper.examSubjectId,
        classId: paper.classId,
        className: paper.className,
        subjectId: paper.subjectId,
        subjectName: paper.subjectName,
        candidates: roster.length,
        entered,
        status,
        locked: status === MarkStatus.LOCKED && entered >= roster.length,
      });
    }
    return statuses;
  }

  async correctionLog(examId: string, schoolId: string) {
    await this.exams.loadExam(examId, schoolId);
    return this.corrections.findForExam(examId);
  }

  // ── write ───────────────────────────────────────────────────────────

  /**
   * Bulk save one paper's grid as DRAFT. Idempotent by (paper,
   * candidate), so autosave can fire as often as the grid likes.
   */
  async save(
    examId: string,
    dto: SaveMarksDto,
    actor: AccessTokenPayload,
  ): Promise<{ saved: number; status: MarkStatus }> {
    const schoolId = actor.schoolId;
    const exam = await this.exams.loadExam(examId, schoolId);
    await this.assertEntryOpen(exam, schoolId);

    const paper = await this.loadPaper(
      exam.id,
      exam.sessionId,
      schoolId,
      dto.examSubjectId,
    );
    const existing = await this.marks.findForPaper(paper.examSubjectId);
    const byEnrollment = new Map(existing.map((m) => [m.enrollmentId, m]));

    // A locked paper is out of the entry flow entirely; correcting one
    // number is a different, logged operation.
    const locked = existing.filter((m) => m.status === MarkStatus.LOCKED);
    if (locked.length > 0) {
      throw new ConflictException(
        `${paper.subjectName} (${paper.className}) is LOCKED — use the correction flow to change a mark`,
      );
    }

    const roster = await this.candidates.candidatesForPaper(
      paper,
      exam.sessionId,
      schoolId,
    );
    const eligible = new Set(roster.map((e) => e.id));

    const errors: MarkError[] = [];
    for (const input of dto.marks) {
      if (!eligible.has(input.enrollmentId)) {
        errors.push({
          enrollmentId: input.enrollmentId,
          field: 'enrollmentId',
          message: paper.isOptional
            ? 'This candidate did not take the optional subject'
            : 'This candidate is not on the paper’s roster',
        });
        continue;
      }
      errors.push(...validateMark(paper, input));
    }

    // All-or-nothing: half a saved section is worse than a rejected one.
    if (errors.length > 0) {
      throw new BadRequestException({
        message: `${errors.length} mark(s) are invalid — nothing was saved`,
        details: { marks: errors },
      });
    }

    const rows: Prisma.MarkUncheckedCreateInput[] = dto.marks.map((input) => {
      const absent = input.isAbsent ?? false;
      return {
        schoolId,
        examId: exam.id,
        examSubjectId: paper.examSubjectId,
        enrollmentId: input.enrollmentId,
        cq: absent ? null : (input.cq ?? null),
        mcq: absent ? null : (input.mcq ?? null),
        practical: absent ? null : (input.practical ?? null),
        ca: absent ? null : (input.ca ?? null),
        total: resolveTotal(paper, input),
        isAbsent: absent,
        remarks: input.remarks ?? null,
        // Re-entering a mark invalidates the grade a previous run gave
        // it; leaving a stale grade behind would let a report card print
        // an A+ next to a mark that no longer earns one.
        grade: null,
        gradePoint: null,
        graceApplied: 0,
        status: MarkStatus.DRAFT,
        enteredBy: actor.sub,
        submittedAt: null,
        verifiedBy: null,
        verifiedAt: null,
        createdBy: actor.sub,
        updatedBy: actor.sub,
      };
    });

    await this.marks.saveGrid(rows);

    this.auditContext.set({
      entityType: 'Mark',
      entityId: paper.examSubjectId,
      newValues: {
        action: 'SAVE_GRID',
        examId: exam.id,
        paper: `${paper.className} — ${paper.subjectName}`,
        saved: rows.length,
        absent: rows.filter((r) => r.isAbsent).length,
        previouslyEntered: byEnrollment.size,
      },
    });

    return { saved: rows.length, status: MarkStatus.DRAFT };
  }

  /** Teacher hands the sheet over: DRAFT → SUBMITTED. */
  async submit(
    examId: string,
    examSubjectId: string,
    actor: AccessTokenPayload,
  ) {
    return this.advance(examId, examSubjectId, actor, {
      from: [MarkStatus.DRAFT],
      to: MarkStatus.SUBMITTED,
      data: { submittedAt: new Date() },
      requireComplete: true,
    });
  }

  /** Controller signs it off: SUBMITTED → VERIFIED. */
  async verify(
    examId: string,
    examSubjectId: string,
    actor: AccessTokenPayload,
  ) {
    return this.advance(examId, examSubjectId, actor, {
      from: [MarkStatus.SUBMITTED],
      to: MarkStatus.VERIFIED,
      data: { verifiedBy: actor.sub, verifiedAt: new Date() },
    });
  }

  /** Point of no return: VERIFIED → LOCKED. */
  async lock(examId: string, examSubjectId: string, actor: AccessTokenPayload) {
    return this.advance(examId, examSubjectId, actor, {
      from: [MarkStatus.VERIFIED],
      to: MarkStatus.LOCKED,
      data: { lockedAt: new Date() },
    });
  }

  /**
   * Change a LOCKED mark (roadmap §4 re-check flow). The old and new
   * values land in `mark_corrections` before the mark moves, so a
   * re-check is visible in the record even when the corrected number
   * happens to match what was published.
   */
  async correct(
    examId: string,
    markId: string,
    dto: CorrectMarkDto,
    actor: AccessTokenPayload,
  ): Promise<{ markId: string; enrollmentId: string; reprocess: boolean }> {
    const schoolId = actor.schoolId;
    const exam = await this.exams.loadExam(examId, schoolId);
    const mark = await this.marks.findById(markId, schoolId);
    if (!mark || mark.examId !== exam.id) {
      throw new NotFoundException(`Mark ${markId} not found on this exam`);
    }
    if (mark.status !== MarkStatus.LOCKED) {
      throw new ConflictException(
        'Only LOCKED marks go through the correction flow — edit the grid instead',
      );
    }

    const paper = await this.loadPaper(
      exam.id,
      exam.sessionId,
      schoolId,
      mark.examSubjectId,
    );
    const input: MarkInput = { ...dto, enrollmentId: mark.enrollmentId };
    const errors = validateMark(paper, input);
    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'The corrected mark is invalid',
        details: { marks: errors },
      });
    }

    const absent = dto.isAbsent ?? false;
    const oldValues = {
      cq: toNumber(mark.cq),
      mcq: toNumber(mark.mcq),
      practical: toNumber(mark.practical),
      ca: toNumber(mark.ca),
      total: toNumber(mark.total),
      isAbsent: mark.isAbsent,
      grade: mark.grade,
    };
    const newValues = {
      cq: absent ? null : (dto.cq ?? null),
      mcq: absent ? null : (dto.mcq ?? null),
      practical: absent ? null : (dto.practical ?? null),
      ca: absent ? null : (dto.ca ?? null),
      total: resolveTotal(paper, input),
      isAbsent: absent,
    };

    await this.marks.withTransaction(async (tx) => {
      await this.corrections.create(
        {
          schoolId,
          markId: mark.id,
          oldValues,
          newValues,
          reason: dto.reason,
          correctedBy: actor.sub,
        },
        tx,
      );
      await this.marks.update(
        mark.id,
        {
          ...newValues,
          remarks: dto.remarks ?? mark.remarks,
          // The grade is cleared, not recomputed here: only a
          // processing run may write one, and it must see the whole
          // candidate to redo their GPA and merit position.
          grade: null,
          gradePoint: null,
          graceApplied: 0,
          updatedBy: actor.sub,
        },
        tx,
      );
    });

    this.auditContext.set({
      entityType: 'Mark',
      entityId: mark.id,
      oldValues,
      newValues: { ...newValues, reason: dto.reason },
    });

    return {
      markId: mark.id,
      enrollmentId: mark.enrollmentId,
      reprocess: dto.reprocess ?? true,
    };
  }

  // ── internals ───────────────────────────────────────────────────────

  private async advance(
    examId: string,
    examSubjectId: string,
    actor: AccessTokenPayload,
    move: {
      from: MarkStatus[];
      to: MarkStatus;
      data: Prisma.MarkUncheckedUpdateManyInput;
      requireComplete?: boolean;
    },
  ): Promise<{ moved: number; status: MarkStatus }> {
    const schoolId = actor.schoolId;
    const exam = await this.exams.loadExam(examId, schoolId);
    const paper = await this.loadPaper(
      exam.id,
      exam.sessionId,
      schoolId,
      examSubjectId,
    );

    const existing = await this.marks.findForPaper(examSubjectId);
    if (existing.length === 0) {
      throw new BadRequestException(
        `No marks have been entered for ${paper.subjectName} (${paper.className})`,
      );
    }

    const wrongState = existing.filter((m) => !move.from.includes(m.status));
    if (wrongState.length > 0) {
      const current = lowestStatus(existing.map((m) => m.status));
      throw new ConflictException(
        `${paper.subjectName} (${paper.className}) is ${current} — it cannot move to ${move.to} from there`,
      );
    }

    // Submitting a partial sheet is the mistake that makes a verifier
    // sign off on a class with three students missing.
    if (move.requireComplete) {
      const roster = await this.candidates.candidatesForPaper(
        paper,
        exam.sessionId,
        schoolId,
      );
      const missing = roster.length - existing.length;
      if (missing > 0) {
        throw new ConflictException(
          `${missing} candidate(s) still have no mark for ${paper.subjectName} (${paper.className}) — mark them absent if they did not sit`,
        );
      }
    }

    const moved = await this.marks.setStatusForPaper(examSubjectId, move.from, {
      ...move.data,
      status: move.to,
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'Mark',
      entityId: examSubjectId,
      oldValues: { status: move.from.join('|') },
      newValues: {
        status: move.to,
        examId: exam.id,
        paper: `${paper.className} — ${paper.subjectName}`,
        marks: moved,
      },
    });

    return { moved, status: move.to };
  }

  private async loadPaper(
    examId: string,
    sessionId: string,
    schoolId: string,
    examSubjectId: string,
  ): Promise<ExamPaper> {
    const papers = await this.candidates.loadPapers(
      examId,
      sessionId,
      schoolId,
    );
    const paper = papers.find((p) => p.examSubjectId === examSubjectId);
    if (!paper) {
      throw new NotFoundException(`Paper ${examSubjectId} is not on this exam`);
    }
    return paper;
  }

  /**
   * Mark entry needs the exam to be in MARK_ENTRY or PROCESSING and the
   * session to still be writable — the M05 read-only rule that M12/M13
   * already enforce.
   */
  private async assertEntryOpen(
    exam: {
      id: string;
      name: string;
      status: ExamStatus;
      sessionId: string;
    },
    schoolId: string,
  ): Promise<void> {
    const open: ExamStatus[] = [ExamStatus.MARK_ENTRY, ExamStatus.PROCESSING];
    if (!open.includes(exam.status)) {
      throw new ConflictException(
        `${exam.name} is ${exam.status} — move it to MARK_ENTRY before entering marks`,
      );
    }
    const session = await this.sessions.getById(exam.sessionId, schoolId);
    if (
      session.status === SessionStatus.COMPLETED ||
      session.status === SessionStatus.ARCHIVED
    ) {
      throw new BadRequestException(
        `Session ${session.name} is ${session.status} — marks are read-only`,
      );
    }
  }

  /** Runtime permission check, the M08/M12 override convention. */
  async assertPermission(
    actor: AccessTokenPayload,
    code: string,
    message: string,
  ): Promise<void> {
    if (actor.userType === UserType.SUPER_ADMIN) return;
    const codes = await this.permissions.getUserPermissionCodes(actor.sub);
    if (!codes.includes(code)) throw new ForbiddenException(message);
  }
}

/** The furthest-back status in a set — what the paper as a whole is. */
function lowestStatus(statuses: MarkStatus[]): MarkStatus {
  const order: MarkStatus[] = [
    MarkStatus.DRAFT,
    MarkStatus.SUBMITTED,
    MarkStatus.VERIFIED,
    MarkStatus.LOCKED,
  ];
  if (statuses.length === 0) return MarkStatus.DRAFT;
  return order[Math.min(...statuses.map((s) => order.indexOf(s)))];
}

function toNumber(value: Prisma.Decimal | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}
