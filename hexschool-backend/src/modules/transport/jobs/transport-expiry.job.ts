import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { dhakaToday } from '../../../common/utils/clock.util';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { alertable, expiryItems } from '../calc/expiry.engine';
import {
  DriversRepository,
  VehiclesRepository,
} from '../repositories/fleet.repository';
import { FleetService } from '../services/fleet.service';
import { TransportNotificationsService } from '../services/transport-notifications.service';
import { TransportSettingsService } from '../services/transport-settings.service';

/**
 * Roadmap §4's "expiry alert job (fitness/tax/insurance/licence within 30
 * days → admin notification)".
 *
 * It runs **daily** and lets the per-school settings decide the window —
 * the M12/M23 job convention, where the cron expression is coarse and
 * the settings are what actually decide, because one expression cannot
 * be per-school.
 *
 * Idempotency is `expiry_notified_at`, and it is a **window** rather than
 * a null check (the M23 widening of M12's `absent_notified_at`): a bus
 * whose fitness certificate lapsed six weeks ago should be chased more
 * than once, and `transport.expiry_repeat_days` is how often. Renewing a
 * document clears the stamp, so the next problem is announced
 * immediately rather than waiting out somebody else's window.
 */
@Injectable()
export class TransportExpiryJob {
  private readonly logger = new Logger(TransportExpiryJob.name);

  constructor(
    private readonly vehicles: VehiclesRepository,
    private readonly drivers: DriversRepository,
    private readonly fleet: FleetService,
    private readonly notifications: TransportNotificationsService,
    private readonly config: TransportSettingsService,
    private readonly schools: SchoolsRepository,
  ) {}

  @Cron('40 7 * * *')
  async run(): Promise<{ alerted: number }> {
    const schools = await this.schools.findAll();
    let alerted = 0;
    for (const school of schools) {
      const result = await this.runForSchool(school.id);
      alerted += result.alerted;
    }
    return { alerted };
  }

  /** Exposed for tests and a manual "check the papers now". */
  async runForSchool(
    schoolId: string,
    now = new Date(),
    force = false,
  ): Promise<{ alerted: number }> {
    const cfg = await this.config.load(schoolId);
    if (!cfg.enabled || !cfg.expiryAlertEnabled) return { alerted: 0 };

    const today = dhakaToday(now);
    const cutoff = new Date(now.getTime() - cfg.expiryRepeatDays * 86_400_000);

    const [vehicles, drivers] = await Promise.all([
      this.vehicles.findAllLive(schoolId),
      this.drivers.findAllLive(schoolId),
    ]);

    let alerted = 0;
    const notifiedVehicles: string[] = [];
    for (const vehicle of vehicles) {
      if (
        !force &&
        vehicle.expiryNotifiedAt &&
        vehicle.expiryNotifiedAt > cutoff
      ) {
        continue;
      }
      const items = alertable(
        expiryItems(
          this.fleet.vehiclePapers(vehicle),
          today,
          cfg.expiryAlertDays,
        ),
      );
      if (items.length === 0) continue;

      const sent = await this.notifications.alertExpiry(
        schoolId,
        cfg,
        vehicle.regNo,
        'VEHICLE',
        items,
      );
      if (sent > 0) {
        alerted++;
        notifiedVehicles.push(vehicle.id);
      }
    }

    const notifiedDrivers: string[] = [];
    for (const driver of drivers) {
      if (
        !force &&
        driver.expiryNotifiedAt &&
        driver.expiryNotifiedAt > cutoff
      ) {
        continue;
      }
      const items = alertable(
        expiryItems(
          this.fleet.driverPapers(driver),
          today,
          cfg.expiryAlertDays,
        ),
      );
      if (items.length === 0) continue;

      const sent = await this.notifications.alertExpiry(
        schoolId,
        cfg,
        driver.name,
        'DRIVER',
        items,
      );
      if (sent > 0) {
        alerted++;
        notifiedDrivers.push(driver.id);
      }
    }

    // Stamped AFTER the fan-out, unlike M22's reminder: this list is
    // short (a fleet is tens of rows, not a section of forty parents),
    // and an alert about an uninsured bus is the one message it is worth
    // repeating rather than risk losing.
    await this.vehicles.markNotified(notifiedVehicles, now);
    await this.drivers.markNotified(notifiedDrivers, now);

    if (alerted > 0) {
      this.logger.log(
        `Transport document alerts: ${notifiedVehicles.length} vehicle(s), ${notifiedDrivers.length} driver(s)`,
      );
    }
    return { alerted };
  }
}
