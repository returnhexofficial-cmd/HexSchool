import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ReportRun } from '@prisma/client';
import { UserType } from '../../../common/constants';
import type { PaginatedResult } from '../../../common/dto/paginated.dto';
import type { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { StorageService } from '../../storage/storage.service';
import type { ReportRunQueryDto } from '../dto';
import { ReportRunsRepository } from '../repositories/report-runs.repository';
import { reportDefinition } from '../reports/report.registry';
import { AnalyticsSettingsService } from './analytics-settings.service';
import { ReportEngineService } from './report-engine.service';

export interface RunView extends ReportRun {
  reportName: string;
  /** True while the file is still there to be fetched. */
  downloadable: boolean;
}

/**
 * Roadmap §4's export centre: "my exports list (report_runs by user)".
 *
 * **A download re-signs rather than replaying the stored URL.** The URL on
 * the row was signed when the file was written and is an hour old by the
 * time anyone looks at the list; handing it back would give a link that is
 * dead more often than not. The bucket and key are stored precisely so a
 * fresh signature can be minted per click.
 *
 * **Who may download what.** A run belongs to the person who asked for it,
 * and the report's own permission is checked again on the way out. Both
 * are needed: without the ownership rule any user with `report.view` could
 * page through the export centre and pull a colleague's payroll register;
 * without the permission re-check, a user whose role was narrowed after
 * requesting a report could still fetch it a week later.
 */
@Injectable()
export class ReportRunsService {
  private readonly logger = new Logger(ReportRunsService.name);

  constructor(
    private readonly repo: ReportRunsRepository,
    private readonly engine: ReportEngineService,
    private readonly storage: StorageService,
    private readonly config: AnalyticsSettingsService,
  ) {}

  async list(
    schoolId: string,
    query: PaginationQueryDto,
    filter: ReportRunQueryDto,
    actor: AccessTokenPayload,
  ): Promise<PaginatedResult<RunView>> {
    const page = await this.repo.paginateFor(schoolId, query, {
      reportCode: filter.reportCode,
      status: filter.status,
      requestedBy: filter.mine === 'true' ? actor.sub : undefined,
    });
    return { ...page, data: page.data.map((run) => this.decorate(run)) };
  }

  async findOne(
    id: string,
    schoolId: string,
    actor: AccessTokenPayload,
  ): Promise<RunView> {
    const run = await this.repo.findByIdOrFail(id, schoolId);
    await this.assertMayRead(run, actor);
    return this.decorate(run);
  }

  /** A fresh signed URL for the file, or a clear reason there is none. */
  async download(
    id: string,
    schoolId: string,
    actor: AccessTokenPayload,
  ): Promise<{ url: string; filename: string; expiresIn: number }> {
    const run = await this.repo.findByIdOrFail(id, schoolId);
    await this.assertMayRead(run, actor);

    if (run.status !== 'DONE' || !run.fileKey) {
      throw new NotFoundException(
        run.status === 'FAILED'
          ? `That report failed: ${run.error ?? 'no reason recorded'}`
          : 'That report has not finished yet',
      );
    }
    if (run.expiresAt && run.expiresAt.getTime() < Date.now()) {
      const cfg = await this.config.load(schoolId);
      throw new NotFoundException(
        `That file has passed its ${cfg.retentionDays}-day retention and been removed — run the report again`,
      );
    }

    const expiresIn = 900;
    const url = await this.storage.getSignedUrl(
      run.fileKey,
      expiresIn,
      'reports',
    );
    return {
      url,
      filename: run.fileKey.split('/').pop() ?? 'report',
      expiresIn,
    };
  }

  /**
   * Roadmap §5's "re-run" button — a new run with the same parameters.
   *
   * **Both checks apply, and they are different checks.** `assertMayRead`
   * is the ownership rule: a run you may not open is not a run you may
   * clone, and without this you could not view a colleague's export but
   * could recreate it from its stored parameters — which are themselves a
   * disclosure (which class, which account, which month somebody was
   * looking at). The engine then authorises the *new* run under the
   * presser's own permissions, so a re-run can never inherit the columns
   * the original requester was entitled to.
   */
  async rerun(
    id: string,
    schoolId: string,
    actor: AccessTokenPayload,
  ): Promise<ReportRun> {
    const run = await this.repo.findByIdOrFail(id, schoolId);
    await this.assertMayRead(run, actor);
    return this.engine.enqueue({
      code: run.reportCode,
      schoolId,
      format: run.format,
      params: run.params as Record<string, unknown>,
      // Attributed to whoever pressed re-run — the engine authorises them,
      // not the original requester, so a re-run cannot borrow somebody
      // else's permissions.
      actorId: actor.sub,
    });
  }

  /**
   * Roadmap §4's 30-day auto-purge. Deletes the S3 object **first**: if
   * that fails the row survives and the next sweep tries again, whereas
   * deleting the row first would orphan the file forever with no record
   * that it exists.
   */
  async purgeExpired(now = new Date()): Promise<{ purged: number }> {
    const expired = await this.repo.findExpired(now);
    const removed: string[] = [];

    for (const run of expired) {
      if (run.fileKey) {
        try {
          await this.storage.delete(run.fileKey, 'reports');
        } catch (error) {
          this.logger.warn(
            `could not delete ${run.fileKey}: ${
              error instanceof Error ? error.message : 'unknown'
            } — leaving the row for the next sweep`,
          );
          continue;
        }
      }
      removed.push(run.id);
    }

    const purged = await this.repo.deleteMany(removed);
    if (purged > 0) this.logger.log(`${purged} expired report file(s) purged`);
    return { purged };
  }

  /**
   * A run left QUEUED or RUNNING long past any plausible duration — a
   * worker that died mid-report. Marked FAILED so the export centre stops
   * showing a spinner nothing will ever resolve.
   */
  async failStale(olderThanMinutes = 60): Promise<{ failed: number }> {
    const stale = await this.repo.findStale(
      new Date(Date.now() - olderThanMinutes * 60_000),
    );
    for (const run of stale) {
      await this.repo.markFailed(
        run.id,
        `The report did not finish within ${olderThanMinutes} minutes — the worker may have restarted. Try running it again.`,
      );
    }
    if (stale.length > 0) {
      this.logger.warn(`${stale.length} stale report run(s) marked failed`);
    }
    return { failed: stale.length };
  }

  private async assertMayRead(
    run: ReportRun,
    actor: AccessTokenPayload,
  ): Promise<void> {
    if (actor.userType === UserType.SUPER_ADMIN) return;

    if (run.requestedBy && run.requestedBy !== actor.sub) {
      throw new ForbiddenException(
        'That export belongs to somebody else — the export centre lists your own runs',
      );
    }
    const definition = reportDefinition(run.reportCode);
    if (!definition) return;
    const held = await this.engine.heldFor(actor.sub);
    if (!held.has(definition.permission)) {
      throw new ForbiddenException(
        `Reading "${definition.name}" needs the ${definition.permission} permission`,
      );
    }
  }

  private decorate(run: ReportRun): RunView {
    return {
      ...run,
      reportName: reportDefinition(run.reportCode)?.name ?? run.reportCode,
      downloadable:
        run.status === 'DONE' &&
        run.fileKey !== null &&
        (run.expiresAt === null || run.expiresAt.getTime() > Date.now()),
    };
  }
}
