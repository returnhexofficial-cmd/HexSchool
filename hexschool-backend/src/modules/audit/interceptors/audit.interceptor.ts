import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { DEFAULT_SCHOOL_ID } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { METHOD_ACTION_MAP } from '../audit.constants';
import {
  AUDIT_META_KEY,
  AuditMeta,
  SKIP_AUDIT_KEY,
} from '../decorators/audit.decorator';
import {
  AuditContextService,
  AuditDraft,
} from '../services/audit-context.service';
import { AuditService } from '../services/audit.service';
import { redactSensitive } from '../utils/redact';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Global audit trail (roadmap M03 §4): every successful mutating request
 * writes one audit_logs row. Precedence for what gets written:
 *   1. service-layer hooks via AuditContextService (real old/new diffs),
 *   2. route-level @Audit() metadata,
 *   3. inference (HTTP method → action, controller name → entity type,
 *      `:id` param / response id → entity id, redacted body → new values).
 * Secrets are redacted before persistence; a failed write never fails
 * the request (logged instead). Registered as APP_INTERCEPTOR in
 * AuditModule — module imports run before AppModule's own providers, so
 * this sits OUTSIDE TransformResponseInterceptor and sees the envelope.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly auditContext: AuditContextService,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AccessTokenPayload }>();

    const targets = [context.getHandler(), context.getClass()];
    if (
      !MUTATING_METHODS.has(request.method) ||
      this.reflector.getAllAndOverride<boolean>(SKIP_AUDIT_KEY, targets)
    ) {
      return next.handle();
    }
    const meta =
      this.reflector.getAllAndOverride<AuditMeta>(AUDIT_META_KEY, targets) ??
      {};

    const draft: AuditDraft = {};
    // Subscribe inside als.run so the controller + services execute
    // within this request's audit context (subscription-time, not
    // observable-creation-time, is when the handler actually runs).
    return new Observable((subscriber) => {
      const sub = this.auditContext.runWith(draft, () =>
        next
          .handle()
          .pipe(tap((body) => this.write(context, request, meta, draft, body)))
          .subscribe(subscriber),
      );
      return () => sub.unsubscribe();
    });
  }

  private write(
    context: ExecutionContext,
    request: Request & { user?: AccessTokenPayload },
    meta: AuditMeta,
    draft: AuditDraft,
    responseBody: unknown,
  ): void {
    if (draft.skip) return;
    try {
      const user = request.user;
      const params = request.params as Record<string, string | undefined>;
      const entry = {
        schoolId: draft.schoolId ?? user?.schoolId ?? DEFAULT_SCHOOL_ID,
        userId: draft.userId ?? user?.sub ?? null,
        action:
          draft.action ??
          meta.action ??
          METHOD_ACTION_MAP[request.method] ??
          request.method,
        entityType:
          draft.entityType ??
          meta.entityType ??
          context.getClass().name.replace(/Controller$/, ''),
        entityId:
          draft.entityId ?? params.id ?? this.extractId(responseBody) ?? null,
        oldValues: this.toJson(draft.oldValues),
        newValues: this.toJson(
          draft.newValues ??
            (request.method === 'DELETE' ? undefined : request.body),
        ),
        ip: request.ip ?? null,
        userAgent: request.headers['user-agent'] ?? null,
      };
      // Fire-and-forget: auditing must never delay or fail the response.
      void this.audit.record(entry).catch((err: unknown) => {
        this.logger.error(
          `audit write failed for ${entry.action} ${entry.entityType}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    } catch (err) {
      this.logger.error(
        `audit entry build failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Entity id from the enveloped (or raw) response body, if present. */
  private extractId(body: unknown): string | null {
    if (typeof body !== 'object' || body === null) return null;
    const data =
      'data' in body ? (body as { data?: unknown }).data : (body as unknown);
    if (typeof data !== 'object' || data === null) return null;
    const id = (data as { id?: unknown }).id;
    return typeof id === 'string' ? id : null;
  }

  /** Redact secrets; omit empty bodies entirely (column stays SQL NULL). */
  private toJson(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'object' && Object.keys(value).length === 0) {
      return undefined;
    }
    // Request/response bodies are JSON by construction (express.json()).
    return redactSensitive(value) as Prisma.InputJsonValue;
  }
}
