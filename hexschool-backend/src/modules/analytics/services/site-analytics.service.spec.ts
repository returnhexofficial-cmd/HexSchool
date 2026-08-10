import { SiteAnalyticsService } from './site-analytics.service';

/**
 * The website counter's two behaviours that matter: it never breaks the
 * public page, and the nightly fold looks at yesterday as well as today.
 */

function build(overrides: { enabled?: boolean } = {}) {
  const counter = {
    record: jest.fn().mockResolvedValue(undefined),
    fingerprint: jest.fn().mockReturnValue('fp'),
    drain: jest.fn().mockResolvedValue(null),
    peek: jest.fn().mockResolvedValue({ pageViews: 3, uniqueVisitors: 2 }),
  };
  const repo = {
    accumulate: jest.fn().mockResolvedValue(undefined),
    range: jest.fn().mockResolvedValue([]),
    forDate: jest.fn().mockResolvedValue(null),
  };
  const schools = {
    findAll: jest.fn().mockResolvedValue([{ id: 'school-1' }]),
  };
  const config = {
    load: jest.fn().mockResolvedValue({
      enabled: true,
      websiteTrackingEnabled: overrides.enabled ?? true,
      websiteVisitorSalt: 'salt',
      websiteTopN: 20,
    }),
  };

  const service = new SiteAnalyticsService(
    counter as never,
    repo as never,
    schools as never,
    config as never,
  );
  return { service, counter, repo, config };
}

const request = { ip: '203.0.113.4', userAgent: 'Mozilla/5.0' };

describe('collect', () => {
  it('records a view through the salted fingerprint', async () => {
    const { service, counter } = build();
    const result = await service.collect('s1', { path: '/notices' }, request);
    expect(result).toEqual({ recorded: true });
    expect(counter.fingerprint).toHaveBeenCalledWith(
      '203.0.113.4',
      'Mozilla/5.0',
      'salt',
    );
    expect(counter.record).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/notices', fingerprint: 'fp' }),
    );
  });

  it('does nothing when tracking is switched off', async () => {
    const { service, counter } = build({ enabled: false });
    expect(await service.collect('s1', { path: '/' }, request)).toEqual({
      recorded: false,
    });
    expect(counter.record).not.toHaveBeenCalled();
  });

  it('never throws — a counter must not break a marketing page', async () => {
    const { service, counter } = build();
    counter.record.mockRejectedValue(new Error('redis gone'));
    await expect(
      service.collect('s1', { path: '/' }, request),
    ).resolves.toEqual({ recorded: false });
  });

  it('survives a settings read that fails', async () => {
    const { service, config } = build();
    config.load.mockRejectedValue(new Error('db gone'));
    await expect(
      service.collect('s1', { path: '/' }, request),
    ).resolves.toEqual({ recorded: false });
  });
});

describe('fold', () => {
  it('folds yesterday as well as today', async () => {
    // A fold at 00:05 that looked at today alone would lose everything
    // recorded after the previous fold — every night, invisibly.
    const { service, counter } = build();
    const at = new Date('2026-08-10T18:20:00Z'); // 00:20 Dhaka on the 11th
    await service.fold(at);
    const dates = counter.drain.mock.calls.map(
      (call: unknown[]) => call[1] as string,
    );
    expect(dates).toEqual(['2026-08-10', '2026-08-11']);
  });

  it('writes what it drained', async () => {
    const { service, counter, repo } = build();
    counter.drain.mockResolvedValueOnce({
      date: '2026-08-10',
      pageViews: 40,
      uniqueVisitors: 12,
      topPages: [{ path: '/', views: 30 }],
      topReferrers: [{ referrer: 'google.com', views: 8 }],
    });
    const result = await service.fold(new Date('2026-08-10T18:20:00Z'));
    expect(result.days).toBe(1);
    expect(repo.accumulate).toHaveBeenCalledWith(
      expect.objectContaining({ pageViews: 40, uniqueVisitors: 12 }),
    );
  });

  it('skips a school with tracking off', async () => {
    const { service, counter } = build({ enabled: false });
    await service.fold();
    expect(counter.drain).not.toHaveBeenCalled();
  });

  it('writes nothing for a day with no traffic', async () => {
    const { service, repo } = build();
    await service.fold();
    expect(repo.accumulate).not.toHaveBeenCalled();
  });
});

describe('report', () => {
  it('merges the daily top-page lists and ranks them', async () => {
    const { service, repo } = build();
    repo.range.mockResolvedValue([
      {
        date: '2026-08-01',
        pageViews: 10,
        uniqueVisitors: 4,
        topPages: [
          { path: '/', views: 6 },
          { path: '/notices', views: 4 },
        ],
        topReferrers: [],
      },
      {
        date: '2026-08-02',
        pageViews: 30,
        uniqueVisitors: 9,
        topPages: [{ path: '/notices', views: 30 }],
        topReferrers: [],
      },
    ]);

    const result = await service.report('s1', {
      from: '2026-08-01',
      to: '2026-08-02',
    });

    expect(result.totals.pageViews).toBe(40);
    expect(result.totals.peakDay).toBe('2026-08-02');
    expect(result.topPages[0]).toEqual({ path: '/notices', views: 34 });
    expect(result.today).toEqual({ pageViews: 3, uniqueVisitors: 2 });
  });

  it('has no peak day when there is no traffic at all', async () => {
    const { service } = build();
    const result = await service.report('s1', { days: 7 });
    expect(result.totals).toEqual({ pageViews: 0, peakDay: null });
  });
});
