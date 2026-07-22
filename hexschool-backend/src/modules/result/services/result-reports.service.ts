import { Injectable, NotFoundException } from '@nestjs/common';
import { ResultStatus } from '../../../common/constants';
import { isoDate } from '../../academic/calendar/date.util';
import {
  countByStatus,
  presentEquivalent,
} from '../../attendance/calc/percentage.util';
import { StudentAttendancesRepository } from '../../attendance/repositories/student-attendances.repository';
import { ExamsService } from '../../exam/services/exams.service';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { round2 } from '../calc/grading-snapshot';
import { ResultExportQueryDto, TranscriptQueryDto } from '../dto';
import { ResultsRepository } from '../repositories/results.repository';
import { ResultSettingsService } from './result-settings.service';
import { ResultDetail, ResultsService } from './results.service';
import {
  ExamPaper,
  ResultCandidatesService,
} from './result-candidates.service';

export interface TabulationRow {
  enrollmentId: string;
  rollNo: number;
  studentUid: string;
  studentName: string;
  sectionName: string;
  /** Marks per paper, keyed by `examSubjectId`; null = did not sit it. */
  marks: Record<
    string,
    { obtained: number; grade: string; absent: boolean } | null
  >;
  totalMarks: number;
  obtainedMarks: number;
  gpa: number;
  grade: string;
  status: ResultStatus;
  meritPositionSection: number | null;
  meritPositionClass: number | null;
}

export interface TabulationSheet {
  exam: { id: string; name: string; sessionName: string };
  scope: string;
  papers: Array<{
    examSubjectId: string;
    subjectName: string;
    fullMarks: number;
  }>;
  rows: TabulationRow[];
  summary: {
    candidates: number;
    passed: number;
    failed: number;
    incomplete: number;
  };
}

export interface ReportCard {
  school: { name: string; nameBn: string | null; address: string | null };
  exam: { id: string; name: string; sessionName: string; startDate: string };
  student: {
    name: string;
    uid: string;
    rollNo: number;
    className: string;
    sectionName: string;
    photoUrl: string | null;
  };
  subjects: ResultDetail['subjects'];
  summary: {
    totalMarks: number;
    obtainedMarks: number;
    percentage: number;
    gpa: number;
    gpaWithoutOptional: number;
    grade: string;
    status: ResultStatus;
    failedSubjects: number;
    meritPositionSection: number | null;
    meritPositionClass: number | null;
  };
  attendance: { percentage: number; markedDays: number } | null;
  footer: string;
}

export interface Transcript {
  school: { name: string };
  student: { name: string; uid: string };
  exams: Array<{
    examId: string;
    examName: string;
    sessionName: string;
    className: string;
    rollNo: number;
    gpa: number;
    grade: string;
    status: ResultStatus;
    obtainedMarks: number;
    totalMarks: number;
    meritPositionClass: number | null;
  }>;
}

/**
 * The report SHAPES the UI and the file renderers both consume — kept
 * separate from `ResultExportService`, which is pure presentation over
 * them (the M12 reports/exports split). Changing an XLSX column layout
 * must not be able to change what an API returns.
 *
 * Nothing here recomputes a grade: the numbers come from the processing
 * run's `results` and `marks` rows, so a report card, the portal and the
 * tabulation sheet cannot drift apart.
 */
@Injectable()
export class ResultReportsService {
  constructor(
    private readonly results: ResultsRepository,
    private readonly resultsService: ResultsService,
    private readonly candidates: ResultCandidatesService,
    private readonly attendances: StudentAttendancesRepository,
    private readonly schools: SchoolsRepository,
    private readonly exams: ExamsService,
    private readonly config: ResultSettingsService,
  ) {}

  /**
   * The full section (or class) matrix a controller of examinations
   * checks before publication: one row per candidate, one column per
   * paper, plus totals and merit.
   */
  async tabulation(
    examId: string,
    query: ResultExportQueryDto,
    schoolId: string,
  ): Promise<TabulationSheet> {
    const exam = await this.exams.loadExam(examId, schoolId);
    const rows = await this.results.findForExam(examId, {
      classId: query.classId,
      sectionId: query.sectionId,
    });

    const allPapers = await this.candidates.loadPapers(
      exam.id,
      exam.sessionId,
      schoolId,
    );
    // Columns are the papers of the classes actually in scope — a
    // whole-exam sheet spanning five classes would be unreadable, and a
    // class's own sheet must not carry another class's subjects.
    const classIds = new Set(rows.map((r) => r.enrollment.classId));
    const papers: ExamPaper[] = allPapers.filter((p) =>
      classIds.has(p.classId),
    );

    const marksByCandidate = new Map<
      string,
      Map<string, { obtained: number; grade: string; absent: boolean }>
    >();
    for (const result of rows) {
      const detail = await this.resultsService.detail(result, schoolId);
      marksByCandidate.set(
        result.enrollmentId,
        new Map(
          detail.subjects.map((s) => [
            s.examSubjectId,
            { obtained: s.obtained, grade: s.grade, absent: s.isAbsent },
          ]),
        ),
      );
    }

    const tabulated: TabulationRow[] = rows.map((result) => {
      const theirs = marksByCandidate.get(result.enrollmentId) ?? new Map();
      return {
        enrollmentId: result.enrollmentId,
        rollNo: result.enrollment.rollNo,
        studentUid: result.enrollment.student.studentUid,
        studentName:
          `${result.enrollment.student.firstName} ${result.enrollment.student.lastName}`.trim(),
        sectionName: result.enrollment.section.name,
        marks: Object.fromEntries(
          papers.map((p) => [
            p.examSubjectId,
            theirs.get(p.examSubjectId) ?? null,
          ]),
        ),
        totalMarks: Number(result.totalMarks),
        obtainedMarks: Number(result.obtainedMarks),
        gpa: Number(result.gpa),
        grade: result.grade,
        status: result.status,
        meritPositionSection: result.meritPositionSection,
        meritPositionClass: result.meritPositionClass,
      };
    });

    return {
      exam: { id: exam.id, name: exam.name, sessionName: exam.session.name },
      scope: scopeLabel(rows),
      papers: papers.map((p) => ({
        examSubjectId: p.examSubjectId,
        subjectName: p.subjectName,
        fullMarks: p.fullMarks,
      })),
      rows: tabulated,
      summary: {
        candidates: tabulated.length,
        passed: tabulated.filter((r) => r.status === ResultStatus.PASSED)
          .length,
        failed: tabulated.filter((r) => r.status === ResultStatus.FAILED)
          .length,
        incomplete: tabulated.filter(
          (r) => r.status === ResultStatus.INCOMPLETE,
        ).length,
      },
    };
  }

  /** One card per candidate in scope — the batch the office prints. */
  async reportCards(
    examId: string,
    query: ResultExportQueryDto,
    schoolId: string,
  ): Promise<ReportCard[]> {
    const exam = await this.exams.loadExam(examId, schoolId);
    const rows = await this.results.findForExam(examId, {
      classId: query.classId,
      sectionId: query.sectionId,
    });
    const scoped = query.enrollmentId
      ? rows.filter((r) => r.enrollmentId === query.enrollmentId)
      : rows;

    if (scoped.length === 0) {
      throw new NotFoundException(
        'No processed results match that scope — process the exam first',
      );
    }

    const [school, config] = await Promise.all([
      this.schools.findById(schoolId),
      this.config.load(schoolId),
    ]);

    const cards: ReportCard[] = [];
    for (const result of scoped) {
      const detail = await this.resultsService.detail(result, schoolId);
      const attendance = config.reportCardShowAttendance
        ? await this.attendanceFor(result.enrollmentId)
        : null;

      cards.push({
        school: {
          name: school?.name ?? 'School',
          nameBn: school?.nameBn ?? null,
          address: school?.address ?? null,
        },
        exam: {
          id: exam.id,
          name: exam.name,
          sessionName: exam.session.name,
          startDate: isoDate(exam.startDate),
        },
        student: {
          name: `${result.enrollment.student.firstName} ${result.enrollment.student.lastName}`.trim(),
          uid: result.enrollment.student.studentUid,
          rollNo: result.enrollment.rollNo,
          className: result.enrollment.class.name,
          sectionName: result.enrollment.section.name,
          photoUrl: result.enrollment.student.photoUrl,
        },
        subjects: detail.subjects,
        summary: {
          totalMarks: Number(result.totalMarks),
          obtainedMarks: Number(result.obtainedMarks),
          percentage:
            Number(result.totalMarks) > 0
              ? round2(
                  (Number(result.obtainedMarks) / Number(result.totalMarks)) *
                    100,
                )
              : 0,
          gpa: Number(result.gpa),
          gpaWithoutOptional: Number(result.gpaWithoutOptional),
          grade: result.grade,
          status: result.status,
          failedSubjects: result.failedSubjects,
          meritPositionSection: result.meritPositionSection,
          meritPositionClass: result.meritPositionClass,
        },
        attendance,
        footer: config.reportCardFooter,
      });
    }
    return cards;
  }

  /** Every exam a student sat, oldest first — the multi-exam transcript. */
  async transcript(
    studentId: string,
    query: TranscriptQueryDto,
    schoolId: string,
  ): Promise<Transcript> {
    const rows = await this.resultsService.transcript(
      studentId,
      query,
      schoolId,
    );
    if (rows.length === 0) {
      throw new NotFoundException('This student has no processed results yet');
    }
    const school = await this.schools.findById(schoolId);

    return {
      school: { name: school?.name ?? 'School' },
      student: {
        name: `${rows[0].enrollment.student.firstName} ${rows[0].enrollment.student.lastName}`.trim(),
        uid: rows[0].enrollment.student.studentUid,
      },
      exams: rows.map((row) => ({
        examId: row.examId,
        examName: row.exam.name,
        sessionName: '',
        className: row.enrollment.class.name,
        rollNo: row.enrollment.rollNo,
        gpa: Number(row.gpa),
        grade: row.grade,
        status: row.status,
        obtainedMarks: Number(row.obtainedMarks),
        totalMarks: Number(row.totalMarks),
        meritPositionClass: row.meritPositionClass,
      })),
    };
  }

  /**
   * Attendance for the report card. Read through the re-provisioned M12
   * repository and the shared pure engine — importing AttendanceModule
   * would be the wrong dependency for one percentage.
   */
  private async attendanceFor(
    enrollmentId: string,
  ): Promise<{ percentage: number; markedDays: number } | null> {
    const rows = await this.attendances.findForEnrollments(
      [enrollmentId],
      new Date(Date.UTC(1970, 0, 1)),
      new Date(Date.UTC(2999, 11, 31)),
    );
    if (rows.length === 0) return null;

    const counts = countByStatus(rows);
    const marked = rows.length - counts.HOLIDAY;
    return {
      markedDays: marked,
      percentage:
        marked === 0 ? 0 : round2((presentEquivalent(counts) / marked) * 100),
    };
  }
}

type Row = Awaited<ReturnType<ResultsRepository['findForExam']>>[number];

function scopeLabel(rows: Row[]): string {
  if (rows.length === 0) return 'No candidates';
  const classes = new Set(rows.map((r) => r.enrollment.class.name));
  const sections = new Set(rows.map((r) => r.enrollment.section.name));
  const classLabel = [...classes].join(', ');
  return sections.size === 1
    ? `${classLabel} — Section ${[...sections][0]}`
    : classLabel;
}
