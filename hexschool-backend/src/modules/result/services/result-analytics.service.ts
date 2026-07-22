import { Injectable } from '@nestjs/common';
import { ResultStatus } from '../../../common/constants';
import { ExamsRepository } from '../../exam/repositories/exams.repository';
import { ExamsService } from '../../exam/services/exams.service';
import { round2 } from '../calc/grading-snapshot';
import { MarksRepository } from '../repositories/marks.repository';
import { ResultsRepository } from '../repositories/results.repository';
import { ResultCandidatesService } from './result-candidates.service';

export interface PassRateRow {
  id: string;
  label: string;
  candidates: number;
  passed: number;
  failed: number;
  incomplete: number;
  passRate: number;
  averageGpa: number;
}

export interface SubjectDifficultyRow {
  examSubjectId: string;
  label: string;
  subjectName: string;
  className: string;
  marksEntered: number;
  absent: number;
  averagePercentage: number;
  passRate: number;
  highest: number;
  lowest: number;
}

export interface ResultAnalytics {
  exam: { id: string; name: string };
  overall: PassRateRow;
  byClass: PassRateRow[];
  bySection: PassRateRow[];
  /** GPA histogram, bucketed by the school's own grade bands. */
  gpaDistribution: Array<{ grade: string; count: number }>;
  subjects: SubjectDifficultyRow[];
  /** Same exam type in earlier sessions — the year-over-year line. */
  comparison: Array<{
    examId: string;
    examName: string;
    sessionId: string;
    passRate: number;
    averageGpa: number;
    candidates: number;
  }>;
}

/**
 * Result analytics (roadmap M15 §4): pass rate by class/section/subject,
 * the GPA histogram, subject difficulty and a year-over-year comparison.
 *
 * Everything is derived from the STORED results and marks rather than
 * recomputed — an analytics page that disagrees with the report card it
 * summarises is worse than no analytics page. The GPA histogram buckets
 * by the school's own grade letters (which are on each result row)
 * instead of by arbitrary 0.5 bands, so it reads the way a BD school
 * talks about results: "how many A+ did we get".
 */
@Injectable()
export class ResultAnalyticsService {
  constructor(
    private readonly results: ResultsRepository,
    private readonly marks: MarksRepository,
    private readonly candidates: ResultCandidatesService,
    private readonly exams: ExamsService,
    private readonly examsRepo: ExamsRepository,
  ) {}

  async forExam(examId: string, schoolId: string): Promise<ResultAnalytics> {
    const exam = await this.exams.loadExam(examId, schoolId);
    const rows = await this.results.findForExam(examId);

    const overall = summarise('all', 'All candidates', rows);
    const byClass = group(
      rows,
      (r) => r.enrollment.classId,
      (r) => r.enrollment.class.name,
    );
    const bySection = group(
      rows,
      (r) => r.enrollment.sectionId,
      (r) => `${r.enrollment.class.name} — ${r.enrollment.section.name}`,
    );

    const gradeCounts = new Map<string, number>();
    for (const row of rows) {
      if (row.status === ResultStatus.WITHHELD) continue;
      gradeCounts.set(row.grade, (gradeCounts.get(row.grade) ?? 0) + 1);
    }

    return {
      exam: { id: exam.id, name: exam.name },
      overall,
      byClass,
      bySection,
      gpaDistribution: [...gradeCounts.entries()]
        .map(([grade, count]) => ({ grade, count }))
        .sort((a, b) => b.count - a.count),
      subjects: await this.subjectDifficulty(exam.id, exam.sessionId, schoolId),
      comparison: await this.comparison(exam, schoolId),
    };
  }

  /**
   * How hard each paper turned out to be — the number a head of
   * department actually acts on. Absent candidates are excluded from the
   * average (a hall of zeros would make every paper look impossible) but
   * reported separately.
   */
  private async subjectDifficulty(
    examId: string,
    sessionId: string,
    schoolId: string,
  ): Promise<SubjectDifficultyRow[]> {
    const papers = await this.candidates.loadPapers(
      examId,
      sessionId,
      schoolId,
    );
    const marks = await this.marks.findForExam(examId);

    const byPaper = new Map<string, typeof marks>();
    for (const mark of marks) {
      const list = byPaper.get(mark.examSubjectId) ?? [];
      list.push(mark);
      byPaper.set(mark.examSubjectId, list);
    }

    return papers
      .map((paper) => {
        const all = byPaper.get(paper.examSubjectId) ?? [];
        const present = all.filter((m) => !m.isAbsent);
        const percentages = present.map(
          (m) => (Number(m.total) / paper.fullMarks) * 100,
        );
        const passed = present.filter(
          (m) => Number(m.total) >= paper.passMarks,
        ).length;

        return {
          examSubjectId: paper.examSubjectId,
          label: `${paper.className} — ${paper.subjectName}`,
          subjectName: paper.subjectName,
          className: paper.className,
          marksEntered: all.length,
          absent: all.length - present.length,
          averagePercentage: percentages.length
            ? round2(
                percentages.reduce((sum, p) => sum + p, 0) / percentages.length,
              )
            : 0,
          passRate: present.length
            ? round2((passed / present.length) * 100)
            : 0,
          highest: percentages.length ? round2(Math.max(...percentages)) : 0,
          lowest: percentages.length ? round2(Math.min(...percentages)) : 0,
        };
      })
      .sort((a, b) => a.averagePercentage - b.averagePercentage);
  }

  /**
   * The same exam type in this school's other sessions. Comparing "Annual
   * 2026" to "Half-Yearly 2026" would be meaningless, so the comparison
   * is keyed on the exam TYPE — which is exactly what the type master
   * exists for.
   */
  private async comparison(
    exam: { id: string; examTypeId: string },
    schoolId: string,
  ): Promise<ResultAnalytics['comparison']> {
    const siblings = await this.examsRepo.findByType(
      exam.examTypeId,
      schoolId,
      exam.id,
    );

    const rows: ResultAnalytics['comparison'] = [];
    for (const sibling of siblings.slice(0, 5)) {
      const results = await this.results.findForExam(sibling.id);
      if (results.length === 0) continue;
      const summary = summarise(sibling.id, sibling.name, results);
      rows.push({
        examId: sibling.id,
        examName: sibling.name,
        sessionId: sibling.sessionId,
        passRate: summary.passRate,
        averageGpa: summary.averageGpa,
        candidates: summary.candidates,
      });
    }
    return rows;
  }
}

type Row = Awaited<ReturnType<ResultsRepository['findForExam']>>[number];

function summarise(id: string, label: string, rows: Row[]): PassRateRow {
  const counted = rows.filter((r) => r.status !== ResultStatus.WITHHELD);
  const passed = counted.filter((r) => r.status === ResultStatus.PASSED);
  const failed = counted.filter((r) => r.status === ResultStatus.FAILED).length;
  const incomplete = counted.filter(
    (r) => r.status === ResultStatus.INCOMPLETE,
  ).length;

  return {
    id,
    label,
    candidates: counted.length,
    passed: passed.length,
    failed,
    incomplete,
    passRate: counted.length
      ? round2((passed.length / counted.length) * 100)
      : 0,
    // Averaged over the students who passed: including a wall of
    // enforced 0.00s would report a school's GPA as its failure rate.
    averageGpa: passed.length
      ? round2(
          passed.reduce((sum, r) => sum + Number(r.gpa), 0) / passed.length,
        )
      : 0,
  };
}

function group(
  rows: Row[],
  key: (row: Row) => string,
  label: (row: Row) => string,
): PassRateRow[] {
  const groups = new Map<string, Row[]>();
  const labels = new Map<string, string>();
  for (const row of rows) {
    const id = key(row);
    labels.set(id, label(row));
    groups.set(id, [...(groups.get(id) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([id, list]) => summarise(id, labels.get(id) ?? id, list))
    .sort((a, b) => a.label.localeCompare(b.label));
}
