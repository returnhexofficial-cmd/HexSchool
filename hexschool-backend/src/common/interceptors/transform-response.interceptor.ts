import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { SKIP_ENVELOPE_KEY } from '../decorators/skip-envelope.decorator';

export interface ResponseEnvelope<T> {
  success: true;
  data: T;
  meta?: unknown;
  message?: string;
}

const ENVELOPE_KEYS = ['data', 'meta', 'message'];

/**
 * Wraps every JSON response into the standard envelope
 * `{ success, data, meta?, message? }`.
 *
 * A handler may return `{ data, meta?, message? }` (e.g. paginated results)
 * and the interceptor lifts `meta`/`message` to the top level instead of
 * double-nesting them.
 */
@Injectable()
export class TransformResponseInterceptor<T> implements NestInterceptor<
  T,
  ResponseEnvelope<T> | T
> {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ResponseEnvelope<T> | T> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ENVELOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return next.handle() as Observable<T>;
    }

    return (next.handle() as Observable<T>).pipe(
      map((payload) => {
        if (this.isEnvelopeShaped(payload)) {
          return { success: true as const, ...payload };
        }
        return { success: true as const, data: (payload ?? null) as T };
      }),
    );
  }

  private isEnvelopeShaped(
    payload: unknown,
  ): payload is { data: T; meta?: unknown; message?: string } {
    return (
      typeof payload === 'object' &&
      payload !== null &&
      !Array.isArray(payload) &&
      'data' in payload &&
      Object.keys(payload).every((key) => ENVELOPE_KEYS.includes(key)) &&
      Object.keys(payload).length > 1
    );
  }
}
