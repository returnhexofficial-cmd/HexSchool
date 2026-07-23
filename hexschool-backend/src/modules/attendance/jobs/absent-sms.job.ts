import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { parseDate } from '../../academic/calendar/date.util';
import {
  mergeByDestination,
  MergeableSend,
} from '../../communication/calc/dedupe.util';
import { NotificationService } from '../../communication/services/notification.service';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { StudentGuardiansRepository } from '../../student/repositories/student-guardians.repository';
import {
  dhakaMinutesOfDay,
  dhakaToday,
} from '../../../common/utils/clock.util';
import { StudentAttendancesRepository } from '../repositories/student-attendances.repository';
import { AttendanceSettingsService } from '../services/attendance-settings.service';

/**
 * Absent-guardian SMS (roadmap M12 §4). **Retro-wired to M17**: instead of
 * pushing a raw SMS job, it now goes through `NotificationService.send`
 * with the `ABSENT_ALERT` template — so the body is admin-editable, the
 * send is credit-accounted and logged, and quiet hours apply.
 *
 * Two absent siblings on one guardian's number are merged into a single
 * SMS (roadmap M17 §8) via `mergeByDestination` before dispatch — the
 * guardian hears about both children in one message, not two.
 *
 * Cost control (M12 §8): `absent_notified_at` is still the per-student
 * dedupe, and `attendance.absent_sms_daily_cap` bounds a runaway day.
 */
@Injectable()
export class AbsentSmsJob {
  private readonly logger = new Logger(AbsentSmsJob.name);

  constructor(
    private readonly attendances: StudentAttendancesRepository,
    private readonly studentGuardians: StudentGuardiansRepository,
    private readonly schools: SchoolsRepository,
    private readonly config: AttendanceSettingsService,
    private readonly notifications: NotificationService,
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

    // Every processed row is flagged notified — including those with no
    // guardian phone, so the 15-minute job does not re-log them all day.
    const notified: string[] = [];
    const sends: MergeableSend<string>[] = [];
    for (const row of rows) {
      notified.push(row.id);
      const phone = phoneByStudent.get(row.enrollment.studentId);
      const student = row.enrollment.student;
      if (!phone) {
        this.logger.warn(
          `No primary guardian phone for ${student.studentUid} — absent SMS skipped`,
        );
        continue;
      }
      sends.push({
        destination: phone,
        templateCode: 'ABSENT_ALERT',
        vars: {
          student_name: `${student.firstName} ${student.lastName}`.trim(),
          roll: String(row.enrollment.rollNo),
          date: today,
          school: schoolName,
        },
        ref: row.id,
      });
    }

    // Merge siblings on one number into a single SMS naming both children.
    const merged = mergeByDestination(sends, ['student_name', 'roll']);
    for (const item of merged) {
      await this.notifications.send({
        schoolId,
        code: 'ABSENT_ALERT',
        channel: 'SMS',
        recipient: { type: 'GUARDIAN', destination: item.destination },
        vars: item.vars,
      });
    }

    await this.attendances.markNotified(notified);
    this.logger.log(
      `Absent SMS: ${merged.length} message(s) for ${notified.length} student(s) on ${today}`,
    );
    return notified.length;
  }
}
