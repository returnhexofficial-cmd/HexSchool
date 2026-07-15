import { SetMetadata } from '@nestjs/common';
import type { AuditAction } from '../audit.constants';

export const SKIP_AUDIT_KEY = 'skipAudit';
export const AUDIT_META_KEY = 'auditMeta';

/**
 * Exempt a mutating route from the global AuditInterceptor. Reserved for
 * machine-driven noise (e.g. /auth/refresh — already covered by the
 * append-only login_activities log). Business mutations must NOT skip.
 */
export const SkipAudit = () => SetMetadata(SKIP_AUDIT_KEY, true);

export interface AuditMeta {
  action?: AuditAction;
  entityType?: string;
}

/** Override the interceptor's inferred action/entityType for a route. */
export const Audit = (meta: AuditMeta) => SetMetadata(AUDIT_META_KEY, meta);
