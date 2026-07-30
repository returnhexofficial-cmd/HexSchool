import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { AssignmentsRepository } from '../repositories/assignments.repository';
import { SubmissionsRepository } from '../repositories/submissions.repository';
import { AssignmentNotificationsService } from '../services/assignment-notifications.service';
import { AssignmentSettingsService } from '../services/assignment-settings.service';

/**
 * Roadmap §4's "due-soon reminder job (24 h before)" and §8's
 * "zero-submission auto-close reminder to teacher after due+3d".
 *
 * Hourly rather than daily, because a reminder is only useful relative to
 * a *time* — a deadline at 18:00 with a nightly job would go out at 01:00
 * the previous night or not at all. An hourly sweep puts every student
 * inside `[hours-1, hours]` of their real deadline.
 *
 * Both passes are idempotent through a column on the row they act on
 * (`due_reminder_sent_at`, `no_submission_alert_at`) — the M12
 * `absent_notified_at` pattern. The column is stamped **before** the
 * fan-out returns rather than after, so a crash halfway through a section
 * costs the rest of that section's reminder instead of re-notifying
 * everybody who already got one on the next hour's run. For a reminder,
 * under-sending once is cheaper than double-sending forever.
 *
 * The §8 wording says "auto-close"; this deliberately **nudges the
 * teacher instead of closing the assignment itself**. Closing is what
 * locks evaluation, and a machine deciding that nobody may hand in late
 * work — three days after a deadline the teacher may well have extended
 * verbally — is a decision the school should make, not the cron.
 */
@Injectable()
export class AssignmentRemindersJob {
  private readonly logger = new Logger(AssignmentRemindersJob.name);

  constructor(
    private readonly assignments: AssignmentsRepository,
    private readonly submissions: SubmissionsRepository,
    private readonly notifications: AssignmentNotificationsService,
    private readonly config: AssignmentSettingsService,
    private readonly schools: SchoolsRepository,
  ) {}

  @Cron('10 * * * *')
  async run(): Promise<{ reminded: number; nudged: number }> {
    const schools = await this.schools.findAll();
    let reminded = 0;
    let nudged = 0;
    for (const school of schools) {
      const result = await this.runForSchool(school.id);
      reminded += result.reminded;
      nudged += result.nudged;
    }
    return { reminded, nudged };
  }

  /** Exposed for tests and a manual "send reminders now". */
  async runForSchool(
    schoolId: string,
    now = new Date(),
  ): Promise<{ reminded: number; nudged: number }> {
    const cfg = await this.config.load(schoolId);
    if (!cfg.enabled) return { reminded: 0, nudged: 0 };

    const reminded = cfg.dueReminderEnabled
      ? await this.remindDueSoon(schoolId, cfg.dueReminderHours, now)
      : 0;
    const nudged = await this.nudgeEmpty(
      schoolId,
      cfg.noSubmissionAlertDays,
      now,
    );

    return { reminded, nudged };
  }

  private async remindDueSoon(
    schoolId: string,
    hours: number,
    now: Date,
  ): Promise<number> {
    const cfg = await this.config.load(schoolId);
    const windowEnd = new Date(now.getTime() + hours * 3_600_000);
    const due = await this.assignments.findDueForReminder(
      schoolId,
      now,
      windowEnd,
    );

    let count = 0;
    for (const assignment of due) {
      try {
        // Whoever has already handed the work in is skipped. Reminding a
        // student who submitted last night is how a school teaches its
        // parents to ignore its messages.
        const submitted = await this.submissions.findForAssignment(
          assignment.id,
          schoolId,
        );
        const done = new Set(
          submitted
            .filter((s) => s.status !== 'RETURNED')
            .map((s) => s.enrollmentId),
        );

        await this.assignments.markNotified(
          assignment.id,
          'dueReminderSentAt',
          now,
        );
        count += await this.notifications.remindDueSoon(assignment, cfg, done);
      } catch (error) {
        this.logger.warn(
          `Due-soon reminder for assignment ${assignment.id} failed: ${(error as Error).message}`,
        );
      }
    }
    return count;
  }

  private async nudgeEmpty(
    schoolId: string,
    days: number,
    now: Date,
  ): Promise<number> {
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const stale = await this.assignments.findStaleWithoutSubmissions(
      schoolId,
      cutoff,
    );

    let count = 0;
    for (const assignment of stale) {
      try {
        await this.assignments.markNotified(
          assignment.id,
          'noSubmissionAlertAt',
          now,
        );
        await this.notifications.nudgeTeacher(assignment);
        count++;
      } catch (error) {
        this.logger.warn(
          `Zero-submission nudge for assignment ${assignment.id} failed: ${(error as Error).message}`,
        );
      }
    }
    return count;
  }
}
