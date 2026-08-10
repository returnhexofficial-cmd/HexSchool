import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { ticketsToEscalate, type SlaTicketView } from '../calc/sla.engine';
import { TicketsRepository } from '../repositories/tickets.repository';
import { CommunityNotificationsService } from '../services/community-notifications.service';
import { CommunitySettingsService } from '../services/community-settings.service';

/**
 * Roadmap §4's "SLA reminder job (OPEN > 72 h → escalation notification)".
 *
 * It runs **hourly** and lets `sla.engine` decide what has actually
 * breached — the M12/M23/M24/M25 job convention, where the cron
 * expression is coarse and the per-school settings are what decide,
 * because one expression cannot be per-school.
 *
 * **`escalated_at` is the idempotency**, the M12 `absent_notified_at`
 * column-as-dedupe pattern. Without it an hourly sweep chases the head
 * hourly about the same complaint, and the sweep is switched off inside a
 * week — which is worse than not having built it, because the school
 * would then believe it had one.
 *
 * The escalation is **one summary per school**, not one message per
 * ticket (the M24 low-stock reasoning), and it names ticket **numbers**
 * rather than subjects — so a restricted complaint can be chased without
 * being disclosed on a bell that lands on several desks.
 */
@Injectable()
export class TicketSlaJob {
  private readonly logger = new Logger(TicketSlaJob.name);

  constructor(
    private readonly tickets: TicketsRepository,
    private readonly config: CommunitySettingsService,
    private readonly notifications: CommunityNotificationsService,
    private readonly schools: SchoolsRepository,
  ) {}

  @Cron('35 * * * *')
  async run(): Promise<{ escalated: number }> {
    const schools = await this.schools.findAll();
    let escalated = 0;
    for (const school of schools) {
      escalated += (await this.runForSchool(school.id)).escalated;
    }
    return { escalated };
  }

  /** Exposed for tests and a manual "chase the inbox now". */
  async runForSchool(
    schoolId: string,
    now = new Date(),
  ): Promise<{ escalated: number }> {
    const cfg = await this.config.load(schoolId);
    if (!cfg.enabled) return { escalated: 0 };

    const rows = await this.tickets.findLiveForSla(schoolId);
    const views: SlaTicketView[] = rows.map((row) => ({
      id: row.id,
      status: row.status,
      priority: row.priority,
      createdAt: row.createdAt,
      reopenedAt: row.reopenedAt,
      firstResponseAt: row.firstResponseAt,
      resolvedAt: row.resolvedAt,
      escalatedAt: row.escalatedAt,
    }));

    const due = ticketsToEscalate(views, now, cfg.ticketSlaHours);
    if (due.length === 0) return { escalated: 0 };

    const byId = new Map(rows.map((row) => [row.id, row]));
    const ticketNos = due
      .map((state) => byId.get(state.ticketId)?.ticketNo)
      .filter((no): no is string => Boolean(no));

    await this.notifications.escalate(schoolId, ticketNos);

    // Stamped AFTER the notification, so a send that throws leaves the
    // ticket eligible for the next sweep rather than silently marking it
    // chased. `CommunityNotificationsService` swallows its own failures,
    // so this is belt and braces — the cheap kind.
    for (const state of due) {
      await this.tickets.update(state.ticketId, { escalatedAt: now });
    }

    this.logger.log(
      `Escalated ${due.length} ticket(s) past their SLA for school ${schoolId}`,
    );
    return { escalated: due.length };
  }
}
