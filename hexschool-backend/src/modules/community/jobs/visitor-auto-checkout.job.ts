import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { dhakaMinutesOfDay } from '../../../common/utils/clock.util';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { visitsToAutoCheckout } from '../calc/visitor.engine';
import { VisitorsRepository } from '../repositories/visitors.repository';
import { CommunitySettingsService } from '../services/community-settings.service';

/**
 * Roadmap §4's "auto-checkout job at day end (flag)" and §6's "visitor
 * must checkout same day (auto-flag otherwise)".
 *
 * The gate register exists to answer "who is in the building right now",
 * and that answer must not still read "forty people" at two in the
 * morning because forty people walked out without signing the book.
 *
 * **The flag is the point, not the timestamp.** The sweep writes
 * `check_out` AND `auto_checked_out = true`, because "left at 16:40" and
 * "was still signed in when we locked up" are different facts and a
 * register that cannot tell them apart cannot be used for the one thing it
 * would ever be pulled out for. The M12 "an unmarked day is not an
 * absence" reasoning, applied to a gate.
 *
 * **A multi-day pass is exempt until its last day** — roadmap §8's
 * external invigilator is legitimately still admitted tomorrow, and
 * signing them out nightly would produce three visits where there was one
 * engagement and make the pass pointless.
 *
 * Runs **every 15 minutes** and lets each school's configured time decide,
 * the M12/M23/M24/M25 convention: one cron expression cannot be
 * per-school.
 */
@Injectable()
export class VisitorAutoCheckoutJob {
  private readonly logger = new Logger(VisitorAutoCheckoutJob.name);

  constructor(
    private readonly visitors: VisitorsRepository,
    private readonly config: CommunitySettingsService,
    private readonly schools: SchoolsRepository,
  ) {}

  @Cron('*/15 * * * *')
  async run(): Promise<{ checkedOut: number }> {
    const schools = await this.schools.findAll();
    let checkedOut = 0;
    for (const school of schools) {
      checkedOut += (await this.runForSchool(school.id)).checkedOut;
    }
    return { checkedOut };
  }

  /** Exposed for tests and a manual "close the register now". */
  async runForSchool(
    schoolId: string,
    now = new Date(),
    force = false,
  ): Promise<{ checkedOut: number }> {
    const cfg = await this.config.load(schoolId);
    if (!cfg.enabled) return { checkedOut: 0 };

    // Read in **Dhaka**, not UTC. A sweep configured for 21:00 must run at
    // the school's 21:00; comparing against a UTC clock would close the
    // register at three in the afternoon (the M25 timezone lesson).
    if (!force && dhakaMinutesOfDay(now) < cfg.visitorAutoCheckoutMinutes) {
      return { checkedOut: 0 };
    }

    const inside = await this.visitors.findInside(schoolId);
    const due = visitsToAutoCheckout(
      inside.map((visit) => ({
        id: visit.id,
        checkIn: visit.checkIn,
        validUntil: visit.validUntil,
        purpose: visit.purpose,
      })),
      now,
    );

    for (const visit of due) {
      await this.visitors.update(visit.id, {
        checkOut: now,
        autoCheckedOut: true,
      });
    }

    if (due.length > 0) {
      this.logger.log(
        `Signed out ${due.length} visitor(s) at day end for school ${schoolId} — flagged, because nobody watched them leave`,
      );
    }
    return { checkedOut: due.length };
  }
}
