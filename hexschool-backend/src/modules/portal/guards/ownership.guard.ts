import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { OWNS_STUDENT_KEY } from '../decorators/portal-scope.decorator';
import { PortalResolverService } from '../services/portal-resolver.service';

/**
 * Portal ownership guard (roadmap M18 §4/§7 — IDOR prevention). Applied to
 * the portal controllers; on any handler decorated `@OwnsStudent('key')`
 * it reads the student id from that param/query and refuses unless the
 * logged-in portal user owns it (a parent's linked child, or a student's
 * own record). Super Admin bypasses (support/debug).
 *
 * This is belt-and-suspenders: the services also re-check ownership
 * through `PortalResolverService.assertOwnsStudent`, so a route that
 * forgot the decorator still cannot leak another student's data.
 */
@Injectable()
export class OwnershipGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: PortalResolverService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<string>(OWNS_STUDENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!key) return true; // me-scoped route — nothing to own

    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as Request & { user?: AccessTokenPayload }).user;
    if (!user) return false;
    if (user.userType === UserType.SUPER_ADMIN) return true;

    const params = request.params as Record<string, string | undefined>;
    const query = request.query as Record<string, string | undefined>;
    const studentId = params[key] ?? query[key];
    if (!studentId) {
      throw new BadRequestException(`Missing ${key}`);
    }

    await this.resolver.assertOwnsStudent(user, studentId);
    return true;
  }
}
