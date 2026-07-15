import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { UserType } from '../../../common/constants';
import {
  REQUIRE_ANY_PERMISSION_KEY,
  REQUIRE_PERMISSIONS_KEY,
} from '../../../common/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { PermissionsService } from '../services/permissions.service';

/**
 * Global permission guard (registered as APP_GUARD in AppModule AFTER
 * JwtAuthGuard so `request.user` is populated). Routes opt in via
 * @RequirePermissions (AND) / @RequireAnyPermission (OR) — both may be
 * combined and both must then pass. Super Admin bypasses all checks.
 * Undecorated routes are authentication-only, as in Module 02.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const required =
      this.reflector.getAllAndOverride<string[]>(
        REQUIRE_PERMISSIONS_KEY,
        targets,
      ) ?? [];
    const anyOf =
      this.reflector.getAllAndOverride<string[]>(
        REQUIRE_ANY_PERMISSION_KEY,
        targets,
      ) ?? [];
    if (required.length === 0 && anyOf.length === 0) return true;

    const user = context
      .switchToHttp()
      .getRequest<Request & { user?: AccessTokenPayload }>().user;
    // JwtAuthGuard runs first; missing user here means a decorated
    // @Public() route — deny rather than leak.
    if (!user) throw new ForbiddenException('Insufficient permissions');

    if (user.userType === UserType.SUPER_ADMIN) return true;

    const held = new Set(
      await this.permissions.getUserPermissionCodes(user.sub),
    );
    const andOk = required.every((code) => held.has(code));
    const orOk = anyOf.length === 0 || anyOf.some((code) => held.has(code));
    if (!andOk || !orOk) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
