import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { dhakaToday } from '../../../common/utils/clock.util';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { InventoryNotificationsService } from '../services/inventory-notifications.service';
import { InventorySettingsService } from '../services/inventory-settings.service';

/**
 * Roadmap §4's "low-stock alert job (reorder_level) → admin
 * notification", and the warranty sweep beside it.
 *
 * It runs **daily** and lets the per-school setting decide whether today
 * is the configured weekday — the M12/M23/M25 job convention, where the
 * cron expression is coarse and the settings are what actually decide,
 * because one expression cannot be per-school.
 *
 * Unlike M12's absent alert and M23's overdue chase, there is **no
 * per-row `notified_at` column** here and that is deliberate. Those chase
 * a specific student or a specific loan, so they need to remember which.
 * This one sends *one* summary per school per week — the run itself is
 * the unit of idempotency, and a column per item would be a hundred
 * writes to say "we mentioned the paper again".
 */
@Injectable()
export class InventoryAlertsJob {
  private readonly logger = new Logger(InventoryAlertsJob.name);

  constructor(
    private readonly notifications: InventoryNotificationsService,
    private readonly config: InventorySettingsService,
    private readonly schools: SchoolsRepository,
  ) {}

  @Cron('20 8 * * *')
  async run(): Promise<{ lowStock: number; warranty: number }> {
    const schools = await this.schools.findAll();
    let lowStock = 0;
    let warranty = 0;

    for (const school of schools) {
      const result = await this.runForSchool(school.id);
      lowStock += result.lowStock;
      warranty += result.warranty;
    }
    return { lowStock, warranty };
  }

  /** Exposed for tests and a manual "check the store now". */
  async runForSchool(
    schoolId: string,
    now = new Date(),
    force = false,
  ): Promise<{ lowStock: number; warranty: number }> {
    const cfg = await this.config.load(schoolId);
    if (!cfg.enabled || !cfg.lowStockAlertEnabled) {
      return { lowStock: 0, warranty: 0 };
    }

    // The weekday is read in **Dhaka**, not UTC. A sweep configured for
    // Saturday must run on the school's Saturday; comparing against the
    // server's UTC weekday puts it on the wrong day for six hours of
    // every night — the M25 e2e lesson, applied before it could bite.
    if (!force) {
      const weekday = new Date(`${dhakaToday(now)}T00:00:00Z`).getUTCDay();
      if (weekday !== cfg.lowStockAlertWeekday) {
        return { lowStock: 0, warranty: 0 };
      }
    }

    const lowStock = await this.notifications.sendLowStockAlert(schoolId);
    const warranty = await this.notifications.sendWarrantyAlert(schoolId);

    if (lowStock > 0 || warranty > 0) {
      this.logger.log(
        `Store sweep for ${schoolId}: ${lowStock} low-stock alert(s), ${warranty} warranty alert(s).`,
      );
    }
    return { lowStock, warranty };
  }
}
