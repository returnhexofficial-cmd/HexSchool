import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { StudentAttendance } from '@prisma/client';
import {
  AttendanceMethod,
  AttendanceStatus,
  HolidayAppliesTo,
  PeriodSlotType,
  SessionStatus,
  UserType,
} from '../../../common/constants';
import { timeColumnMinutes } from '../../../common/utils/clock.util';
import { parseDate } from '../../academic/calendar/date.util';
import { AcademicSessionsRepository } from '../../academic/repositories/academic-sessions.repository';
import {
  SectionsRepository,
  SectionWithRelations,
} from '../../academic/repositories/sections.repository';
import { CalendarService } from '../../academic/services/calendar.service';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { EnrollmentsService } from '../../enrollment/services/enrollments.service';
import type { EnrollmentWithRelations } from '../../enrollment/repositories/enrollments.repository';
import { PermissionsService } from '../../rbac/services/permissions.service';
import { minutesLabel } from '../../timetable/calc/slot-schedule.util';
import { PeriodSlotsRepository } from '../../timetable/repositories/period-slots.repository';
import type { CurrentPeriod } from '../../timetable/services/routine.service';
import { RoutineService } from '../../timetable/services/routine.service';
import { dhakaToday } from '../../../common/utils/clock.util';
import {
  AttendanceSheetQueryDto,
  ConvertToHolidayDto,
  MarkStudentAttendanceDto,
} from '../dto';
import { StudentAttendancesRepository } from '../repositories/student-attendances.repository';
import { StudentLeaveApplicationsRepository } from '../repositories/student-leave-applications.repository';
import { AttendanceSettingsService } from './attendance-settings.service';

export interface AttendanceSheetRow {
  enrollmentId: string;
  rollNo: number;
  student: EnrollmentWithRelations['student'];
  enrollmentDate: Date;
  /** Null until the day is marked (the grid defaults these to PRESENT). */
  status: AttendanceStatus | null;
  checkInTime: Date | null;
  remarks: string | null;
  method: AttendanceMethod | null;
  /** An approved leave covers this date — the grid pre-selects LEAVE. */
  onApprovedLeave: boolean;
  /** Student joined after this date; marking is skipped for them. */
  beforeEnrollment: boolean;
}

/** The period a sheet is scoped to — null in daily mode (M13). */
export interface AttendancePeriod {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  /** Subject+teacher from the published routine, when the cell is filled. */
  subject: string | null;
  teacher: string | null;
}

export interface AttendanceSheet {
  section: { id: string; name: string; className: string; sessionId: string };
  date: string;
  /** 'period' means every row belongs to one timetable slot (M13). */
  mode: 'daily' | 'period';
  periodId: string | null;
  period: AttendancePeriod | null;
  holiday: { holiday: boolean; reason?: string; title?: string };
  /** True once at least one row exists — the UI shows its "edit" banner. */
  marked: boolean;
  editable: boolean;
  /** Why `editable` is false (future date, closed session, …). */
  lockReason?: string;
  rows: AttendanceSheetRow[];
}

export interface MarkResult {
  saved: number;
  /** Entries skipped with the reason (not on the roster, pre-enrollment). */
  skipped: Array<{ enrollmentId: string; reason: string }>;
  /** Submitted ABSENT flipped to LEAVE by an approved leave application. */
  leaveOverrides: number;
}

/**
 * Student attendance marking (roadmap M12 §4): the section+date sheet,
 * bulk upsert with re-mark semantics, the holiday guard, and the
 * convert-a-date-to-HOLIDAY admin tool. The roster always comes from the
 * M11 canonical `getSectionStudents()` and every row keys on
 * `enrollment_id`.
 */
@Injectable()
export class StudentAttendanceService {
  constructor(
    private readonly attendances: StudentAttendancesRepository,
    private readonly leaves: StudentLeaveApplicationsRepository,
    private readonly sections: SectionsRepository,
    private readonly sessions: AcademicSessionsRepository,
    private readonly enrollments: EnrollmentsService,
    private readonly calendar: CalendarService,
    private readonly config: AttendanceSettingsService,
    private readonly permissions: PermissionsService,
    private readonly auditContext: AuditContextService,
    /** M13: resolves which period a mark belongs to in period mode. */
    private readonly routines: RoutineService,
    private readonly periodSlots: PeriodSlotsRepository,
  ) {}

  // ── read ────────────────────────────────────────────────────────────

  async getSheet(
    query: AttendanceSheetQueryDto,
    actor: AccessTokenPayload,
  ): Promise<AttendanceSheet> {
    const schoolId = actor.schoolId;
    const date = parseDate(query.date);
    const section = await this.loadSection(query.sectionId, schoolId);
    const { mode, period } = await this.resolvePeriod(
      section.id,
      query.date,
      query.periodId ?? null,
      schoolId,
    );
    const periodId = period?.id ?? null;

    const [roster, existing, holiday] = await Promise.all([
      this.enrollments.getSectionStudents(section.id, schoolId),
      this.attendances.findForSectionDate(section.id, date, periodId),
      this.calendar.isHoliday(schoolId, date, HolidayAppliesTo.STUDENTS),
    ]);

    const approvedLeaves = await this.leaves.findApprovedCovering(
      roster.map((e) => e.studentId),
      date,
    );
    const onLeave = new Set(approvedLeaves.map((l) => l.studentId));
    const byEnrollment = new Map(
      existing.map((row) => [row.enrollmentId, row]),
    );

    const lock = await this.entryLock(section, date, schoolId);

    return {
      section: {
        id: section.id,
        name: section.name,
        className: section.class.name,
        sessionId: section.sessionId,
      },
      date: query.date,
      mode,
      periodId,
      period,
      holiday,
      marked: existing.length > 0,
      editable: lock === null,
      ...(lock ? { lockReason: lock } : {}),
      rows: roster.map((enrollment) => {
        const row = byEnrollment.get(enrollment.id);
        return {
          enrollmentId: enrollment.id,
          rollNo: enrollment.rollNo,
          student: enrollment.student,
          enrollmentDate: enrollment.enrollmentDate,
          status: row?.status ?? null,
          checkInTime: row?.checkInTime ?? null,
          remarks: row?.remarks ?? null,
          method: row?.method ?? null,
          onApprovedLeave: onLeave.has(enrollment.studentId),
          beforeEnrollment:
            enrollment.enrollmentDate.getTime() > date.getTime(),
        };
      }),
    };
  }

  // ── mark ────────────────────────────────────────────────────────────

  async mark(
    dto: MarkStudentAttendanceDto,
    actor: AccessTokenPayload,
  ): Promise<MarkResult> {
    const schoolId = actor.schoolId;
    const date = parseDate(dto.date);
    const section = await this.loadSection(dto.sectionId, schoolId);
    const { period } = await this.resolvePeriod(
      section.id,
      dto.date,
      dto.periodId ?? null,
      schoolId,
    );
    const periodId = period?.id ?? null;

    const lock = await this.entryLock(section, date, schoolId);
    if (lock) throw new BadRequestException(lock);

    await this.assertNotHoliday(
      schoolId,
      date,
      dto.overrideHoliday ?? false,
      actor,
      HolidayAppliesTo.STUDENTS,
    );

    const roster = await this.enrollments.getSectionStudents(
      section.id,
      schoolId,
    );
    if (roster.length === 0) {
      throw new BadRequestException(
        'This section has no enrolled students — nothing to mark',
      );
    }
    const byId = new Map(roster.map((e) => [e.id, e]));

    const existing = await this.attendances.findForSectionDate(
      section.id,
      date,
      periodId,
    );
    if (existing.length > 0) {
      await this.assertPermission(
        actor,
        'attendance.edit',
        'This date is already marked — re-marking requires attendance.edit',
      );
    }
    await this.assertWithinEditWindow(schoolId, date, actor);

    // Approved leave wins over a submitted ABSENT (roadmap M12 §6).
    const approved = await this.leaves.findApprovedCovering(
      roster.map((e) => e.studentId),
      date,
    );
    const onLeave = new Set(approved.map((l) => l.studentId));

    const skipped: MarkResult['skipped'] = [];
    let leaveOverrides = 0;
    const saved: StudentAttendance[] = [];

    await this.attendances.withTransaction(async (tx) => {
      for (const entry of dto.entries) {
        const enrollment = byId.get(entry.enrollmentId);
        if (!enrollment) {
          skipped.push({
            enrollmentId: entry.enrollmentId,
            reason: 'Not an active enrollment of this section',
          });
          continue;
        }
        if (enrollment.enrollmentDate.getTime() > date.getTime()) {
          skipped.push({
            enrollmentId: entry.enrollmentId,
            reason: 'Date is before the student joined the section',
          });
          continue;
        }

        let status = entry.status;
        if (
          status === AttendanceStatus.ABSENT &&
          onLeave.has(enrollment.studentId)
        ) {
          status = AttendanceStatus.LEAVE;
          leaveOverrides += 1;
        }

        const row = await this.attendances.upsertEntry(
          { enrollmentId: enrollment.id, date, periodId },
          {
            schoolId,
            sectionId: section.id,
            status,
            checkInTime: entry.checkInTime ? new Date(entry.checkInTime) : null,
            method: AttendanceMethod.MANUAL,
            remarks: entry.remarks ?? null,
            markedBy: actor.sub,
            createdBy: actor.sub,
            updatedBy: actor.sub,
          },
          tx,
        );
        saved.push(row);
      }
    });

    this.auditContext.set({
      entityType: 'StudentAttendance',
      entityId: section.id,
      ...(existing.length > 0
        ? { oldValues: { markedRows: existing.length } }
        : {}),
      newValues: {
        action: existing.length > 0 ? 'RE_MARK' : 'MARK',
        sectionId: section.id,
        date: dto.date,
        periodId,
        saved: saved.length,
        skipped: skipped.length,
        leaveOverrides,
      },
    });

    return { saved: saved.length, skipped, leaveOverrides };
  }

  /**
   * A government holiday announced after the day was marked: every mark
   * on that date becomes HOLIDAY, which drops it out of both sides of
   * the percentage (roadmap M12 §8).
   */
  async convertToHoliday(
    dto: ConvertToHolidayDto,
    actor: AccessTokenPayload,
  ): Promise<{ converted: number }> {
    const schoolId = actor.schoolId;
    const date = parseDate(dto.date);
    if (dto.sectionId) await this.loadSection(dto.sectionId, schoolId);

    const converted = await this.attendances.convertDateToHoliday(
      schoolId,
      date,
      dto.sectionId,
      actor.sub,
    );

    this.auditContext.set({
      entityType: 'StudentAttendance',
      entityId: dto.sectionId ?? schoolId,
      newValues: {
        action: 'CONVERT_TO_HOLIDAY',
        date: dto.date,
        sectionId: dto.sectionId ?? null,
        reason: dto.reason,
        converted,
      },
    });
    return { converted };
  }

  // ── internals ───────────────────────────────────────────────────────

  private async loadSection(
    sectionId: string,
    schoolId: string,
  ): Promise<SectionWithRelations> {
    const section = await this.sections.findDetail(sectionId, schoolId);
    if (!section) throw new NotFoundException(`Section ${sectionId} not found`);
    return section;
  }

  /**
   * Why a date may not be written (roadmap M12 §6): future dates, dates
   * outside the section's session, and COMPLETED/ARCHIVED sessions (the
   * M05 read-only rule, enforced here for the first time). Returns null
   * when entry is allowed.
   */
  private async entryLock(
    section: SectionWithRelations,
    date: Date,
    schoolId: string,
  ): Promise<string | null> {
    const today = parseDate(dhakaToday());
    if (date.getTime() > today.getTime()) {
      return 'Attendance cannot be taken for a future date';
    }

    const session = await this.sessions.findByIdOrFail(
      section.sessionId,
      schoolId,
    );
    if (
      session.status === SessionStatus.COMPLETED ||
      session.status === SessionStatus.ARCHIVED
    ) {
      return `Session ${session.name} is ${session.status} — attendance is read-only`;
    }
    if (
      date.getTime() < session.startDate.getTime() ||
      date.getTime() > session.endDate.getTime()
    ) {
      return `Date is outside session ${session.name}`;
    }
    return null;
  }

  /**
   * Which timetable period a sheet belongs to (M13 closed the M12 debt:
   * `student_attendances.period_id` now has a real FK).
   *
   * In `daily` mode the answer is always null and a supplied period is
   * refused rather than ignored — silently dropping it would file the
   * marks under the wrong identity key and the partial unique index
   * would then let a duplicate day through.
   *
   * In `period` mode an explicit period must be a CLASS slot of the
   * section's own shift; omitting it means "the period running now",
   * which is what the marking screen sends when a teacher opens it
   * mid-lesson.
   */
  private async resolvePeriod(
    sectionId: string,
    date: string,
    requested: string | null,
    schoolId: string,
  ): Promise<{ mode: 'daily' | 'period'; period: AttendancePeriod | null }> {
    const { mode } = await this.config.load(schoolId);

    if (mode === 'daily') {
      if (requested) {
        throw new BadRequestException(
          'Attendance is in daily mode — set attendance.mode to "period" before marking per period',
        );
      }
      return { mode, period: null };
    }

    const current = await this.routines.getCurrentPeriod(
      sectionId,
      { date, ...(requested ? {} : {}) },
      schoolId,
    );

    if (!requested) {
      if (!current.slot) {
        throw new BadRequestException(
          current.holiday
            ? `${current.holidayTitle ?? 'This date'} is a holiday — no period is running`
            : `No period is running at ${current.at} — pass periodId explicitly`,
        );
      }
      return { mode, period: this.toPeriod(current) };
    }

    const slots = await this.periodSlots.findByIds([requested], schoolId);
    const slot = slots[0];
    if (!slot) {
      throw new BadRequestException(`Period ${requested} not found`);
    }
    if (slot.type !== PeriodSlotType.CLASS) {
      throw new BadRequestException(
        `"${slot.name}" is a ${slot.type.toLowerCase()} slot — attendance is not taken in it`,
      );
    }
    const section = await this.loadSection(sectionId, schoolId);
    if (section.shiftId && slot.shiftId !== section.shiftId) {
      throw new BadRequestException(
        `"${slot.name}" belongs to another shift's bell schedule`,
      );
    }

    // Enrich with the routine cell when the asked-for period happens to
    // be the one running — otherwise subject/teacher stay null rather
    // than being guessed.
    const cell =
      current.slot?.id === requested && current.cell ? current.cell : null;
    return {
      mode,
      period: {
        id: slot.id,
        name: slot.name,
        startTime: minutesLabel(timeColumnMinutes(slot.startTime)),
        endTime: minutesLabel(timeColumnMinutes(slot.endTime)),
        subject: cell?.subject.name ?? null,
        teacher: cell?.teacher.name ?? null,
      },
    };
  }

  private toPeriod(current: CurrentPeriod): AttendancePeriod {
    const slot = current.slot!;
    return {
      id: slot.id,
      name: slot.name,
      startTime: slot.startTime,
      endTime: slot.endTime,
      subject: current.cell?.subject.name ?? null,
      teacher: current.cell?.teacher.name ?? null,
    };
  }

  /** Holiday guard — override needs `attendance.holiday.override`. */
  private async assertNotHoliday(
    schoolId: string,
    date: Date,
    override: boolean,
    actor: AccessTokenPayload,
    appliesTo: HolidayAppliesTo,
  ): Promise<void> {
    const holiday = await this.calendar.isHoliday(schoolId, date, appliesTo);
    if (!holiday.holiday) return;
    if (!override) {
      throw new BadRequestException(
        `${holiday.title ?? 'This date'} is a holiday — pass overrideHoliday=true (requires attendance.holiday.override)`,
      );
    }
    await this.assertPermission(
      actor,
      'attendance.holiday.override',
      'Marking attendance on a holiday requires attendance.holiday.override',
    );
  }

  /** Editing older than `attendance.edit_window_days` is elevated. */
  private async assertWithinEditWindow(
    schoolId: string,
    date: Date,
    actor: AccessTokenPayload,
  ): Promise<void> {
    const { editWindowDays } = await this.config.load(schoolId);
    if (editWindowDays <= 0) return;
    const today = parseDate(dhakaToday());
    const ageDays = Math.floor((today.getTime() - date.getTime()) / 86_400_000);
    if (ageDays <= editWindowDays) return;
    await this.assertPermission(
      actor,
      'attendance.edit.past',
      `Attendance older than ${editWindowDays} day(s) requires attendance.edit.past`,
    );
  }

  /**
   * Runtime permission check (M08 convention): the same route serves the
   * normal and the elevated case, so the check lives here rather than in
   * a route decorator. Super Admin bypasses, as in the guard.
   */
  private async assertPermission(
    actor: AccessTokenPayload,
    code: string,
    message: string,
  ): Promise<void> {
    if (actor.userType === UserType.SUPER_ADMIN) return;
    const codes = await this.permissions.getUserPermissionCodes(actor.sub);
    if (!codes.includes(code)) throw new ForbiddenException(message);
  }
}
