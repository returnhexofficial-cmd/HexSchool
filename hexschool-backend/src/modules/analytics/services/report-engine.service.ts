import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ReportFormat, ReportRun } from '@prisma/client';
import { Queue } from 'bullmq';
import { UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { PermissionsService } from '../../rbac/services/permissions.service';
import { AnalyticsRepository } from '../repositories/analytics.repository';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { StorageService } from '../../storage/storage.service';
import {
  REPORTS_QUEUE,
  type ReportJob,
} from '../../../queues/queues.constants';
import { mayRunReport, stripColumns } from '../calc/column-policy.engine';
import { validateParams } from '../calc/param.engine';
import type { ReportTable } from '../calc/types';
import { ReportRunsRepository } from '../repositories/report-runs.repository';
import {
  reportDefinition,
  type ReportDefinition,
} from '../reports/report.registry';
import type { ReportContext } from '../reports/executor.types';
import { AnalyticsSettingsService } from './analytics-settings.service';
import { ReportExecutorRegistry } from './report-executor.registry';
import { ReportRenderService } from './report-render.service';

export interface RunRequest {
  code: string;
  schoolId: string;
  format?: ReportFormat;
  params?: Record<string, unknown>;
  /** The principal the run is attributed to and authorised as. */
  actorId: string | null;
  scheduleId?: string;
}

/**
 * The report engine (roadmap §4).
 *
 * Two entry points, and the split is the design:
 *
 *   - **`enqueue()`** validates, authorises and records a `report_runs` row,
 *     then hands the row id to BullMQ and returns. It never renders. That
 *     is roadmap §4's "large exports never block requests", and it is also
 *     what makes a run survive: the row holds the status and the file, so
 *     a Redis restart loses the *job* and not the *record*.
 *   - **`execute()`** is what the worker calls with a row id. It resolves
 *     permissions again — not as belt and braces, but because for a
 *     scheduled run this is the **only** authorisation that ever happens:
 *     no request, no guard, no route. Roadmap §6's "engine-level, not just
 *     UI" is not a nicety here, it is the whole enforcement.
 *
 * A failure inside `execute()` is caught and written to the row. A worker
 * that throws would retry the whole job three times (the queue's default)
 * and leave the export centre showing QUEUED throughout, which tells the
 * user nothing. A recorded FAILED with the message tells them what to fix.
 */
@Injectable()
export class ReportEngineService {
  private readonly logger = new Logger(ReportEngineService.name);

  constructor(
    private readonly runs: ReportRunsRepository,
    private readonly executors: ReportExecutorRegistry,
    private readonly renderer: ReportRenderService,
    private readonly permissions: PermissionsService,
    private readonly directory: AnalyticsRepository,
    private readonly storage: StorageService,
    private readonly schools: SchoolsRepository,
    private readonly config: AnalyticsSettingsService,
    @InjectQueue(REPORTS_QUEUE) private readonly queue: Queue<ReportJob>,
  ) {}

  // ── queueing ─────────────────────────────────────────────────────────

  async enqueue(request: RunRequest): Promise<ReportRun> {
    const definition = this.definitionOrThrow(request.code);
    const held = await this.heldFor(request.actorId);
    const isSuperAdmin = await this.isSuperAdmin(request.actorId);

    if (!mayRunReport(definition, held, isSuperAdmin)) {
      throw new ForbiddenException(
        `Running "${definition.name}" needs the ${definition.permission} permission`,
      );
    }
    if (!definition.runnable || !this.executors.has(definition.code)) {
      throw new BadRequestException(
        `"${definition.name}" cannot be generated as a file — open it at ${definition.endpoint ?? 'its module page'} instead`,
      );
    }

    const format = request.format ?? definition.formats[0] ?? 'XLSX';
    if (!definition.formats.includes(format)) {
      throw new BadRequestException(
        `"${definition.name}" is not available as ${format} — it offers ${definition.formats.join(', ')}`,
      );
    }

    const validation = validateParams(definition.params, request.params);
    if (!validation.ok) {
      throw new BadRequestException({
        message: 'The report parameters are not valid',
        details: validation.errors,
      });
    }

    const cfg = await this.config.load(request.schoolId);
    const run = await this.runs.create({
      schoolId: request.schoolId,
      reportCode: definition.code,
      params: validation.values,
      format,
      requestedBy: request.actorId,
      scheduleId: request.scheduleId ?? null,
      expiresAt: new Date(Date.now() + cfg.retentionDays * 86_400_000),
    });

    await this.queue.add(
      'run-report',
      { runId: run.id, schoolId: request.schoolId },
      { removeOnComplete: 200, removeOnFail: 500 },
    );
    return run;
  }

  // ── execution (worker side) ──────────────────────────────────────────

  async execute(runId: string): Promise<void> {
    const run = await this.runs.findById(runId);
    if (!run) {
      this.logger.warn(`Report run ${runId} vanished before it was executed`);
      return;
    }
    if (run.status !== 'QUEUED') {
      // A retried job whose first attempt already finished. Doing the work
      // twice would overwrite a good file with a second copy and reset the
      // expiry — cheaper and safer to notice and stop.
      this.logger.log(`Report run ${runId} is ${run.status}; skipping`);
      return;
    }

    const started = Date.now();
    await this.runs.markRunning(runId);

    try {
      const rendered = await this.produce({
        code: run.reportCode,
        schoolId: run.schoolId,
        format: run.format,
        params: run.params as Record<string, unknown>,
        actorId: run.requestedBy,
      });

      const upload = await this.storage.upload({
        body: rendered.file.buffer,
        contentType: rendered.file.contentType,
        filename: rendered.file.filename,
        prefix: `reports/${run.schoolId}`,
        purpose: 'reports',
      });

      const cfg = await this.config.load(run.schoolId);
      await this.runs.markDone(runId, {
        fileKey: upload.key,
        fileBucket: upload.bucket,
        fileUrl: upload.url,
        fileSize: rendered.file.buffer.length,
        rowCount: rendered.file.rowCount,
        durationMs: Date.now() - started,
        strippedColumns: rendered.stripped,
        expiresAt: new Date(Date.now() + cfg.retentionDays * 86_400_000),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'The report failed';
      this.logger.error(`Report run ${runId} failed: ${message}`);
      await this.runs.markFailed(runId, message);
    }
  }

  /**
   * Build and render a report, applying the column policy. Shared by the
   * worker and by the synchronous preview endpoint, so a preview and a
   * download can never show different columns.
   */
  async produce(request: RunRequest): Promise<{
    table: ReportTable;
    file: Awaited<ReturnType<ReportRenderService['render']>>;
    stripped: string[];
  }> {
    const definition = this.definitionOrThrow(request.code);
    const executor = this.executors.get(definition.code);
    if (!executor) {
      throw new BadRequestException(
        `"${definition.name}" has no generator bound`,
      );
    }

    const held = await this.heldFor(request.actorId);
    const isSuperAdmin = await this.isSuperAdmin(request.actorId);
    if (!mayRunReport(definition, held, isSuperAdmin)) {
      throw new ForbiddenException(
        `Running "${definition.name}" needs the ${definition.permission} permission`,
      );
    }

    const validation = validateParams(definition.params, request.params);
    if (!validation.ok) {
      throw new BadRequestException({
        message: 'The report parameters are not valid',
        details: validation.errors,
      });
    }

    const context: ReportContext = {
      schoolId: request.schoolId,
      params: validation.values,
      actorId: request.actorId,
      // A super admin holds everything, including every column permission.
      // Passing the resolved set rather than the flag keeps the column
      // policy a single pure function with one kind of input.
      held: isSuperAdmin ? EVERYTHING : held,
      isSuperAdmin,
    };

    const raw = await executor(context);
    const cfg = await this.config.load(request.schoolId);
    if (raw.rows.length > cfg.maxRows) {
      throw new BadRequestException(
        `That report produced ${raw.rows.length} rows, over the ${cfg.maxRows}-row limit — narrow the parameters`,
      );
    }

    const { table, stripped } = stripColumns(raw, context.held);
    const school = await this.schools.findById(request.schoolId);
    const file = await this.renderer.render(
      table,
      request.format ?? definition.formats[0] ?? 'XLSX',
      definition.code,
      school?.name,
    );
    return { table, file, stripped };
  }

  // ── helpers ──────────────────────────────────────────────────────────

  definitionOrThrow(code: string): ReportDefinition {
    const definition = reportDefinition(code);
    if (!definition) throw new NotFoundException(`Report ${code} not found`);
    return definition;
  }

  async heldFor(actorId: string | null): Promise<ReadonlySet<string>> {
    if (!actorId) return new Set();
    return new Set(await this.permissions.getUserPermissionCodes(actorId));
  }

  async contextFor(actor: AccessTokenPayload): Promise<{
    held: ReadonlySet<string>;
    isSuperAdmin: boolean;
  }> {
    const isSuperAdmin = actor.userType === UserType.SUPER_ADMIN;
    return {
      held: isSuperAdmin
        ? EVERYTHING
        : new Set(await this.permissions.getUserPermissionCodes(actor.sub)),
      isSuperAdmin,
    };
  }

  /**
   * A scheduled run has no token to read `userType` off, so the principal
   * is looked up. A **deleted or inactive** owner resolves to `false`
   * rather than to an error: the schedule-disabling sweep is what turns
   * that into a stopped schedule with a reason, and until it runs the
   * right behaviour is to authorise as nobody, not to authorise as an
   * admin.
   */
  /**
   * Whether a schedule's owner can still authorise a run — roadmap §8's
   * deleted-owner case, asked as a question rather than assumed.
   *
   * A soft-deleted or deactivated account answers `false`, and the sweep
   * turns that into a DISABLED schedule with a reason. Until it does, the
   * engine simply authorises as nobody, so an orphaned schedule produces a
   * 403 rather than a report the departed user's permissions would have
   * allowed.
   */
  async principalIsLive(actorId: string): Promise<boolean> {
    const principal = await this.directory.principal(actorId);
    return principal !== null && principal.status === 'ACTIVE';
  }

  private async isSuperAdmin(actorId: string | null): Promise<boolean> {
    if (!actorId) return false;
    const principal = await this.directory.principal(actorId);
    return principal?.userType === UserType.SUPER_ADMIN;
  }
}

/**
 * The permission set of a super admin: a `Set` whose `has` is always true.
 *
 * A real set cannot be built — the codes are a registry that grows every
 * module — and special-casing the flag at each of the four places the
 * policy is consulted is how one of them eventually gets missed. This
 * makes "holds everything" expressible in the same type as "holds these".
 */
const EVERYTHING: ReadonlySet<string> = {
  has: () => true,
  size: Number.POSITIVE_INFINITY,
  keys: () => [][Symbol.iterator](),
  values: () => [][Symbol.iterator](),
  entries: () => [][Symbol.iterator](),
  forEach: () => {},
  [Symbol.iterator]: () => [][Symbol.iterator](),
};
