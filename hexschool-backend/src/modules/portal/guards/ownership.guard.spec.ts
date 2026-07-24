import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserType } from '../../../common/constants';
import { OwnershipGuard } from './ownership.guard';
import { PortalResolverService } from '../services/portal-resolver.service';

describe('OwnershipGuard', () => {
  let reflector: Reflector;
  let resolver: { assertOwnsStudent: jest.Mock };
  let guard: OwnershipGuard;

  const context = (
    user: unknown,
    params: Record<string, string> = {},
    query: Record<string, string> = {},
  ): ExecutionContext =>
    ({
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ user, params, query }) }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    reflector = new Reflector();
    resolver = { assertOwnsStudent: jest.fn().mockResolvedValue({}) };
    guard = new OwnershipGuard(
      reflector,
      resolver as unknown as PortalResolverService,
    );
  });

  it('allows a me-scoped route with no ownership metadata', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    await expect(
      guard.canActivate(context({ sub: 'u1', userType: UserType.STUDENT })),
    ).resolves.toBe(true);
    expect(resolver.assertOwnsStudent).not.toHaveBeenCalled();
  });

  it('enforces ownership on a decorated route (reads the named param)', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('childId');
    const user = { sub: 'p1', userType: UserType.PARENT };
    await guard.canActivate(context(user, { childId: 'stu-9' }));
    expect(resolver.assertOwnsStudent).toHaveBeenCalledWith(user, 'stu-9');
  });

  it('propagates a 403 when the resolver refuses the student', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('childId');
    resolver.assertOwnsStudent.mockRejectedValue(new ForbiddenException());
    await expect(
      guard.canActivate(
        context({ sub: 'p1', userType: UserType.PARENT }, { childId: 'other' }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets a Super Admin bypass the ownership check', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('childId');
    await expect(
      guard.canActivate(
        context(
          { sub: 'sa', userType: UserType.SUPER_ADMIN },
          { childId: 'x' },
        ),
      ),
    ).resolves.toBe(true);
    expect(resolver.assertOwnsStudent).not.toHaveBeenCalled();
  });

  it('reads the id from the query string when it is not a route param', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('childId');
    const user = { sub: 'p1', userType: UserType.PARENT };
    await guard.canActivate(context(user, {}, { childId: 'stu-q' }));
    expect(resolver.assertOwnsStudent).toHaveBeenCalledWith(user, 'stu-q');
  });
});
