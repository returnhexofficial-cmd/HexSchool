import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Queue } from 'bullmq';
import {
  NOTIFICATIONS_QUEUE,
  NotificationJob,
} from '../../../queues/queues.constants';
import { parseDate } from '../../academic/calendar/date.util';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { StudentGuardiansRepository } from '../../student/repositories/student-guardians.repository';
import {
  dhakaMinutesOfDay,
  dhakaToday,
} from '../../../common/utils/clock.util';
import { StudentAttendancesRepository } from '../repositories/student-attendances.repository';
import { AttendanceSettingsService } from '../services/attendance-settings.service';

/**
 * Absent-guardian SMS (roadmap M12 §4). Enqueues onto the M02
 * `notifications` queue — log-only until M17 wires the BD gateway, so
 * this job is "done" in the sense the roadmap asks for (queued now,
 * really sent later).
 *
 * Cost control (M12 §8): `absent_notified_at` on the attendance row is
 * the per-student-per-day dedupe, and `attendance.absent_sms_daily_cap`
 * bounds a runaway day (a mis-set auto-absent cutoff must not text every
 * guardian in the school twice).
 */
@Injectable()
export class AbsentSmsJob {
  private readonly logger = new Logger(AbsentSmsJob.name);

  constructor(
    private readonly attendances: StudentAttendancesRepository,
    private readonly studentGuardians: StudentGuardiansRepository,
    private readonly schools: SchoolsRepository,
    private readonly config: AttendanceSettingsService,
    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly notifications: Queue<NotificationJob>,
  ) {}

  @Cron('*/15 * * * *')
  async run(): Promise<number> {
    const schools = await this.schools.findAll();
    let total = 0;
    for (const school of schools) {
      total += await this.runForSchool(school.id, school.name);
    }
    return total;
  }

  async runForSchool(schoolId: string, schoolName: string): Promise<number> {
    const config = await this.config.load(schoolId);
    if (!config.absentSmsEnabled) return 0;
    if (dhakaMinutesOfDay() < config.absentSmsMinutes) return 0;
    if (config.absentSmsDailyCap <= 0) return 0;

    const today = dhakaToday();
    const rows = await this.attendances.findPendingAbsentNotifications(
      schoolId,
      parseDate(today),
      config.absentSmsDailyCap,
    );
    if (rows.length === 0) return 0;

    const primaries = await this.studentGuardians.findPrimaryForStudents(
      rows.map((row) => row.enrollment.studentId),
    );
    const phoneByStudent = new Map(
      primaries.map((link) => [link.studentId, link.guardian.phone]),
    );

    const notified: string[] = [];
    for (const row of rows) {
      const phone = phoneByStudent.get(row.enrollment.studentId);
      const student = row.enrollment.student;
      if (!phone) {
        this.logger.warn(
          `No primary guardian phone for ${student.studentUid} — absent SMS skipped`,
        );
        // Still flagged: without a phone, retrying every 15 minutes for
        // the rest of the day would only re-log the same warning.
        notified.push(row.id);
        continue;
      }
      await this.enqueue(
        phone,
        `${schoolName}: your child ${student.firstName} ${student.lastName} (roll ${row.enrollment.rollNo}) was absent today, ${today}.`,
      );
      notified.push(row.id);
    }

    await this.attendances.markNotified(notified);
    this.logger.log(
      `Absent SMS: ${notified.length} guardian message(s) queued for ${today}`,
    );
    return notified.length;
  }

  /** Fire-and-forget (M07 convention: delivery never blocks a mutation). */
  private async enqueue(to: string, text: string): Promise<void> {
    await this.notifications
      .add('sms', { type: 'sms', to, text })
      .catch((err: Error) =>
        this.logger.error(`Failed to enqueue absent SMS: ${err.message}`),
      );
  }
}
