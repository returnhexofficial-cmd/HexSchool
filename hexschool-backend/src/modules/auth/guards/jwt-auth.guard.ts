import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { AccessTokenPayload } from '../interfaces/token-payload.interface';
import { TokenService } from '../services/token.service';

/**
 * Global JWT guard (registered as APP_GUARD): every route requires a valid
 * Bearer access token unless marked @Public(). Verification is purely
 * cryptographic — no DB hit per request; user status is re-checked on
 * refresh (M02 §8, ≤15 min exposure window).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AccessTokenPayload }>();
    const token = this.extractBearer(request);
    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }
    request.user = this.tokens.verifyAccessToken(token);
    return true;
  }

  private extractBearer(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header) return null;
    const [scheme, token] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && token ? token : null;
  }
}
