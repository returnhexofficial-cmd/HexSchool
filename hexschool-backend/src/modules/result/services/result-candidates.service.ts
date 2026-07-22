import { Injectable } from '@nestjs/common';
import { ClassSubjectsRepository } from '../../academic/repositories/class-subjects.repository';
import {
  EnrollmentsRepository,
  EnrollmentWithRelations,
} from '../../enrollment/repositories/enrollments.repository';
import { ExamSubjectsRepository } from '../../exam/repositories/exam-subjects.repository';
import { PaperSpec } from '../calc/subject-result.engine';

/** A paper plus the class it belongs to, for grouping. */
export interface ExamPaper extends PaperSpec {
  examId: string;
  className: string;
  subjectCode: string | null;
  subjectNameBn: string | null;
  displayOrder: number;
}

/**
 * Who sits which paper — the question mark entry and result processing
 * both have to answer before anything else, and the one Module 14
 * already solved for seat plans:
 *
 *   - only **ACTIVE** enrollments of the paper's class, and
 *   - for an **optional (4th) subject**, only the students who chose it.
 *
 * Getting this wrong is not cosmetic. Grading a whole class against an
 * optional paper gives two-thirds of them a compulsory F; leaving the
 * chooser's optional paper out of their GPA drops the 4th-subject bonus
 * they earned. Both are the kind of error a school discovers on
 * publication day.
 *
 * The optional flag lives on `class_subjects` (per class × session ×
 * group), not on `exam_subjects`, so it is resolved here once per exam
 * and cached for the run rather than re-queried per candidate.
 */
@Injectable()
export class ResultCandidatesService {
  constructor(
    private readonly examSubjects: ExamSubjectsRepository,
    private readonly classSubjects: ClassSubjectsRepository,
    private readonly enrollments: EnrollmentsRepository,
  ) {}

  /** Every paper of an exam, with its optionality resolved. */
  async loadPapers(
    examId: string,
    sessionId: string,
    schoolId: string,
  ): Promise<ExamPaper[]> {
    const papers = await this.examSubjects.findForExam(examId);
    const curriculum = new Map<
      string,
      { isOptional: boolean; order: number }
    >();

    for (const classId of new Set(papers.map((p) => p.classId))) {
      const rows = await this.classSubjects.findForClassSession(
        classId,
        sessionId,
        schoolId,
      );
      for (const row of rows) {
        const key = `${classId}:${row.subjectId}`;
        const existing = curriculum.get(key);
        // A subject mapped for several groups is one paper; it is
        // optional only when EVERY mapping says so, because a subject
        // that is compulsory for one group is a compulsory paper.
        curriculum.set(key, {
          isOptional: (existing?.isOptional ?? true) && row.isOptional,
          order: existing?.order ?? row.displayOrder,
        });
      }
    }

    return papers
      .map((paper) => {
        const meta = curriculum.get(`${paper.classId}:${paper.subjectId}`);
        return {
          examSubjectId: paper.id,
          examId: paper.examId,
          classId: paper.classId,
          className: paper.class.name,
          subjectId: paper.subjectId,
          subjectName: paper.subject.name,
          subjectNameBn: paper.subject.nameBn,
          subjectCode: paper.subject.code,
          fullMarks: paper.fullMarks,
          passMarks: paper.passMarks,
          componentMarks: {
            cq: paper.cqMarks,
            mcq: paper.mcqMarks,
            practical: paper.practicalMarks,
            ca: paper.caMarks,
          },
          componentPassMarks: {
            cq: paper.cqPassMarks,
            mcq: paper.mcqPassMarks,
            practical: paper.practicalPassMarks,
            ca: paper.caPassMarks,
          },
          isOptional: meta?.isOptional ?? false,
          displayOrder: meta?.order ?? 0,
        };
      })
      .sort(
        (a, b) =>
          a.className.localeCompare(b.className) ||
          a.displayOrder - b.displayOrder ||
          a.subjectName.localeCompare(b.subjectName),
      );
  }

  /** ACTIVE class roster, minus the students who did not take an optional. */
  async candidatesForPaper(
    paper: ExamPaper,
    sessionId: string,
    schoolId: string,
    sectionId?: string,
  ): Promise<EnrollmentWithRelations[]> {
    const roster = await this.enrollments.findClassRoster(
      paper.classId,
      sessionId,
      schoolId,
    );
    return roster.filter(
      (enrollment) =>
        (!sectionId || enrollment.sectionId === sectionId) &&
        (!paper.isOptional || enrollment.optionalSubjectId === paper.subjectId),
    );
  }

  /** Every candidate of an exam, once, keyed by enrollment id. */
  async candidatesForExam(
    papers: ExamPaper[],
    sessionId: string,
    schoolId: string,
  ): Promise<Map<string, EnrollmentWithRelations>> {
    const byEnrollment = new Map<string, EnrollmentWithRelations>();
    const rosterCache = new Map<string, EnrollmentWithRelations[]>();

    for (const classId of new Set(papers.map((p) => p.classId))) {
      const roster = await this.enrollments.findClassRoster(
        classId,
        sessionId,
        schoolId,
      );
      rosterCache.set(classId, roster);
      for (const enrollment of roster) {
        byEnrollment.set(enrollment.id, enrollment);
      }
    }
    return byEnrollment;
  }

  /**
   * The papers one candidate actually sits: their class's papers, minus
   * optional ones they did not choose.
   */
  papersForCandidate(
    enrollment: EnrollmentWithRelations,
    papers: ExamPaper[],
  ): ExamPaper[] {
    return papers.filter(
      (paper) =>
        paper.classId === enrollment.classId &&
        (!paper.isOptional || enrollment.optionalSubjectId === paper.subjectId),
    );
  }
}
