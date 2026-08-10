import { Injectable } from '@nestjs/common';
import { ResultReportsService } from '../../../result/services/result-reports.service';
import type { ReportColumn, ReportRow, ReportTable } from '../../calc/types';
import { percent } from '../../calc/analytics.engine';
import { AnalyticsRepository } from '../../repositories/analytics.repository';
import {
  str,
  type ReportContext,
  type ReportExecutor,
  type ReportExecutorProvider,
} from '../executor.types';

/**
 * M15's tabulation sheet, and the exam-over-exam trend M29 adds.
 *
 * The tabulation is the one report whose **columns are data**: a paper is
 * a column, and which papers exist depends on the exam. So the column list
 * is built from `sheet.papers` at run time rather than declared — which is
 * exactly why `ReportTable.columns` is a value and not a type.
 *
 * `result.report-cards` is deliberately NOT here. It is a per-candidate
 * PDF booklet, not a table, and pretending otherwise would give the export
 * centre a spreadsheet nobody wants instead of the document they asked
 * for. The registry marks it `runnable: false` and the hub keeps its deep
 * link to M15's own PDF endpoint (the M18 honesty rule).
 */
@Injectable()
export class ResultReportExecutors implements ReportExecutorProvider {
  constructor(
    private readonly reports: ResultReportsService,
    private readonly analytics: AnalyticsRepository,
  ) {}

  executors(): Record<string, ReportExecutor> {
    return {
      'result.tabulation': (ctx) => this.tabulation(ctx),
      'result.trend': (ctx) => this.trend(ctx),
    };
  }

  private async tabulation(ctx: ReportContext): Promise<ReportTable> {
    const examId = str(ctx.params, 'examId');
    if (!examId) throw new Error('examId is required');
    const sheet = await this.reports.tabulation(
      examId,
      { sectionId: str(ctx.params, 'sectionId') },
      ctx.schoolId,
    );

    const paperColumns: ReportColumn[] = sheet.papers.map((paper) => ({
      key: `p${paper.examSubjectId}`,
      label: `${paper.subjectName} (${paper.fullMarks})`,
      type: 'number',
      width: 14,
    }));

    const rows: ReportRow[] = sheet.rows.map((row) => {
      const cells: ReportRow = {
        rollNo: row.rollNo,
        studentUid: row.studentUid,
        studentName: row.studentName,
        sectionName: row.sectionName,
      };
      for (const paper of sheet.papers) {
        const mark = row.marks[paper.examSubjectId];
        // Absent and "did not sit this paper" are different facts and the
        // sheet has to keep them apart: a blank is a paper the candidate
        // was never entered for, "A" is one they were entered for and
        // missed. Collapsing both to 0 turns an administrative gap into a
        // failure the student did not earn.
        cells[`p${paper.examSubjectId}`] =
          mark === null || mark === undefined
            ? ''
            : mark.absent
              ? 'A'
              : mark.obtained;
      }
      cells.totalMarks = row.totalMarks;
      cells.obtainedMarks = row.obtainedMarks;
      cells.gpa = row.gpa;
      cells.grade = row.grade;
      cells.status = row.status;
      cells.meritSection = row.meritPositionSection;
      cells.meritClass = row.meritPositionClass;
      return cells;
    });

    return {
      title: `Tabulation — ${sheet.exam.name}`,
      subtitle: `${sheet.exam.sessionName} · ${sheet.scope}`,
      columns: [
        { key: 'rollNo', label: 'Roll', type: 'number', width: 6 },
        { key: 'studentUid', label: 'Student ID', width: 16 },
        { key: 'studentName', label: 'Name', width: 28 },
        { key: 'sectionName', label: 'Section' },
        ...paperColumns,
        { key: 'obtainedMarks', label: 'Obtained', type: 'number' },
        { key: 'totalMarks', label: 'Total', type: 'number' },
        { key: 'gpa', label: 'GPA', type: 'number' },
        { key: 'grade', label: 'Grade' },
        { key: 'status', label: 'Result' },
        { key: 'meritSection', label: 'Merit (section)', type: 'number' },
        { key: 'meritClass', label: 'Merit (class)', type: 'number' },
      ],
      rows,
      summary: [
        { label: 'Candidates', value: sheet.summary.candidates },
        { label: 'Passed', value: sheet.summary.passed },
        { label: 'Failed', value: sheet.summary.failed },
        { label: 'Incomplete', value: sheet.summary.incomplete },
      ],
      notes: [
        'A blank cell is a paper the candidate was not entered for; "A" is a paper they were entered for and missed.',
      ],
    };
  }

  private async trend(ctx: ReportContext): Promise<ReportTable> {
    const rows = await this.analytics.resultSummary(
      ctx.schoolId,
      str(ctx.params, 'sessionId'),
    );
    return {
      title: 'Result trend',
      columns: [
        { key: 'examDate', label: 'Exam date', type: 'date' },
        { key: 'examName', label: 'Exam', width: 30 },
        { key: 'candidates', label: 'Candidates', type: 'number' },
        { key: 'passed', label: 'Passed', type: 'number' },
        { key: 'passRate', label: 'Pass rate', type: 'percent' },
        { key: 'avgGpa', label: 'Average GPA', type: 'number' },
        { key: 'avgPercentage', label: 'Average %', type: 'percent' },
      ],
      rows: rows.map((row) => ({
        examDate: row.examDate,
        examName: row.examName,
        candidates: row.candidates,
        passed: row.passed,
        passRate: percent(row.passed, row.candidates),
        avgGpa: row.avgGpa,
        avgPercentage: row.avgPercentage,
      })),
      notes: [
        'Published results only, WITHHELD excluded — a trend that moves when somebody’s dues are cleared is not measuring what it claims to.',
        'Served from mv_result_summary, refreshed nightly: up to 24 hours stale.',
      ],
    };
  }
}
