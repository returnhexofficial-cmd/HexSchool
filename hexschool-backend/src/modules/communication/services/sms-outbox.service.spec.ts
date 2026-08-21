import { SmsOutboxService } from './sms-outbox.service';

/**
 * The outbox holds OTPs and temporary passwords in memory, so the thing worth
 * testing hardest is that it stays **off** unless deliberately switched on,
 * and can never be switched on in production.
 */
describe('SmsOutboxService', () => {
  const NODE_ENV = process.env.NODE_ENV;
  const FLAG = process.env.SMS_DEV_OUTBOX;

  const withEnv = (env: string | undefined, flag: string | undefined) => {
    if (env === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = env;
    if (flag === undefined) delete process.env.SMS_DEV_OUTBOX;
    else process.env.SMS_DEV_OUTBOX = flag;
    return new SmsOutboxService();
  };

  afterEach(() => {
    process.env.NODE_ENV = NODE_ENV;
    if (FLAG === undefined) delete process.env.SMS_DEV_OUTBOX;
    else process.env.SMS_DEV_OUTBOX = FLAG;
  });

  describe('enablement', () => {
    it('is off by default in development', () => {
      expect(withEnv('development', undefined).enabled).toBe(false);
    });

    it('is on in development with the explicit flag', () => {
      expect(withEnv('development', 'true').enabled).toBe(true);
    });

    it('is NEVER on in production, even with the flag set', () => {
      expect(withEnv('production', 'true').enabled).toBe(false);
    });

    it('ignores any value other than the exact string "true"', () => {
      for (const v of ['TRUE', 'True', '1', 'yes', '']) {
        expect(withEnv('development', v).enabled).toBe(false);
      }
    });
  });

  describe('recording', () => {
    it('records nothing at all while disabled', () => {
      const outbox = withEnv('development', undefined);
      outbox.record('01700000000', 'Your code is 123456');
      expect(outbox.list()).toEqual([]);
    });

    it('drops the body on the floor in production', () => {
      const outbox = withEnv('production', 'true');
      outbox.record('01700000000', 'Your code is 123456');
      expect(outbox.list()).toEqual([]);
    });

    it('keeps the body when enabled, newest first', () => {
      const outbox = withEnv('development', 'true');
      outbox.record('01700000001', 'first');
      outbox.record('01700000002', 'second');
      expect(outbox.list().map((m) => m.text)).toEqual(['second', 'first']);
    });

    it('filters by recipient', () => {
      const outbox = withEnv('development', 'true');
      outbox.record('01700000001', 'for one');
      outbox.record('01700000002', 'for two');
      expect(outbox.list('01700000002').map((m) => m.text)).toEqual([
        'for two',
      ]);
    });

    it('is bounded so a long-running dev server cannot grow it forever', () => {
      const outbox = withEnv('development', 'true');
      for (let i = 0; i < 120; i += 1) outbox.record('0170', `msg ${i}`);
      const all = outbox.list();
      expect(all).toHaveLength(50);
      // The cap must drop the OLDEST, not the newest.
      expect(all[0].text).toBe('msg 119');
    });
  });
});
