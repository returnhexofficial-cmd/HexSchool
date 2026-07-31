import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import {
  BookIssuesRepository,
  BookReservationsRepository,
} from '../repositories/circulation.repository';
import { LibraryNotificationsService } from '../services/library-notifications.service';
import { LibrarySettingsService } from '../services/library-settings.service';
import { ReservationsService } from '../services/reservations.service';

/**
 * Roadmap §4's "overdue SMS job weekly", plus the two housekeeping
 * sweeps circulation needs: lapsed holds released, ready holds
 * announced.
 *
 * It runs **daily and decides for itself whether today is the day**,
 * rather than being scheduled weekly by cron expression. `library.
 * overdue_notice_weekday` is a per-school setting, and a single cron
 * expression cannot be per-school — the M12 job convention, where the
 * schedule is coarse and the settings are what actually decide.
 *
 * The reservation sweeps run every day regardless, because a hold that
 * lapsed on Tuesday must not sit on a book until Saturday.
 *
 * Idempotency is `overdue_notified_at`, and it is a **window** rather
 * than a null check (the M12 `absent_notified_at` pattern, widened): a
 * book six weeks overdue should be chased more than once, and
 * `library.overdue_repeat_days` is how often.
 */
@Injectable()
export class LibraryOverdueJob {
  private readonly logger = new Logger(LibraryOverdueJob.name);

  constructor(
    private readonly issues: BookIssuesRepository,
    private readonly reservations: BookReservationsRepository,
    private readonly reservationsService: ReservationsService,
    private readonly notifications: LibraryNotificationsService,
    private readonly config: LibrarySettingsService,
    private readonly schools: SchoolsRepository,
  ) {}

  @Cron('20 7 * * *')
  async run(): Promise<{ chased: number; expired: number; announced: number }> {
    const schools = await this.schools.findAll();
    let chased = 0;
    let expired = 0;
    let announced = 0;
    for (const school of schools) {
      const result = await this.runForSchool(school.id);
      chased += result.chased;
      expired += result.expired;
      announced += result.announced;
    }
    return { chased, expired, announced };
  }

  /** Exposed for tests and a manual "chase overdue books now". */
  async runForSchool(
    schoolId: string,
    now = new Date(),
    force = false,
  ): Promise<{ chased: number; expired: number; announced: number }> {
    const cfg = await this.config.load(schoolId);
    if (!cfg.enabled) return { chased: 0, expired: 0, announced: 0 };

    const expired = await this.releaseLapsedHolds(schoolId, now);
    const announced = await this.announceReadyHolds(schoolId, cfg, now);

    const isTheDay =
      force || this.dhakaWeekday(now) === cfg.overdueNoticeWeekday;
    const chased =
      cfg.overdueNoticeEnabled && isTheDay
        ? await this.chaseOverdue(schoolId, cfg, now)
        : 0;

    return { chased, expired, announced };
  }

  private async chaseOverdue(
    schoolId: string,
    cfg: Awaited<ReturnType<LibrarySettingsService['load']>>,
    now: Date,
  ): Promise<number> {
    const repeatBefore = new Date(
      now.getTime() - cfg.overdueRepeatDays * 86_400_000,
    );
    const due = await this.issues.findOverdueToNotify(
      schoolId,
      now,
      repeatBefore,
    );

    let count = 0;
    for (const issue of due) {
      try {
        // Stamped BEFORE the send, the M22 rule: a crash halfway down
        // the list costs one member their reminder rather than sending
        // everybody above them a second one on the next run. For a
        // chase, under-sending once beats double-sending forever.
        await this.issues.markNotified(issue.id, now);
        if (await this.notifications.chaseOverdue(issue, cfg, now)) count++;
      } catch (error) {
        this.logger.warn(
          `Overdue chase for loan ${issue.id} failed: ${(error as Error).message}`,
        );
      }
    }
    return count;
  }

  private async releaseLapsedHolds(
    schoolId: string,
    now: Date,
  ): Promise<number> {
    try {
      return await this.reservationsService.expireLapsed(
        schoolId,
        // A machine action has no user behind it; the audit column
        // takes NULL rather than a fabricated actor (the M12 job rule).
        null as unknown as string,
        now,
      );
    } catch (error) {
      this.logger.warn(
        `Releasing lapsed holds failed: ${(error as Error).message}`,
      );
      return 0;
    }
  }

  private async announceReadyHolds(
    schoolId: string,
    cfg: Awaited<ReturnType<LibrarySettingsService['load']>>,
    now: Date,
  ): Promise<number> {
    const ready = await this.reservations.findUnnotified(schoolId);
    let count = 0;
    for (const reservation of ready) {
      try {
        await this.reservations.update(reservation.id, { notifiedAt: now });
        if (await this.notifications.announceReady(reservation, cfg)) count++;
      } catch (error) {
        this.logger.warn(
          `Hold-ready notice for reservation ${reservation.id} failed: ${(error as Error).message}`,
        );
      }
    }
    return count;
  }

  /** 0 = Sunday … 6 = Saturday, in Asia/Dhaka rather than UTC. */
  private dhakaWeekday(at: Date): number {
    const name = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Dhaka',
      weekday: 'short',
    }).format(at);
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
  }
}
