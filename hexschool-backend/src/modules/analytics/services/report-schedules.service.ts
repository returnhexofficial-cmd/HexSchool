import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationRecipientType,
  ReportSchedule,
  ReportScheduleStatus,
} from '@prisma/client';
import { AuditContextService } from '../../audit/services/audit-context.service';
import { NotificationService } from '../../communication/services/notification.service';
import { describeCron, nextRun, parseCron } from '../calc/cron.engine';
import { validateParams } from '../calc/param.engine';
import type {
  CreateScheduleDto,
  ScheduleQueryDto,
  UpdateScheduleDto,
} from '../dto';
import { ReportSchedulesRepository } from '../repositories/report-schedules.repository';
import { AnalyticsSettingsService } from './analytics-settings.service';
import { ReportEngineService } from './report-engine.service';

export interface ScheduleView extends ReportSchedule {
  reportName: string;
  cronDescription: string;
}

/**
 * Roadmap §4's scheduler and §5's schedule manager.
 *
 * Three rules from the spec live here rather than in the repository,
 * because each is a judgement rather than a query:
 *
 *   - **§7's cron whitelist** is enforced on write. A sub-hourly
 *     expression is refused at creation, not tolerated and then throttled
 *     at fire time — a schedule that exists but does not do what it says
 *     is worse than one that was never accepted.
 *   - **§6's retry-then-notify.** A failure increments `failure_count`; on
 *     the third consecutive one the schedule is DISABLED **with a reason**
 *     and its owner is told. The reason column is what separates "the
 *     system stopped this and here is why" from "somebody paused it".
 *   - **§8's deleted owner.** Their schedules are disabled and an admin is
 *     notified. Not deleted: the school may well still want the report,
 *     and somebody has to be able to see what was being sent and to whom.
 */
@Injectable()
export class ReportSchedulesService {
  private readonly logger = new Logger(ReportSchedulesService.name);

  constructor(
    private readonly repo: ReportSchedulesRepository,
    private readonly engine: ReportEngineService,
    private readonly config: AnalyticsSettingsService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditContextService,
  ) {}

  async list(
    schoolId: string,
    query: ScheduleQueryDto,
  ): Promise<ScheduleView[]> {
    const rows = await this.repo.findAllFor(schoolId, query);
    return rows.map((row) => this.decorate(row));
  }

  async findOne(id: string, schoolId: string): Promise<ScheduleView> {
    const row = await this.repo.findByIdOrFail(id, schoolId);
    return this.decorate(row);
  }

  async create(
    dto: CreateScheduleDto,
    schoolId: string,
    actorId: string,
  ): Promise<ScheduleView> {
    const definition = this.engine.definitionOrThrow(dto.reportCode);
    if (!definition.runnable) {
      throw new BadRequestException(
        `"${definition.name}" cannot be generated as a file, so it cannot be scheduled`,
      );
    }

    const cron = this.validCron(dto.cron);
    const params = this.validParams(dto.reportCode, dto.params);
    const recipients = this.validRecipients(dto.recipients);
    const format = dto.format ?? definition.formats[0] ?? 'XLSX';
    if (!definition.formats.includes(format)) {
      throw new BadRequestException(
        `"${definition.name}" is not available as ${format}`,
      );
    }

    const created = await this.repo.create({
      schoolId,
      reportCode: definition.code,
      name: dto.name.trim(),
      cron,
      params: params as never,
      recipients,
      format,
      ownerId: actorId,
      createdBy: actorId,
      nextRunAt: nextRun(cron),
    });
    this.audit.set({ newValues: { ...created } });
    return this.decorate(created);
  }

  async update(
    id: string,
    dto: UpdateScheduleDto,
    schoolId: string,
    actorId: string,
  ): Promise<ScheduleView> {
    const existing = await this.repo.findByIdOrFail(id, schoolId);

    const cron = dto.cron ? this.validCron(dto.cron) : existing.cron;
    const params = dto.params
      ? this.validParams(existing.reportCode, dto.params)
      : (existing.params as Record<string, unknown>);

    // Re-enabling clears the failure count. Otherwise a schedule that was
    // disabled after three failures, fixed, and switched back on would
    // disable itself again on its very next hiccup.
    const reactivating =
      dto.status === ReportScheduleStatus.ACTIVE &&
      existing.status !== ReportScheduleStatus.ACTIVE;

    const updated = await this.repo.update(id, {
      ...(dto.name ? { name: dto.name.trim() } : {}),
      ...(dto.format ? { format: dto.format } : {}),
      ...(dto.recipients
        ? { recipients: this.validRecipients(dto.recipients) }
        : {}),
      cron,
      params: params as never,
      ...(dto.status ? { status: dto.status } : {}),
      ...(reactivating
        ? { failureCount: 0, disabledReason: null, lastError: null }
        : {}),
      updatedBy: actorId,
      // A paused schedule has no next run — leaving one would make the
      // "overdue" query report every paused row forever.
      nextRunAt:
        (dto.status ?? existing.status) === ReportScheduleStatus.ACTIVE
          ? nextRun(cron)
          : null,
    });
    this.audit.set({ oldValues: { ...existing }, newValues: { ...updated } });
    return this.decorate(updated);
  }

  async remove(id: string, schoolId: string): Promise<void> {
    await this.repo.findByIdOrFail(id, schoolId);
    await this.repo.softDelete(id);
  }

  /** Roadmap §5's "test-run": fires the schedule now, off-cycle. */
  async testRun(
    id: string,
    schoolId: string,
    actorId: string,
  ): Promise<{ runId: string }> {
    const schedule = await this.repo.findByIdOrFail(id, schoolId);
    const run = await this.engine.enqueue({
      code: schedule.reportCode,
      schoolId,
      format: schedule.format,
      params: schedule.params as Record<string, unknown>,
      // Attributed to whoever pressed the button, not to the owner: a test
      // run must not let somebody see a report through a schedule that
      // somebody more privileged set up.
      actorId,
      scheduleId: schedule.id,
    });
    return { runId: run.id };
  }

  // ── the sweep ────────────────────────────────────────────────────────

  /**
   * Fires everything due. Called by the cron job every minute.
   *
   * `nextRunAt` is advanced **before** the run is queued. A schedule whose
   * report throws must still move on; leaving the old time in place would
   * make the sweep re-queue the same failing report every minute until
   * somebody noticed.
   */
  async runDue(now = new Date()): Promise<{ fired: number; failed: number }> {
    const due = await this.repo.findDue(now);
    let fired = 0;
    let failed = 0;

    for (const schedule of due) {
      await this.repo.markStarted(schedule.id, nextRun(schedule.cron, now));
      try {
        await this.engine.enqueue({
          code: schedule.reportCode,
          schoolId: schedule.schoolId,
          format: schedule.format,
          params: schedule.params as Record<string, unknown>,
          actorId: schedule.ownerId,
          scheduleId: schedule.id,
        });
        await this.repo.recordOutcome(schedule.id, { ok: true });
        fired += 1;
      } catch (error) {
        failed += 1;
        await this.handleFailure(schedule, error);
      }
    }
    return { fired, failed };
  }

  private async handleFailure(
    schedule: ReportSchedule,
    error: unknown,
  ): Promise<void> {
    const message =
      error instanceof Error ? error.message : 'The scheduled report failed';
    const cfg = await this.config.load(schedule.schoolId);
    const disable = schedule.failureCount + 1 >= cfg.scheduleMaxFailures;

    await this.repo.recordOutcome(schedule.id, {
      ok: false,
      error: message,
      disable,
      reason: `Disabled after ${cfg.scheduleMaxFailures} consecutive failures: ${message}`,
    });

    if (disable && schedule.ownerId) {
      // Roadmap §6: "failures retry ×2 then notify owner."
      await this.notify(schedule, message);
    }
  }

  private async notify(
    schedule: ReportSchedule,
    reason: string,
  ): Promise<void> {
    if (!schedule.ownerId) return;
    try {
      await this.notifications.send({
        schoolId: schedule.schoolId,
        code: 'REPORT_SCHEDULE_FAILED',
        channel: NotificationChannel.IN_APP,
        recipient: {
          type: NotificationRecipientType.USER,
          id: schedule.ownerId,
        },
        vars: {
          schedule_name: schedule.name,
          report_name: this.engine.definitionOrThrow(schedule.reportCode).name,
          reason,
        },
      });
    } catch (error) {
      // A notification failure may not take the sweep down — the schedule
      // is already disabled and that is the part that matters.
      this.logger.warn(
        `could not notify the owner of schedule ${schedule.id}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
  }

  /**
   * Roadmap §8: "Deleted user owning schedules → schedules auto-disabled,
   * admin notified."
   *
   * Checked on the sweep rather than hooked to user deletion. A hook would
   * need `AnalyticsModule` to be imported by the auth or staff module,
   * which is a cycle waiting to happen for a rule that is not urgent: a
   * schedule owned by somebody who left can safely keep firing until the
   * next sweep, because it is the *authorisation* that has gone, and the
   * engine already refuses a run whose principal resolves to nobody.
   */
  async disableOrphanedSchedules(): Promise<number> {
    const live = await this.repo.findLive();
    const owners = [
      ...new Set(live.map((s) => s.ownerId).filter((id): id is string => !!id)),
    ];
    if (owners.length === 0) return 0;

    const gone = new Set<string>();
    for (const ownerId of owners) {
      if (!(await this.engine.principalIsLive(ownerId))) gone.add(ownerId);
    }
    if (gone.size === 0) return 0;

    const orphaned = live.filter((s) => s.ownerId && gone.has(s.ownerId));
    const count = await this.repo.disableAll(
      orphaned.map((s) => s.id),
      'The user who owned this schedule no longer has an active account',
    );
    if (count > 0) {
      this.logger.warn(
        `${count} schedule(s) disabled — their owner's account is gone`,
      );
    }
    return count;
  }

  // ── validation helpers ───────────────────────────────────────────────

  private validCron(raw: string): string {
    const parsed = parseCron(raw);
    if (!parsed.ok) throw new BadRequestException(parsed.error);
    const cron = raw.trim().replace(/\s+/g, ' ');
    if (nextRun(cron) === null) {
      throw new BadRequestException(
        'That schedule can never fire — check the day and month',
      );
    }
    return cron;
  }

  private validParams(
    code: string,
    params: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    const definition = this.engine.definitionOrThrow(code);
    const validation = validateParams(definition.params, params);
    if (!validation.ok) {
      throw new BadRequestException({
        message: 'The report parameters are not valid',
        details: validation.errors,
      });
    }
    return validation.values;
  }

  private validRecipients(recipients: CreateScheduleDto['recipients']): {
    emails: string[];
    userIds: string[];
  } {
    const emails = recipients?.emails ?? [];
    const userIds = recipients?.userIds ?? [];
    if (emails.length === 0 && userIds.length === 0) {
      throw new BadRequestException(
        'A schedule needs at least one recipient — otherwise the report is generated and nobody is told',
      );
    }
    return { emails, userIds };
  }

  private decorate(row: ReportSchedule): ScheduleView {
    return {
      ...row,
      reportName:
        this.engine.definitionOrThrow(row.reportCode).name ?? row.reportCode,
      cronDescription: describeCron(row.cron),
    };
  }
}
