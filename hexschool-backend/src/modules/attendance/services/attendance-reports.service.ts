import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { StudentAttendance } from '@prisma/client';
import {
  AttendancePersonType,
  AttendanceStatus,
  HolidayAppliesTo,
} from '../../../common/constants';
import { isoDate, parseDate } from '../../academic/calendar/date.util';
import { AcademicSessionsRepository } from '../../academic/repositories/academic-sessions.repository';
import { SectionsRepository } from '../../academic/repositories/sections.repository';
import { CalendarService } from '../../academic/services/calendar.service';
import { EnrollmentsRepository } from '../../enrollment/repositories/enrollments.repository';
import { StudentsRepository } from '../../student/repositories/students.repository';
import {
  AttendanceCounts,
  AttendanceSummary,
  countByStatus,
  emptyCounts,
  round2,
  summarize,
} from '../calc/percentage.util';
import {
  DailyReportQueryDto,
  LateAnalysisQueryDto,
  MonthlyReportQueryDto,
  StaffReportQueryDto,
  StudentReportQueryDto,
  SummaryReportQueryDto,
} from '../dto';
import { EmployeeDirectoryRepository } from '../repositories/employee-directory.repository';
import { StaffAttendancesRepository } from '../repositories/staff-attendances.repository';
import { StudentAttendancesRepository } from '../repositories/student-attendances.repository';

export interface SectionDailyRow {
  sectionId: string;
  sectionName: string;
  className: string;
  enrolled: number;
  marked: number;
  counts: AttendanceCounts;
  percentage: number;
}

export interface DailyReport {
  date: string;
  holiday: { holiday: boolean; reason?: string; title?: string };
  sections: SectionDailyRow[];
  totals: {
    enrolled: number;
    marked: number;
    counts: AttendanceCounts;
    percentage: number;
  };
  /** Present only when a single section was requested (the daily sheet). */
  students?: Array<{
    rollNo: number;
    studentUid: string;
    name: string;
    status: AttendanceStatus | null;
    remarks: string | null;
  }>;
}

export interface MonthlyRegister {
  section: { id: string; name: string; className: string };
  month: string;
  /** Working days of the month (holidays + weekly off-days removed). */
  days: string[];
  rows: Array<{
    enrollmentId: string;
    rollNo: number;
    studentUid: string;
    name: string;
    marks: Record<string, AttendanceStatus>;
    summary: AttendanceSummary;
  }>;
}

export interface StudentAttendanceReport {
  student: { id: string; studentUid: string; name: string };
  from: string;
  to: string;
  summary: AttendanceSummary;
  /** One block per section the student sat in (mid-year transfers). */
  bySection: Array<{
    sectionId: string;
    sectionName: string;
    className: string;
    counts: AttendanceCounts;
    percentage: number;
  }>;
  entries: Array<{
    date: string;
    status: AttendanceStatus;
    sectionName: string;
    remarks: string | null;
  }>;
}

export interface StaffMonthlyReport {
  month: string;
  days: string[];
  rows: Array<{
    personType: AttendancePersonType;
    personId: string;
    employeeId: string;
    name: string;
    marks: Record<string, AttendanceStatus>;
    summary: AttendanceSummary;
  }>;
}

export interface AttendanceSummaryReport {
  from: string;
  to: string;
  workingDays: number;
  overall: AttendanceSummary;
  sections: SectionDailyRow[];
  /** Daily present-percentage series for the trend chart. */
  trend: Array<{ date: string; percentage: number }>;
}

export interface LateAnalysisReport {
  month: string;
  threshold: number;
  rows: Array<{
    studentUid: string;
    name: string;
    sectionName: string;
    lateDays: number;
    dates: string[];
    flagged: boolean;
  }>;
}

/**
 * Read-only attendance analytics (roadmap M12 §4). Every percentage runs
 * through the pure engine in `calc/percentage.util.ts`; the denominators
 * come from `CalendarService.workingDays()` so holidays and weekly
 * off-days never count, and each student's window starts at their
 * enrollment date.
 */
@Injectable()
export class AttendanceReportsService {
  constructor(
    private readonly attendances: StudentAttendancesRepository,
    private readonly staffAttendances: StaffAttendancesRepository,
    private readonly directory: EmployeeDirectoryRepository,
    private readonly enrollments: EnrollmentsRepository,
    private readonly sections: SectionsRepository,
    private readonly sessions: AcademicSessionsRepository,
    private readonly students: StudentsRepository,
    private readonly calendar: CalendarService,
  ) {}

  // ── daily ───────────────────────────────────────────────────────────

  async daily(
    query: DailyReportQueryDto,
    schoolId: string,
  ): Promise<DailyReport> {
    const date = parseDate(query.date);
    // A section fixes its own session — only the school-wide roll-up
    // needs one resolved (and may then demand an explicit sessionId).
    const sessionId = query.sectionId
      ? null
      : await this.resolveSessionId(query.sessionId, schoolId);

    const [holiday, sections] = await Promise.all([
      this.calendar.isHoliday(schoolId, date, HolidayAppliesTo.STUDENTS),
      query.sectionId
        ? this.sections
            .findDetail(query.sectionId, schoolId)
            .then((s) => (s ? [s] : []))
        : this.sections.findForSessionWithRelations(schoolId, sessionId!),
    ]);
    if (sections.length === 0) {
      throw new NotFoundException('No matching section for this report');
    }

    const rows = await this.attendances.findInRange(schoolId, date, date, {
      ...(query.sectionId
        ? { sectionId: query.sectionId }
        : { sessionId: sessionId! }),
    });
    const bySection = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = bySection.get(row.sectionId) ?? [];
      list.push(row);
      bySection.set(row.sectionId, list);
    }

    const sectionRows: SectionDailyRow[] = [];
    for (const section of sections) {
      const roster = await this.enrollments.findSectionRoster(
        section.id,
        schoolId,
      );
      const marks = bySection.get(section.id) ?? [];
      const counts = countByStatus(marks);
      sectionRows.push({
        sectionId: section.id,
        sectionName: section.name,
        className: section.class.name,
        enrolled: roster.length,
        marked: marks.length,
        counts,
        percentage: this.dayPercentage(counts),
      });
    }

    const totals = sectionRows.reduce(
      (acc, row) => {
        acc.enrolled += row.enrolled;
        acc.marked += row.marked;
        for (const status of Object.keys(row.counts) as AttendanceStatus[]) {
          acc.counts[status] += row.counts[status];
        }
        return acc;
      },
      { enrolled: 0, marked: 0, counts: emptyCounts(), percentage: 0 },
    );
    totals.percentage = this.dayPercentage(totals.counts);

    const single = query.sectionId
      ? (bySection.get(query.sectionId) ?? [])
      : null;
    return {
      date: query.date,
      holiday,
      sections: sectionRows,
      totals,
      ...(single
        ? {
            students: single
              .map((row) => ({
                rollNo: row.enrollment.rollNo,
                studentUid: row.enrollment.student.studentUid,
                name: `${row.enrollment.student.firstName} ${row.enrollment.student.lastName}`,
                status: row.status,
                remarks: row.remarks,
              }))
              .sort((a, b) => a.rollNo - b.rollNo),
          }
        : {}),
    };
  }

  // ── monthly register ────────────────────────────────────────────────

  async monthly(
    query: MonthlyReportQueryDto,
    schoolId: string,
  ): Promise<MonthlyRegister> {
    const section = await this.sections.findDetail(query.sectionId, schoolId);
    if (!section) {
      throw new NotFoundException(`Section ${query.sectionId} not found`);
    }
    const { from, to } = this.monthRange(query.month);

    const [days, roster, marks] = await Promise.all([
      this.calendar.workingDays(schoolId, from, to, HolidayAppliesTo.STUDENTS),
      this.enrollments.findSectionRoster(section.id, schoolId),
      this.attendances.findInRange(schoolId, from, to, {
        sectionId: section.id,
      }),
    ]);

    const byEnrollment = new Map<string, StudentAttendance[]>();
    for (const row of marks) {
      const list = byEnrollment.get(row.enrollmentId) ?? [];
      list.push(row);
      byEnrollment.set(row.enrollmentId, list);
    }

    return {
      section: {
        id: section.id,
        name: section.name,
        className: section.class.name,
      },
      month: query.month,
      days,
      rows: roster.map((enrollment) => {
        const rows = byEnrollment.get(enrollment.id) ?? [];
        const marksByDate: Record<string, AttendanceStatus> = {};
        for (const row of rows) marksByDate[isoDate(row.date)] = row.status;
        return {
          enrollmentId: enrollment.id,
          rollNo: enrollment.rollNo,
          studentUid: enrollment.student.studentUid,
          name: `${enrollment.student.firstName} ${enrollment.student.lastName}`,
          marks: marksByDate,
          summary: summarize(
            countByStatus(rows),
            this.eligibleDays(days, enrollment.enrollmentDate),
          ),
        };
      }),
    };
  }

  // ── per student ─────────────────────────────────────────────────────

  async student(
    studentId: string,
    query: StudentReportQueryDto,
    schoolId: string,
  ): Promise<StudentAttendanceReport> {
    const student = await this.students.findByIdOrFail(studentId, schoolId);
    const sessionId = await this.resolveSessionId(query.sessionId, schoolId);
    const session = await this.sessions.findByIdOrFail(sessionId, schoolId);

    const from = query.from ? parseDate(query.from) : session.startDate;
    const to = query.to
      ? parseDate(query.to)
      : this.min(session.endDate, new Date());

    // Every enrollment in the window — transfers split the report.
    const enrollments = await this.enrollments.findAll(
      { studentId, sessionId },
      schoolId,
    );
    const [days, rows] = await Promise.all([
      this.calendar.workingDays(schoolId, from, to, HolidayAppliesTo.STUDENTS),
      this.attendances.findInRange(schoolId, from, to, {
        enrollmentIds: enrollments.map((e) => e.id),
      }),
    ]);

    const earliestJoin = enrollments.reduce<Date | null>(
      (min, e) =>
        min === null || e.enrollmentDate.getTime() < min.getTime()
          ? e.enrollmentDate
          : min,
      null,
    );

    const bySection = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = bySection.get(row.sectionId) ?? [];
      list.push(row);
      bySection.set(row.sectionId, list);
    }

    const sectionBlocks = await Promise.all(
      [...bySection.entries()].map(async ([sectionId, sectionRows]) => {
        const section = await this.sections.findDetail(sectionId, schoolId);
        const counts = countByStatus(sectionRows);
        return {
          sectionId,
          sectionName: section?.name ?? '—',
          className: section?.class.name ?? '—',
          counts,
          percentage: this.dayPercentage(counts),
        };
      }),
    );
    const sectionNames = new Map(
      sectionBlocks.map((b) => [b.sectionId, b.sectionName]),
    );

    return {
      student: {
        id: student.id,
        studentUid: student.studentUid,
        name: `${student.firstName} ${student.lastName}`,
      },
      from: isoDate(from),
      to: isoDate(to),
      summary: summarize(
        countByStatus(rows),
        this.eligibleDays(days, earliestJoin),
      ),
      bySection: sectionBlocks,
      entries: rows.map((row) => ({
        date: isoDate(row.date),
        status: row.status,
        sectionName: sectionNames.get(row.sectionId) ?? '—',
        remarks: row.remarks,
      })),
    };
  }

  // ── staff ───────────────────────────────────────────────────────────

  async staff(
    query: StaffReportQueryDto,
    schoolId: string,
  ): Promise<StaffMonthlyReport> {
    const { from, to } = this.monthRange(query.month);
    const [days, people, rows] = await Promise.all([
      this.calendar.workingDays(schoolId, from, to, HolidayAppliesTo.STAFF),
      this.directory.findMarkable(schoolId, query.personType),
      this.staffAttendances.findInRange(schoolId, from, to, query.personType),
    ]);

    const byPerson = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = `${row.personType}:${row.personId}`;
      const list = byPerson.get(key) ?? [];
      list.push(row);
      byPerson.set(key, list);
    }

    return {
      month: query.month,
      days,
      rows: people.map((person) => {
        const personRows =
          byPerson.get(`${person.personType}:${person.personId}`) ?? [];
        const marks: Record<string, AttendanceStatus> = {};
        for (const row of personRows) marks[isoDate(row.date)] = row.status;
        return {
          personType: person.personType,
          personId: person.personId,
          employeeId: person.employeeId,
          name: person.name,
          marks,
          summary: summarize(countByStatus(personRows), days.length),
        };
      }),
    };
  }

  // ── session summary + trend ─────────────────────────────────────────

  async summary(
    query: SummaryReportQueryDto,
    schoolId: string,
  ): Promise<AttendanceSummaryReport> {
    const sessionId = await this.resolveSessionId(query.sessionId, schoolId);
    const session = await this.sessions.findByIdOrFail(sessionId, schoolId);
    const from = query.from ? parseDate(query.from) : session.startDate;
    const to = query.to
      ? parseDate(query.to)
      : this.min(session.endDate, new Date());

    const [days, sections, rows] = await Promise.all([
      this.calendar.workingDays(schoolId, from, to, HolidayAppliesTo.STUDENTS),
      this.sections.findForSessionWithRelations(
        schoolId,
        sessionId,
        query.classId,
      ),
      this.attendances.findInRange(schoolId, from, to, {
        sessionId,
        ...(query.classId ? { classId: query.classId } : {}),
      }),
    ]);

    const bySection = new Map<string, typeof rows>();
    const byDate = new Map<string, typeof rows>();
    for (const row of rows) {
      const sectionList = bySection.get(row.sectionId) ?? [];
      sectionList.push(row);
      bySection.set(row.sectionId, sectionList);

      const key = isoDate(row.date);
      const dateList = byDate.get(key) ?? [];
      dateList.push(row);
      byDate.set(key, dateList);
    }

    const sectionRows: SectionDailyRow[] = [];
    for (const section of sections) {
      const roster = await this.enrollments.findSectionRoster(
        section.id,
        schoolId,
      );
      const marks = bySection.get(section.id) ?? [];
      const counts = countByStatus(marks);
      sectionRows.push({
        sectionId: section.id,
        sectionName: section.name,
        className: section.class.name,
        enrolled: roster.length,
        marked: marks.length,
        counts,
        percentage: this.dayPercentage(counts),
      });
    }

    return {
      from: isoDate(from),
      to: isoDate(to),
      workingDays: days.length,
      overall: summarize(countByStatus(rows), days.length),
      sections: sectionRows,
      trend: days.map((date) => ({
        date,
        percentage: this.dayPercentage(countByStatus(byDate.get(date) ?? [])),
      })),
    };
  }

  // ── late analysis ───────────────────────────────────────────────────

  async lateAnalysis(
    query: LateAnalysisQueryDto,
    schoolId: string,
    threshold: number,
  ): Promise<LateAnalysisReport> {
    const { from, to } = this.monthRange(query.month);
    const rows = await this.attendances.findInRange(
      schoolId,
      from,
      to,
      query.sectionId
        ? { sectionId: query.sectionId }
        : {
            sessionId: await this.resolveSessionId(query.sessionId, schoolId),
          },
    );

    const late = rows.filter((row) => row.status === AttendanceStatus.LATE);
    const byStudent = new Map<string, typeof late>();
    for (const row of late) {
      const key = row.enrollment.studentId;
      const list = byStudent.get(key) ?? [];
      list.push(row);
      byStudent.set(key, list);
    }

    const sectionNames = new Map<string, string>();
    for (const sectionId of new Set(late.map((r) => r.sectionId))) {
      const section = await this.sections.findDetail(sectionId, schoolId);
      sectionNames.set(sectionId, section ? section.name : '—');
    }

    return {
      month: query.month,
      threshold,
      rows: [...byStudent.values()]
        .map((studentRows) => {
          const first = studentRows[0];
          return {
            studentUid: first.enrollment.student.studentUid,
            name: `${first.enrollment.student.firstName} ${first.enrollment.student.lastName}`,
            sectionName: sectionNames.get(first.sectionId) ?? '—',
            lateDays: studentRows.length,
            dates: studentRows.map((row) => isoDate(row.date)).sort(),
            flagged: studentRows.length >= threshold,
          };
        })
        .sort((a, b) => b.lateDays - a.lateDays),
    };
  }

  // ── internals ───────────────────────────────────────────────────────

  /** Share of the day's marks that count as attended (present + late + ½). */
  private dayPercentage(counts: AttendanceCounts): number {
    const denominator =
      counts[AttendanceStatus.PRESENT] +
      counts[AttendanceStatus.ABSENT] +
      counts[AttendanceStatus.LATE] +
      counts[AttendanceStatus.LEAVE] +
      counts[AttendanceStatus.HALF_DAY];
    if (denominator === 0) return 0;
    const attended =
      counts[AttendanceStatus.PRESENT] +
      counts[AttendanceStatus.LATE] +
      counts[AttendanceStatus.HALF_DAY] * 0.5;
    return round2((attended / denominator) * 100);
  }

  /** Working days on or after the student's join date (M12 §6). */
  private eligibleDays(days: string[], enrolledFrom: Date | null): number {
    if (!enrolledFrom) return days.length;
    const joined = isoDate(enrolledFrom);
    return days.filter((day) => day >= joined).length;
  }

  private monthRange(month: string): { from: Date; to: Date } {
    const [year, monthNo] = month.split('-').map(Number);
    if (!year || !monthNo || monthNo < 1 || monthNo > 12) {
      throw new BadRequestException(`"${month}" is not a valid YYYY-MM month`);
    }
    return {
      from: new Date(Date.UTC(year, monthNo - 1, 1)),
      to: new Date(Date.UTC(year, monthNo, 0)),
    };
  }

  private async resolveSessionId(
    sessionId: string | undefined,
    schoolId: string,
  ): Promise<string> {
    if (sessionId) return sessionId;
    const current = await this.sessions.findCurrent(schoolId);
    if (!current) {
      throw new BadRequestException(
        'No current academic session — pass sessionId explicitly',
      );
    }
    return current.id;
  }

  private min(a: Date, b: Date): Date {
    return a.getTime() <= b.getTime() ? a : b;
  }
}
