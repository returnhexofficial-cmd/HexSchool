import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { dhakaMinutesOfDay } from '../../../common/utils/clock.util';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { AudienceRepository } from '../repositories/audience.repository';
import { CommunicationSettingsService } from '../services/communication-settings.service';
import { NotificationService } from '../services/notification.service';

/**
 * Daily birthday-wish job (roadmap M17 §4). At/after the configured time,
 * sends a `BIRTHDAY` SMS to the primary guardian of every ACTIVE student
 * whose birthday is today. Deduped per (destination, template) window so
 * the 30-minute cron cannot text twice, and gated behind
 * `communication.birthday_wish_enabled` (off by default — a school opts in).
 */
@Injectable()
export class BirthdayWishJob {
  private readonly logger = new Logger(BirthdayWishJob.name);

  constructor(
    private readonly schools: SchoolsRepository,
    private readonly audience: AudienceRepository,
    private readonly config: CommunicationSettingsService,
    private readonly notifications: NotificationService,
  ) {}

  @Cron('*/30 * * * *')
  async run(): Promise<number> {
    const schools = await this.schools.findAll();
    let total = 0;
    for (const school of schools) {
      total += await this.runForSchool(school.id, school.name);
    }
    return total;
  }

  async runForSchool(schoolId: string, schoolName: string): Promise<number> {
    const cfg = await this.config.load(schoolId);
    if (!cfg.birthdayWishEnabled) return 0;
    if (dhakaMinutesOfDay() < cfg.birthdayWishMin) return 0;

    const now = new Date();
    const month = now.getUTCMonth() + 1;
    const day = now.getUTCDate();
    const students = await this.audience.birthdaysToday(schoolId, month, day);
    if (students.length === 0) return 0;

    let sent = 0;
    for (const student of students) {
      const row = await this.notifications.send({
        schoolId,
        code: 'BIRTHDAY',
        channel: 'SMS',
        recipient: {
          type: 'GUARDIAN',
          destination: student.phone,
        },
        vars: { student_name: student.name, school: schoolName },
        dedupe: true,
      });
      if (row) sent++;
    }
    if (sent > 0) {
      this.logger.log(`Birthday wishes: ${sent} queued for ${schoolName}`);
    }
    return sent;
  }
}
