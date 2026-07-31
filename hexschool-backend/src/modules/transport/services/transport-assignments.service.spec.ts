import { ConflictException, ForbiddenException } from '@nestjs/common';
import { TransportAssignmentsService } from './transport-assignments.service';

/**
 * The rider lifecycle, and the two rules the whole module hangs off:
 * over-capacity **warns** unless a school asked for a block (roadmap §6),
 * and every status change **writes a date**, because M16 reads the
 * window rather than the status (the M21 `exit_date` lesson).
 */
describe('TransportAssignmentsService', () => {
  const ACTOR = {
    sub: 'user-1',
    schoolId: 'school-1',
    userType: 'STAFF',
  } as never;

  const route = (over: Record<string, unknown> = {}) => ({
    id: 'route-1',
    schoolId: 'school-1',
    name: 'Mirpur Morning',
    status: 'ACTIVE',
    vehicle: {
      id: 'v-1',
      regNo: 'DHAKA GA 11-2345',
      capacity: 40,
      status: 'ACTIVE',
    },
    stops: [
      { id: 'stop-1', name: 'Kazipara', monthlyFee: 1500, displayOrder: 0 },
    ],
    ...over,
  });

  const enrollment = {
    id: 'enr-1',
    status: 'ACTIVE',
    student: { id: 'stu-1', firstName: 'Rafi', lastName: 'Ahmed' },
  };

  let assignments: Record<string, jest.Mock>;
  let routes: Record<string, jest.Mock>;
  let stops: Record<string, jest.Mock>;
  let enrollments: Record<string, jest.Mock>;
  let permissions: { getUserPermissionCodes: jest.Mock };
  let config: { load: jest.Mock };
  let notifications: { announceAssignment: jest.Mock };
  let audit: { set: jest.Mock };
  let service: TransportAssignmentsService;

  const build = () =>
    new TransportAssignmentsService(
      assignments as never,
      routes as never,
      stops as never,
      enrollments as never,
      permissions as never,
      config as never,
      notifications as never,
      audit as never,
    );

  beforeEach(() => {
    assignments = {
      findLive: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'ta-1' }),
      update: jest.fn().mockResolvedValue({ id: 'ta-1' }),
      findDetail: jest.fn().mockResolvedValue({
        id: 'ta-1',
        schoolId: 'school-1',
        routeId: 'route-1',
        stopId: 'stop-1',
        status: 'ACTIVE',
        startDate: new Date('2026-03-01T00:00:00Z'),
        suspendedAt: null,
        route: { name: 'Mirpur Morning' },
        stop: { name: 'Kazipara' },
        enrollment: { student: { id: 'stu-1' } },
      }),
      findAllFor: jest.fn().mockResolvedValue([]),
      withTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
    };
    routes = {
      findDetail: jest.fn().mockResolvedValue(route()),
      riderCounts: jest.fn().mockResolvedValue(new Map([['route-1', 10]])),
    };
    stops = { findByIdOrFail: jest.fn() };
    enrollments = { findDetail: jest.fn().mockResolvedValue(enrollment) };
    permissions = { getUserPermissionCodes: jest.fn().mockResolvedValue([]) };
    config = {
      load: jest.fn().mockResolvedValue({
        enabled: true,
        capacityHardBlock: false,
        notifyGuardianOnAssign: false,
      }),
    };
    notifications = { announceAssignment: jest.fn() };
    audit = { set: jest.fn() };
    service = build();
  });

  describe('create', () => {
    it('assigns a rider to a stop on an active route', async () => {
      const result = await service.create(
        { enrollmentId: 'enr-1', routeId: 'route-1', stopId: 'stop-1' },
        ACTOR,
      );

      expect(assignments.create).toHaveBeenCalledWith(
        expect.objectContaining({
          enrollmentId: 'enr-1',
          routeId: 'route-1',
          stopId: 'stop-1',
          status: 'ACTIVE',
        }),
      );
      expect(result.warnings).toEqual([]);
    });

    it('refuses a second live assignment for one enrollment', async () => {
      assignments.findLive.mockResolvedValue({
        route: { name: 'Uttara Morning' },
        stop: { name: 'Sector 7' },
      });

      await expect(
        service.create(
          { enrollmentId: 'enr-1', routeId: 'route-1', stopId: 'stop-1' },
          ACTOR,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses a route with no vehicle — roadmap §6', async () => {
      routes.findDetail.mockResolvedValue(route({ vehicle: null }));

      await expect(
        service.create(
          { enrollmentId: 'enr-1', routeId: 'route-1', stopId: 'stop-1' },
          ACTOR,
        ),
      ).rejects.toThrow(/no vehicle/i);
    });

    it('allows a route whose bus is in MAINTENANCE — the route still runs', async () => {
      routes.findDetail.mockResolvedValue(
        route({
          vehicle: {
            id: 'v-1',
            regNo: 'X',
            capacity: 40,
            status: 'MAINTENANCE',
          },
        }),
      );

      await expect(
        service.create(
          { enrollmentId: 'enr-1', routeId: 'route-1', stopId: 'stop-1' },
          ACTOR,
        ),
      ).resolves.toBeDefined();
    });

    it('refuses a stop that is not on the route, saying why', async () => {
      await expect(
        service.create(
          {
            enrollmentId: 'enr-1',
            routeId: 'route-1',
            stopId: 'stop-elsewhere',
          },
          ACTOR,
        ),
      ).rejects.toThrow(/not on/i);
    });

    it('refuses an enrollment that is not ACTIVE', async () => {
      enrollments.findDetail.mockResolvedValue({
        ...enrollment,
        status: 'TRANSFERRED',
      });

      await expect(
        service.create(
          { enrollmentId: 'enr-1', routeId: 'route-1', stopId: 'stop-1' },
          ACTOR,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('WARNS rather than refusing over capacity by default', async () => {
      routes.riderCounts.mockResolvedValue(new Map([['route-1', 40]]));

      const result = await service.create(
        { enrollmentId: 'enr-1', routeId: 'route-1', stopId: 'stop-1' },
        ACTOR,
      );

      expect(assignments.create).toHaveBeenCalled();
      expect(result.warnings[0]).toContain('over capacity');
    });

    it('refuses over capacity when the school turned the block on', async () => {
      config.load.mockResolvedValue({
        enabled: true,
        capacityHardBlock: true,
        notifyGuardianOnAssign: false,
      });
      routes.riderCounts.mockResolvedValue(new Map([['route-1', 40]]));

      await expect(
        service.create(
          { enrollmentId: 'enr-1', routeId: 'route-1', stopId: 'stop-1' },
          ACTOR,
        ),
      ).rejects.toThrow(/transport\.assign\.override/);
    });

    it('refuses the override itself to somebody without the permission', async () => {
      config.load.mockResolvedValue({
        enabled: true,
        capacityHardBlock: true,
        notifyGuardianOnAssign: false,
      });
      routes.riderCounts.mockResolvedValue(new Map([['route-1', 40]]));

      await expect(
        service.create(
          {
            enrollmentId: 'enr-1',
            routeId: 'route-1',
            stopId: 'stop-1',
            override: true,
          },
          ACTOR,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets the override through for somebody who holds it', async () => {
      config.load.mockResolvedValue({
        enabled: true,
        capacityHardBlock: true,
        notifyGuardianOnAssign: false,
      });
      routes.riderCounts.mockResolvedValue(new Map([['route-1', 40]]));
      permissions.getUserPermissionCodes.mockResolvedValue([
        'transport.assign.override',
      ]);

      const result = await service.create(
        {
          enrollmentId: 'enr-1',
          routeId: 'route-1',
          stopId: 'stop-1',
          override: true,
        },
        ACTOR,
      );
      expect(result.warnings[0]).toContain('over capacity');
    });

    it('refuses everything when transport is switched off', async () => {
      config.load.mockResolvedValue({ enabled: false });

      await expect(
        service.create(
          { enrollmentId: 'enr-1', routeId: 'route-1', stopId: 'stop-1' },
          ACTOR,
        ),
      ).rejects.toThrow(/switched off/i);
    });
  });

  describe('the lifecycle writes dates, not just statuses', () => {
    it('suspend stamps suspended_at — billing stops there', async () => {
      await service.suspend(
        'ta-1',
        { effectiveDate: '2026-03-11', reason: 'Long illness' },
        ACTOR,
      );

      expect(assignments.update).toHaveBeenCalledWith(
        'ta-1',
        expect.objectContaining({
          status: 'SUSPENDED',
          suspendedAt: new Date('2026-03-11T00:00:00.000Z'),
          statusReason: 'Long illness',
        }),
      );
    });

    it('resume CLEARS suspended_at and stamps resumed_at', async () => {
      assignments.findDetail.mockResolvedValue({
        id: 'ta-1',
        schoolId: 'school-1',
        status: 'SUSPENDED',
        startDate: new Date('2026-03-01T00:00:00Z'),
        suspendedAt: new Date('2026-03-11T00:00:00Z'),
        route: { name: 'r' },
        stop: { name: 's' },
        enrollment: { student: { id: 'stu-1' } },
      });

      await service.resume('ta-1', { effectiveDate: '2026-03-20' }, ACTOR);

      expect(assignments.update).toHaveBeenCalledWith(
        'ta-1',
        expect.objectContaining({
          status: 'ACTIVE',
          suspendedAt: null,
          resumedAt: new Date('2026-03-20T00:00:00.000Z'),
        }),
      );
    });

    it('end stamps end_date and drops any suspension boundary', async () => {
      await service.end(
        'ta-1',
        { endDate: '2026-03-16', reason: 'Moved house' },
        ACTOR,
      );

      expect(assignments.update).toHaveBeenCalledWith(
        'ta-1',
        expect.objectContaining({
          status: 'ENDED',
          endDate: new Date('2026-03-16T00:00:00.000Z'),
          suspendedAt: null,
        }),
      );
    });

    it('refuses a suspension dated before the assignment started', async () => {
      await expect(
        service.suspend(
          'ta-1',
          { effectiveDate: '2026-02-01', reason: 'x' },
          ACTOR,
        ),
      ).rejects.toThrow(/before the assignment/i);
    });

    it('refuses an end dated before the start', async () => {
      await expect(
        service.end('ta-1', { endDate: '2026-02-01', reason: 'x' }, ACTOR),
      ).rejects.toThrow(/before it started/i);
    });

    it('refuses to suspend something that is not ACTIVE', async () => {
      assignments.findDetail.mockResolvedValue({
        id: 'ta-1',
        schoolId: 'school-1',
        status: 'SUSPENDED',
        startDate: new Date('2026-03-01T00:00:00Z'),
        route: { name: 'r' },
        stop: { name: 's' },
        enrollment: { student: { id: 'stu-1' } },
      });

      await expect(
        service.suspend('ta-1', { reason: 'again' }, ACTOR),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('bulkAssign', () => {
    it('asks the capacity question ONCE for the whole batch', async () => {
      routes.riderCounts.mockResolvedValue(new Map([['route-1', 30]]));
      config.load.mockResolvedValue({
        enabled: true,
        capacityHardBlock: true,
        notifyGuardianOnAssign: false,
      });

      await expect(
        service.bulkAssign(
          {
            routeId: 'route-1',
            stopId: 'stop-1',
            enrollmentIds: [
              'e1',
              'e2',
              'e3',
              'e4',
              'e5',
              'e6',
              'e7',
              'e8',
              'e9',
              'e10',
              'e11',
            ],
          },
          ACTOR,
        ),
      ).rejects.toThrow(/over capacity/i);
    });

    it('skips riders who are already on a bus, and reports why', async () => {
      assignments.findLive
        .mockResolvedValueOnce({
          route: { name: 'Uttara' },
          stop: { name: 'Sector 7' },
        })
        .mockResolvedValue(null);

      const result = await service.bulkAssign(
        { routeId: 'route-1', stopId: 'stop-1', enrollmentIds: ['e1', 'e2'] },
        ACTOR,
      );

      expect(result.assigned).toBe(1);
      expect(result.skipped[0].reason).toContain('Uttara');
    });
  });

  describe('reassign (roadmap §8 route split/merge)', () => {
    const from = route({ id: 'route-1', name: 'Mirpur Morning' });
    const to = route({
      id: 'route-2',
      name: 'Mirpur Morning B',
      stops: [
        { id: 'stop-2', name: 'Kazipara', monthlyFee: 1500, displayOrder: 0 },
      ],
    });

    beforeEach(() => {
      routes.findDetail.mockImplementation((id: string) =>
        Promise.resolve(id === 'route-1' ? from : to),
      );
      assignments.findAllFor.mockResolvedValue([
        { id: 'ta-1', stop: { name: 'Kazipara' } },
        { id: 'ta-2', stop: { name: 'Shewrapara' } },
      ]);
      routes.riderCounts.mockResolvedValue(new Map([['route-2', 0]]));
    });

    it('matches stops BY NAME so the fare survives the split', async () => {
      const result = await service.reassign(
        { fromRouteId: 'route-1', toRouteId: 'route-2', reason: 'Route split' },
        ACTOR,
      );

      expect(result.moved).toBe(1);
      expect(assignments.update).toHaveBeenCalledWith(
        'ta-1',
        expect.objectContaining({ routeId: 'route-2', stopId: 'stop-2' }),
        expect.anything(),
      );
    });

    it('reports a rider whose stop has no counterpart rather than moving them anywhere', async () => {
      const result = await service.reassign(
        { fromRouteId: 'route-1', toRouteId: 'route-2', reason: 'Route split' },
        ACTOR,
      );

      expect(result.unmatched).toHaveLength(1);
      expect(result.unmatched[0].reason).toContain('Shewrapara');
    });

    it('refuses a reassignment onto the same route', async () => {
      await expect(
        service.reassign(
          { fromRouteId: 'route-1', toRouteId: 'route-1', reason: 'x' },
          ACTOR,
        ),
      ).rejects.toThrow(/same/i);
    });
  });
});
