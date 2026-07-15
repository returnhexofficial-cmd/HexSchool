import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import type { AuditAction } from '../audit.constants';

/**
 * Draft audit entry for the in-flight request. The AuditInterceptor
 * opens a store per mutating request; services enrich it via `set()`
 * (the "service-layer hook" of roadmap M03 §4) with the real old/new
 * values — e.g. RolesService records permission-set diffs. Anything the
 * service doesn't set falls back to interceptor inference.
 */
export interface AuditDraft {
  action?: AuditAction;
  entityType?: string;
  entityId?: string;
  oldValues?: unknown;
  newValues?: unknown;
  /** Attribution overrides for anonymous routes that resolve the user
   *  mid-flight (e.g. login/reset — request.user is unset there). */
  userId?: string;
  schoolId?: string;
  /** Service-level opt-out (rarely needed; prefer @SkipAudit). */
  skip?: boolean;
}

@Injectable()
export class AuditContextService {
  private readonly als = new AsyncLocalStorage<AuditDraft>();

  /** Interceptor: run `fn` (the handler pipeline) inside a fresh draft. */
  runWith<T>(draft: AuditDraft, fn: () => T): T {
    return this.als.run(draft, fn);
  }

  /** Services: enrich the current request's draft (no-op outside one). */
  set(partial: AuditDraft): void {
    const store = this.als.getStore();
    if (store) Object.assign(store, partial);
  }
}
