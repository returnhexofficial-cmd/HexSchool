import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { REPORT_CODES } from '../reports/report.registry';
import {
  REPORT_EXECUTORS,
  type ReportExecutor,
  type ReportExecutorProvider,
} from '../reports/executor.types';

/**
 * Merges every module's executor provider into one `code → executor` map.
 *
 * The merge is checked at boot, and both directions matter:
 *
 *   - **an executor for a code the registry does not declare** is a
 *     typo — the report would be unreachable, because the catalog is what
 *     offers it;
 *   - **a registry entry marked `runnable` with no executor** is worse:
 *     the hub shows a Run button, a user presses it, and a job is queued
 *     that can only fail.
 *
 * Both are logged loudly at startup rather than left to be discovered. A
 * spec test asserts the same two invariants, so the failure is caught in
 * CI rather than in a log nobody reads — but the runtime check stays,
 * because a provider that fails to bind is a DI problem `tsc` cannot see
 * (the M18 `NotificationsRepository` lesson).
 */
@Injectable()
export class ReportExecutorRegistry implements OnModuleInit {
  private readonly logger = new Logger(ReportExecutorRegistry.name);
  private readonly executors = new Map<string, ReportExecutor>();

  constructor(
    @Inject(REPORT_EXECUTORS)
    private readonly providers: ReportExecutorProvider[],
  ) {}

  onModuleInit(): void {
    for (const provider of this.providers) {
      for (const [code, executor] of Object.entries(provider.executors())) {
        if (this.executors.has(code)) {
          this.logger.warn(
            `Report ${code} has two executors — the last one registered wins`,
          );
        }
        this.executors.set(code, executor);
      }
    }

    const unknown = [...this.executors.keys()].filter(
      (code) => !REPORT_CODES.has(code),
    );
    if (unknown.length > 0) {
      this.logger.error(
        `Executors bound for codes missing from the report registry: ${unknown.join(', ')}`,
      );
    }
    this.logger.log(`${this.executors.size} report executors bound`);
  }

  get(code: string): ReportExecutor | undefined {
    return this.executors.get(code);
  }

  has(code: string): boolean {
    return this.executors.has(code);
  }

  codes(): string[] {
    return [...this.executors.keys()].sort();
  }
}
