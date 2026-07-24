import { Injectable } from '@nestjs/common';
import { UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { PermissionsService } from '../../rbac/services/permissions.service';
import { REPORT_REGISTRY, ReportDefinition } from '../reports/report.registry';

/**
 * Serves the reports catalog filtered to what the caller may actually run
 * (roadmap M18 §4). The permission set is resolved once and each report is
 * kept only if its `permission` is held — so the Reports hub never offers
 * a report the API would then 403.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly permissions: PermissionsService) {}

  async listFor(actor: AccessTokenPayload): Promise<ReportDefinition[]> {
    if (actor.userType === UserType.SUPER_ADMIN) return [...REPORT_REGISTRY];
    const codes = new Set(
      await this.permissions.getUserPermissionCodes(actor.sub),
    );
    return REPORT_REGISTRY.filter((r) => codes.has(r.permission));
  }
}
