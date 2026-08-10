import { Injectable, Logger } from '@nestjs/common';
import {
  AnalyticsRepository,
  MATERIALIZED_VIEWS,
  type MaterializedView,
} from '../repositories/analytics.repository';

export interface RefreshOutcome {
  view: MaterializedView;
  ok: boolean;
  durationMs: number;
  error?: string;
}

/**
 * Roadmap §4's "MV refresh jobs + manual refresh endpoint".
 *
 * **Sequential, not parallel.** Three `REFRESH MATERIALIZED VIEW
 * CONCURRENTLY` statements at once is three full table scans competing for
 * the same I/O on a small Postgres, and the whole point of refreshing at
 * two in the morning is not to be noticed.
 *
 * **A failure does not stop the others.** Refreshing the attendance view
 * failing is no reason for the collection figures to be a day older still,
 * so each is attempted and the outcomes are returned together. The caller
 * — the job or the endpoint — reports them; nothing here throws.
 */
@Injectable()
export class MaterializedViewService {
  private readonly logger = new Logger(MaterializedViewService.name);

  async refreshAll(
    views: readonly MaterializedView[] = MATERIALIZED_VIEWS,
  ): Promise<RefreshOutcome[]> {
    const outcomes: RefreshOutcome[] = [];
    for (const view of views) {
      outcomes.push(await this.refresh(view));
    }
    const failed = outcomes.filter((o) => !o.ok);
    if (failed.length > 0) {
      this.logger.error(
        `${failed.length} of ${outcomes.length} materialized views failed to refresh`,
      );
    }
    return outcomes;
  }

  async refresh(view: MaterializedView): Promise<RefreshOutcome> {
    const started = Date.now();
    try {
      await this.repo.refreshView(view);
      const durationMs = Date.now() - started;
      this.logger.log(`${view} refreshed in ${durationMs} ms`);
      return { view, ok: true, durationMs };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'refresh failed';
      this.logger.error(`${view} refresh failed: ${message}`);
      return {
        view,
        ok: false,
        durationMs: Date.now() - started,
        error: message,
      };
    }
  }

  /** Names an unknown view out of a request body rather than running it. */
  parse(names: string[] | undefined): MaterializedView[] {
    if (!names || names.length === 0) return [...MATERIALIZED_VIEWS];
    return names.filter((name): name is MaterializedView =>
      (MATERIALIZED_VIEWS as readonly string[]).includes(name),
    );
  }

  constructor(private readonly repo: AnalyticsRepository) {}
}
