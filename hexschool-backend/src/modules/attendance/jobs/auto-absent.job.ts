import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  AttendanceMethod,
  AttendanceStatus,
  HolidayAppliesTo,
} from '../../../common/constants';
import { parseDate } from '../../academic/calendar/date.util';
import { CalendarService } from '../../academic/services/calendar.service';
import { EnrollmentsRepository } from '../../enrollment/repositories/enrollments.repository';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { dhakaMinutesOfDay, dhakaToday } from '../calc/clock.util';
import { StudentAttendancesRepository } from '../repositories/student-attendances.repository';
import { AttendanceSettingsService } from '../services/attendance-settings.service';

/**
 * Auto-absent cutoff (roadmap M12 §4, opt-in via
 * `attendance.auto_absent_enabled`): after the configured time, students
 * still unmarked in a section SOMEONE ALREADY STARTED MARKING become
 * ABSENT. Sections nobody touched are left alone — a teacher who never
 * opened the sheet must not silently absent a whole class.
 *
 * Runs every 15 minutes and compares the Dhaka clock to the setting, so
 * changing the cutoff needs no redeploy; marking is idempotent (already
 * marked students are skipped), which also makes re-runs harmless.
 */
@Injectable()
export class AutoAbsentJob {
  private readonly logger = new Logger(AutoAbsentJob.name);

  constructor(
    private readonly attendances: StudentAttendancesRepository,
    private readonly enrollments: EnrollmentsRepository,
    private readonly schools: SchoolsRepository,
    private readonly calendar: CalendarService,
    private readonly config: AttendanceSettingsService,
  ) {}

  @Cron('*/15 * * * *')
  async run(): Promise<number> {
    const schools = await this.schools.findAll();
    let total = 0;
    for (const school of schools) {
      total += await this.runForSchool(school.id);
    }
    return total;
  }

  /** Exposed for tests and for a future manual "close the day" action. */
  async runForSchool(schoolId: string): Promise<number> {
    const config = await this.config.load(schoolId);
    if (!config.autoAbsentEnabled) return 0;
    if (dhakaMinutesOfDay() < config.autoAbsentMinutes) return 0;

    const today = dhakaToday();
    const date = parseDate(today);
    const holiday = await this.calendar.isHoliday(
      schoolId,
      date,
      HolidayAppliesTo.STUDENTS,
    );
    if (holiday.holiday) return 0;

    const sectionIds = await this.attendances.findMarkedSectionIds(
      schoolId,
      date,
    );
    let marked = 0;

    for (const sectionId of sectionIds) {
      const [roster, existing] = await Promise.all([
        this.enrollments.findSectionRoster(sectionId, schoolId),
        this.attendances.findForSectionDate(sectionId, date, null),
      ]);
      const done = new Set(existing.map((row) => row.enrollmentId));

      for (const enrollment of roster) {
        if (done.has(enrollment.id)) continue;
        if (enrollment.enrollmentDate.getTime() > date.getTime()) continue;
        await this.attendances.upsertEntry(
          { enrollmentId: enrollment.id, date, periodId: null },
          {
            schoolId,
            sectionId,
            status: AttendanceStatus.ABSENT,
            method: AttendanceMethod.AUTO,
            remarks: 'Auto-marked at the attendance cutoff',
          },
        );
        marked += 1;
      }
    }

    if (marked > 0) {
      this.logger.log(
        `Auto-absent: ${marked} student(s) marked across ${sectionIds.length} section(s) on ${today}`,
      );
    }
    return marked;
  }
}
