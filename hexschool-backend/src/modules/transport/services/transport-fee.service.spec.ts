import { TransportFeeService } from './transport-fee.service';

/**
 * The M16 contract. Three of these cases are about **not** breaking
 * invoice generation: a school with transport switched off, one with no
 * fee head configured, and one whose database read blows up all have to
 * come back with an empty map rather than an exception, because the
 * alternative is a whole month's billing failing over a module the
 * school may not even use (the M20 "an auto-post failure is logged, never
 * rethrown" rule, one level up).
 */
describe('TransportFeeService', () => {
  const SCHOOL = 'school-1';
  const HEAD = { id: 'head-1', name: 'Transport' };

  let prisma: {
    transportAssignment: { findMany: jest.Mock };
    feeHead: { findFirst: jest.Mock };
  };
  let settings: { getValue: jest.Mock };
  let service: TransportFeeService;

  const rider = (over: Record<string, unknown> = {}) => ({
    enrollmentId: 'enr-1',
    startDate: new Date('2026-01-01T00:00:00Z'),
    endDate: null,
    suspendedAt: null,
    resumedAt: null,
    status: 'ACTIVE',
    route: { name: 'Mirpur Morning' },
    stop: { name: 'Kazipara', monthlyFee: 1500 },
    ...over,
  });

  beforeEach(() => {
    prisma = {
      transportAssignment: { findMany: jest.fn().mockResolvedValue([]) },
      feeHead: { findFirst: jest.fn().mockResolvedValue(HEAD) },
    };
    settings = {
      getValue: jest.fn().mockImplementation((_school: string, key: string) => {
        if (key === 'transport.fee_head_id') return Promise.resolve('');
        if (key === 'transport.fee_head_name')
          return Promise.resolve('Transport');
        return Promise.resolve(true);
      }),
    };
    service = new TransportFeeService(prisma as never, settings as never);
  });

  it('bills a full month at the stop’s fare', async () => {
    prisma.transportAssignment.findMany.mockResolvedValue([rider()]);

    const charges = await service.monthlyCharges(SCHOOL, ['enr-1'], '2026-03');

    expect(charges.get('enr-1')).toMatchObject({
      feeHeadId: 'head-1',
      amount: 1500,
      routeName: 'Mirpur Morning',
      stopName: 'Kazipara',
      servedDays: 31,
    });
  });

  it('prorates a rider who started mid-month, and says so on the line', async () => {
    prisma.transportAssignment.findMany.mockResolvedValue([
      rider({ startDate: new Date('2026-03-10T00:00:00Z') }),
    ]);

    const charge = (
      await service.monthlyCharges(SCHOOL, ['enr-1'], '2026-03')
    ).get('enr-1');

    expect(charge?.amount).toBe(1064.52);
    expect(charge?.description).toContain('22/31 days');
  });

  it('bills the days before an END and nothing after — roadmap §6', async () => {
    prisma.transportAssignment.findMany.mockResolvedValue([
      rider({ endDate: new Date('2026-03-16T00:00:00Z'), status: 'ENDED' }),
    ]);

    const march = await service.monthlyCharges(SCHOOL, ['enr-1'], '2026-03');
    const april = await service.monthlyCharges(SCHOOL, ['enr-1'], '2026-04');

    expect(march.get('enr-1')?.servedDays).toBe(15);
    expect(april.has('enr-1')).toBe(false);
  });

  it('omits a rider who owes nothing rather than billing a zero line', async () => {
    prisma.transportAssignment.findMany.mockResolvedValue([
      rider({ stop: { name: 'Free stop', monthlyFee: 0 } }),
    ]);

    const charges = await service.monthlyCharges(SCHOOL, ['enr-1'], '2026-03');
    expect(charges.size).toBe(0);
  });

  it('adds two windows when a rider changed route inside the month', async () => {
    prisma.transportAssignment.findMany.mockResolvedValue([
      rider({
        endDate: new Date('2026-03-11T00:00:00Z'),
        status: 'ENDED',
        stop: { name: 'Kazipara', monthlyFee: 3100 },
      }),
      rider({
        startDate: new Date('2026-03-11T00:00:00Z'),
        route: { name: 'Uttara Morning' },
        stop: { name: 'Sector 7', monthlyFee: 3100 },
      }),
    ]);

    const charge = (
      await service.monthlyCharges(SCHOOL, ['enr-1'], '2026-03')
    ).get('enr-1');

    // 10 days on one route + 21 on the other = the whole month, once.
    expect(charge?.servedDays).toBe(31);
    expect(charge?.amount).toBe(3100);
    expect(charge?.description).toContain('Uttara Morning');
  });

  it('charges a whole month when proration is switched off', async () => {
    settings.getValue.mockImplementation((_s: string, key: string) => {
      if (key === 'transport.prorate_enabled') return Promise.resolve(false);
      if (key === 'transport.fee_head_id') return Promise.resolve('');
      if (key === 'transport.fee_head_name')
        return Promise.resolve('Transport');
      return Promise.resolve(true);
    });
    prisma.transportAssignment.findMany.mockResolvedValue([
      rider({ startDate: new Date('2026-03-29T00:00:00Z') }),
    ]);

    const charge = (
      await service.monthlyCharges(SCHOOL, ['enr-1'], '2026-03')
    ).get('enr-1');
    expect(charge?.amount).toBe(1500);
  });

  it('bills nothing when transport is switched off, without querying', async () => {
    settings.getValue.mockImplementation((_s: string, key: string) =>
      Promise.resolve(key === 'transport.enabled' ? false : true),
    );

    const charges = await service.monthlyCharges(SCHOOL, ['enr-1'], '2026-03');

    expect(charges.size).toBe(0);
    expect(prisma.transportAssignment.findMany).not.toHaveBeenCalled();
  });

  it('bills nothing when auto-invoicing is off', async () => {
    settings.getValue.mockImplementation((_s: string, key: string) =>
      Promise.resolve(key === 'transport.auto_invoice' ? false : true),
    );
    expect(
      (await service.monthlyCharges(SCHOOL, ['enr-1'], '2026-03')).size,
    ).toBe(0);
  });

  it('bills nothing — and does NOT throw — when no fee head is configured', async () => {
    prisma.feeHead.findFirst.mockResolvedValue(null);
    prisma.transportAssignment.findMany.mockResolvedValue([rider()]);

    const charges = await service.monthlyCharges(SCHOOL, ['enr-1'], '2026-03');
    expect(charges.size).toBe(0);
  });

  it('falls back to a head matched BY NAME when no id is set', async () => {
    prisma.transportAssignment.findMany.mockResolvedValue([rider()]);

    await service.monthlyCharges(SCHOOL, ['enr-1'], '2026-03');

    const calls = prisma.feeHead.findFirst.mock.calls as Array<
      [{ where: { name?: { equals: string; mode: string } } }]
    >;
    expect(calls[0][0].where.name).toEqual({
      equals: 'Transport',
      mode: 'insensitive',
    });
  });

  it('swallows a database failure so invoice generation still runs', async () => {
    prisma.transportAssignment.findMany.mockRejectedValue(
      new Error('connection reset'),
    );

    await expect(
      service.monthlyCharges(SCHOOL, ['enr-1'], '2026-03'),
    ).resolves.toEqual(new Map());
  });

  it('does nothing at all for an empty candidate list', async () => {
    const charges = await service.monthlyCharges(SCHOOL, [], '2026-03');
    expect(charges.size).toBe(0);
    expect(settings.getValue).not.toHaveBeenCalled();
  });
});
