import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AccessTokenPayload } from '../../modules/auth/interfaces/token-payload.interface';

/** Injects the verified access-token payload set by JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessTokenPayload => {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { user: AccessTokenPayload }>();
    return req.user;
  },
);
