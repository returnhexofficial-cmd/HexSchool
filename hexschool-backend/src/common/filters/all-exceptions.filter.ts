import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

export interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'UNPROCESSABLE_ENTITY',
  423: 'LOCKED',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_SERVER_ERROR',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
};

/**
 * Global catch-all filter producing the standard error envelope
 * `{ success: false, error: { code, message, details? } }`.
 *
 * - class-validator failures (BadRequest with message array) become
 *   `VALIDATION_ERROR` with the individual messages under `details`.
 * - Unknown (non-HTTP) exceptions are logged with stack and returned as
 *   an opaque 500 — internals are never leaked to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, envelope } = this.buildEnvelope(exception);

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json(envelope);
  }

  private buildEnvelope(exception: unknown): {
    status: number;
    envelope: ErrorEnvelope;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      let code = STATUS_CODES[status] ?? `HTTP_${status}`;
      let message = exception.message;
      let details: unknown;

      if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;
        // class-validator: { statusCode, message: string[], error }
        if (Array.isArray(b.message)) {
          code = 'VALIDATION_ERROR';
          message = 'Validation failed';
          details = b.message;
        } else {
          if (typeof b.message === 'string') message = b.message;
          if (typeof b.code === 'string') code = b.code;
          if (b.details !== undefined) details = b.details;
          // terminus health failures carry their component report
          else if (b.error !== undefined && typeof b.error === 'object')
            details = b.error;
        }
      } else if (typeof body === 'string') {
        message = body;
      }

      return {
        status,
        envelope: {
          success: false,
          error: { code, message, ...(details !== undefined && { details }) },
        },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      envelope: {
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Something went wrong. Please try again later.',
        },
      },
    };
  }
}
