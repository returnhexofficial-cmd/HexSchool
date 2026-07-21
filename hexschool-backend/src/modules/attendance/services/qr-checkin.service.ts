import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendanceMethod,
  AttendanceStatus,
  HolidayAppliesTo,
} from '../../../common/constants';
import { parseDate } from '../../academic/calendar/date.util';
import { SectionsRepository } from '../../academic/repositories/sections.repository';
import { ShiftsRepository } from '../../academic/repositories/shifts.repository';
import { CalendarService } from '../../academic/services/calendar.service';
import { SessionsService } from '../../academic/services/sessions.service';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { EnrollmentsService } from '../../enrollment/services/enrollments.service';
import { StorageService } from '../../storage/storage.service';
import { StudentsRepository } from '../../student/repositories/students.repository';
import {
  dhakaMinutesOfDay,
  dhakaToday,
  timeColumnMinutes,
} from '../calc/clock.util';
import { QrCheckinDto } from '../dto';
import { StudentAttendancesRepository } from '../repositories/student-attendances.repository';
import { AttendanceSettingsService } from './attendance-settings.service';

export interface QrCheckinResult {
  /** False when the same card was scanned inside the dedupe window. */
  marked: boolean;
  alreadyMarked: boolean;
  status: AttendanceStatus;
  minutesLate: number;
  date: string;
  student: {
    id: string;
    studentUid: string;
    name: string;
    photoUrl: string | null;
    className: string;
    sectionName: string;
    rollNo: number;
  };
}

/**
 * QR check-in (roadmap M12 §4): a scanned `qr_token` resolves to the
 * student, their current enrollment gives the section, and the arrival
 * time decides PRESENT / LATE / HALF_DAY against the section's shift
 * start (falling back to `attendance.default_start_time`). Re-scanning
 * inside the dedupe window is idempotent, not an error — a scanner queue
 * double-fires constantly.
 */
@Injectable()
export class QrCheckinService {
  constructor(
    private readonly students: StudentsRepository,
    private readonly enrollments: EnrollmentsService,
    private readonly attendances: StudentAttendancesRepository,
    private readonly sections: SectionsRepository,
    private readonly shifts: ShiftsRepository,
    private readonly sessions: SessionsService,
    private readonly calendar: CalendarService,
    private readonly config: AttendanceSettingsService,
    private readonly storage: StorageService,
    private readonly auditContext: AuditContextService,
  ) {}

  async checkin(
    dto: QrCheckinDto,
    actor: AccessTokenPayload,
  ): Promise<QrCheckinResult> {
    const schoolId = actor.schoolId;
    const student = await this.students.findByQrToken(dto.qrToken);
    if (!student || student.schoolId !== schoolId || student.deletedAt) {
      throw new NotFoundException('Unknown or revoked QR code');
    }

    const dateString = dto.date ?? dhakaToday();
    const date = parseDate(dateString);

    const session = await this.sessions.getCurrent(schoolId);
    if (!session) {
      throw new BadRequestException(
        'No current academic session — activate one before scanning',
      );
    }
    const enrollment = await this.enrollments.getStudentCurrentEnrollment(
      student.id,
      session.id,
      schoolId,
    );
    if (!enrollment) {
      throw new BadRequestException(
        `${student.firstName} ${student.lastName} has no active enrollment in ${session.name}`,
      );
    }

    const holiday = await this.calendar.isHoliday(
      schoolId,
      date,
      HolidayAppliesTo.STUDENTS,
    );
    if (holiday.holiday) {
      throw new BadRequestException(
        `${holiday.title ?? 'This date'} is a holiday — scanning is disabled`,
      );
    }

    const config = await this.config.load(schoolId);
    const existing = await this.attendances.findForSectionDate(
      enrollment.sectionId,
      date,
      null,
    );
    const already = existing.find((row) => row.enrollmentId === enrollment.id);

    const student_ = {
      id: student.id,
      studentUid: student.studentUid,
      name: `${student.firstName} ${student.lastName}`,
      photoUrl: student.photoUrl
        ? await this.storage.getSignedUrl(student.photoUrl, 300, 'photos')
        : null,
      className: enrollment.class.name,
      sectionName: enrollment.section.name,
      rollNo: enrollment.rollNo,
    };

    if (
      already &&
      this.withinDedupeWindow(
        already.updatedAt,
        config.qrDuplicateWindowMinutes,
      )
    ) {
      return {
        marked: false,
        alreadyMarked: true,
        status: already.status,
        minutesLate: 0,
        date: dateString,
        student: student_,
      };
    }

    const startMinutes = await this.startMinutes(
      enrollment.shiftId,
      schoolId,
      config.defaultStartMinutes,
    );
    const minutesLate = Math.max(0, dhakaMinutesOfDay() - startMinutes);
    const status = this.statusFor(minutesLate, config);

    await this.attendances.upsertEntry(
      { enrollmentId: enrollment.id, date, periodId: null },
      {
        schoolId,
        sectionId: enrollment.sectionId,
        status,
        checkInTime: new Date(),
        method: AttendanceMethod.QR,
        markedBy: actor.sub,
        createdBy: actor.sub,
        updatedBy: actor.sub,
      },
    );

    this.auditContext.set({
      entityType: 'StudentAttendance',
      entityId: enrollment.id,
      newValues: {
        action: 'QR_CHECKIN',
        studentUid: student.studentUid,
        date: dateString,
        status,
        minutesLate,
      },
    });

    return {
      marked: true,
      alreadyMarked: Boolean(already),
      status,
      minutesLate,
      date: dateString,
      student: student_,
    };
  }

  // ── internals ───────────────────────────────────────────────────────

  private statusFor(
    minutesLate: number,
    config: { lateAfterMinutes: number; halfDayAfterMinutes: number },
  ): AttendanceStatus {
    if (minutesLate <= config.lateAfterMinutes) return AttendanceStatus.PRESENT;
    if (minutesLate <= config.halfDayAfterMinutes) return AttendanceStatus.LATE;
    return AttendanceStatus.HALF_DAY;
  }

  private withinDedupeWindow(markedAt: Date, windowMinutes: number): boolean {
    if (windowMinutes <= 0) return false;
    return Date.now() - markedAt.getTime() <= windowMinutes * 60_000;
  }

  /** The section's shift start time, else the school-wide setting. */
  private async startMinutes(
    shiftId: string | null,
    schoolId: string,
    fallback: number,
  ): Promise<number> {
    if (!shiftId) return fallback;
    const shift = await this.shifts.findById(shiftId, schoolId);
    return shift ? timeColumnMinutes(shift.startTime) : fallback;
  }
}
