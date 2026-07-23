import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { NoticesRepository } from '../repositories/notices.repository';

/**
 * Scheduled-notice publisher (roadmap M17 §4). Every few minutes, flips
 * `is_published` on notices whose `publish_at` has arrived — the reason a
 * `publish_at` in the future is allowed while `is_published` stays false.
 */
@Injectable()
export class ScheduledNoticeJob {
  private readonly logger = new Logger(ScheduledNoticeJob.name);

  constructor(
    private readonly schools: SchoolsRepository,
    private readonly notices: NoticesRepository,
  ) {}

  @Cron('*/5 * * * *')
  async run(): Promise<number> {
    const now = new Date();
    const schools = await this.schools.findAll();
    let published = 0;
    for (const school of schools) {
      const due = await this.notices.findDuePublications(school.id, now);
      for (const notice of due) {
        await this.notices.update(notice.id, { isPublished: true });
        published++;
      }
    }
    if (published > 0) {
      this.logger.log(`Scheduled publisher: ${published} notice(s) published`);
    }
    return published;
  }
}
