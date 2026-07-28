import {
  WEBSITE_CACHE_KEYS,
  WebsiteCacheService,
} from './website-cache.service';

describe('WebsiteCacheService', () => {
  const SCHOOL = 'school-1';

  let redis: {
    getJson: jest.Mock;
    setJson: jest.Mock;
    del: jest.Mock;
  };
  let cache: WebsiteCacheService;

  beforeEach(() => {
    redis = {
      getJson: jest.fn().mockResolvedValue(null),
      setJson: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };
    cache = new WebsiteCacheService(redis as never);
  });

  it('computes and stores on a miss', async () => {
    const compute = jest.fn().mockResolvedValue({ a: 1 });
    const value = await cache.wrap(SCHOOL, 'home', 60, compute);

    expect(value).toEqual({ a: 1 });
    expect(compute).toHaveBeenCalledTimes(1);
    expect(redis.setJson).toHaveBeenCalledWith(
      'website:school-1:home',
      { a: 1 },
      60,
    );
  });

  it('serves the hit without computing', async () => {
    redis.getJson.mockResolvedValue({ cached: true });
    const compute = jest.fn();
    await expect(cache.wrap(SCHOOL, 'home', 60, compute)).resolves.toEqual({
      cached: true,
    });
    expect(compute).not.toHaveBeenCalled();
  });

  it('caches an empty payload rather than recomputing it every request', async () => {
    const compute = jest.fn().mockResolvedValue([]);
    await cache.wrap(SCHOOL, 'downloads', 60, compute);
    expect(redis.setJson).toHaveBeenCalledWith(
      'website:school-1:downloads',
      [],
      60,
    );
  });

  it('still returns a value when Redis is down', async () => {
    // RedisCacheService contains its own failures (a miss on read, a
    // no-op on write); the payload must still be produced.
    redis.getJson.mockResolvedValue(null);
    redis.setJson.mockResolvedValue(undefined);
    await expect(
      cache.wrap(SCHOOL, 'faqs', 60, () => Promise.resolve('live')),
    ).resolves.toBe('live');
  });

  it('busts EVERY known payload in one call', async () => {
    await cache.bust(SCHOOL);

    const deleted = redis.del.mock.calls[0] as string[];
    expect(redis.del).toHaveBeenCalledTimes(1);
    for (const name of WEBSITE_CACHE_KEYS) {
      expect(deleted).toContain(`website:school-1:${name}`);
    }
  });

  it('busts a key that was never read in this process', async () => {
    // The regression this guards: invalidation used to delete only the
    // names recorded in a Redis-side index, so a payload cached by an
    // earlier process (or an index write lost to a blip) survived a bust
    // and served stale published content until its TTL expired.
    await cache.bust(SCHOOL);
    expect(redis.del.mock.calls[0] as string[]).toContain(
      'website:school-1:downloads',
    );
    expect(redis.getJson).not.toHaveBeenCalled();
  });

  it('scopes every key to its school', async () => {
    await cache.bust('other-school');
    for (const key of redis.del.mock.calls[0] as string[]) {
      expect(key.startsWith('website:other-school:')).toBe(true);
    }
  });
});
