import { Injectable, NotFoundException } from '@nestjs/common';
import { UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { PermissionsService } from '../../rbac/services/permissions.service';
import {
  REPORT_REGISTRY,
  reportDefinition,
  type ReportDefinition,
} from '../reports/report.registry';
import { ReportExecutorRegistry } from './report-executor.registry';

export interface CatalogEntry extends ReportDefinition {
  /** False when the definition claims runnable but nothing is bound. */
  runnable: boolean;
  /** True when the caller lacks the column-level data permission. */
  columnsWillBeWithheld: boolean;
}

/**
 * `GET /reports` — the catalog, filtered to what the caller may run.
 *
 * The M18 service, kept whole (a report whose permission is not held is
 * never offered, so the hub cannot show something the API would 403) and
 * extended with two facts the v2 hub needs:
 *
 *   - **`runnable`** is recomputed against the live executor registry
 *     rather than trusted from the file. A definition that says it can be
 *     generated and has no generator bound would put a Run button on
 *     screen that only ever produces a failed run.
 *   - **`columnsWillBeWithheld`** lets the hub warn *before* the download
 *     rather than after. Roadmap §6 strips the columns either way; being
 *     told first is the difference between a permissions boundary and a
 *     spreadsheet that looks broken.
 */
@Injectable()
export class ReportCatalogService {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly executors: ReportExecutorRegistry,
  ) {}

  async listFor(actor: AccessTokenPayload): Promise<CatalogEntry[]> {
    const held = await this.heldFor(actor);
    return REPORT_REGISTRY.filter(
      (definition) => held === null || held.has(definition.permission),
    ).map((definition) => this.decorate(definition, held));
  }

  async findFor(
    code: string,
    actor: AccessTokenPayload,
  ): Promise<CatalogEntry> {
    const definition = reportDefinition(code);
    if (!definition) throw new NotFoundException(`Report ${code} not found`);
    const held = await this.heldFor(actor);
    if (held !== null && !held.has(definition.permission)) {
      // A 404 rather than a 403: the catalog is the caller's whole view of
      // what exists, and telling them a report they may not run is there
      // is itself a small disclosure.
      throw new NotFoundException(`Report ${code} not found`);
    }
    return this.decorate(definition, held);
  }

  /** `null` means a super admin — holds everything. */
  private async heldFor(
    actor: AccessTokenPayload,
  ): Promise<ReadonlySet<string> | null> {
    if (actor.userType === UserType.SUPER_ADMIN) return null;
    return new Set(await this.permissions.getUserPermissionCodes(actor.sub));
  }

  private decorate(
    definition: ReportDefinition,
    held: ReadonlySet<string> | null,
  ): CatalogEntry {
    return {
      ...definition,
      runnable: definition.runnable && this.executors.has(definition.code),
      columnsWillBeWithheld: Boolean(
        definition.sensitivePermission &&
        held !== null &&
        !held.has(definition.sensitivePermission),
      ),
    };
  }
}
