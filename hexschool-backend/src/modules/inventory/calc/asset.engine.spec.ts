import {
  assetTagsFor,
  canTransition,
  daysBetween,
  isOnBooks,
  normalizeAssetTag,
  OFF_BOOKS_STATUSES,
  ON_BOOKS_STATUSES,
  warrantyAlerts,
  warrantyStatus,
} from './asset.engine';

const S = {
  IN_STORE: 'IN_STORE',
  ASSIGNED: 'ASSIGNED',
  UNDER_REPAIR: 'UNDER_REPAIR',
  DISPOSED: 'DISPOSED',
  LOST: 'LOST',
} as const;

describe('asset.engine', () => {
  describe('register counting — roadmap §6', () => {
    it('counts the three statuses the school still owns', () => {
      expect([...ON_BOOKS_STATUSES]).toEqual([
        S.IN_STORE,
        S.ASSIGNED,
        S.UNDER_REPAIR,
      ]);
      expect([...OFF_BOOKS_STATUSES]).toEqual([S.DISPOSED, S.LOST]);
    });

    it('excludes DISPOSED and LOST — a school that wrote off twelve chairs does not own them', () => {
      expect(isOnBooks(S.IN_STORE)).toBe(true);
      expect(isOnBooks(S.ASSIGNED)).toBe(true);
      expect(isOnBooks(S.UNDER_REPAIR)).toBe(true);
      expect(isOnBooks(S.DISPOSED)).toBe(false);
      expect(isOnBooks(S.LOST)).toBe(false);
    });
  });

  describe('canTransition', () => {
    it('allows the everyday moves out of the store', () => {
      expect(canTransition(S.IN_STORE, S.ASSIGNED).allowed).toBe(true);
      expect(canTransition(S.IN_STORE, S.UNDER_REPAIR).allowed).toBe(true);
      expect(canTransition(S.IN_STORE, S.DISPOSED).allowed).toBe(true);
    });

    it('allows a transfer, which is ASSIGNED → ASSIGNED', () => {
      // The custodian changes and the status does not — which is exactly
      // why transfer is its own endpoint rather than a status move.
      expect(canTransition(S.ASSIGNED, S.ASSIGNED).allowed).toBe(true);
    });

    it('allows a repaired unit straight back to the person who had it', () => {
      expect(canTransition(S.UNDER_REPAIR, S.ASSIGNED).allowed).toBe(true);
      expect(canTransition(S.UNDER_REPAIR, S.IN_STORE).allowed).toBe(true);
    });

    it('refuses a no-op on every status but ASSIGNED', () => {
      const verdict = canTransition(S.IN_STORE, S.IN_STORE);
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toMatch(/already in store/);
    });

    it('never lets a written-off unit come back', () => {
      // The disposal was an approved act with a name on it; quietly
      // reversing it would erase the approval (the M20 immutability rule).
      for (const from of OFF_BOOKS_STATUSES) {
        for (const to of ON_BOOKS_STATUSES) {
          const verdict = canTransition(from, to);
          expect(verdict.allowed).toBe(false);
          expect(verdict.reason).toMatch(/cannot be undone/);
          // Structural, not policy — no permission passes it.
          expect(verdict.overridePermission).toBeUndefined();
        }
      }
    });

    it('refuses DISPOSED → LOST and LOST → DISPOSED too', () => {
      expect(canTransition(S.DISPOSED, S.LOST).allowed).toBe(false);
      expect(canTransition(S.LOST, S.DISPOSED).allowed).toBe(false);
    });
  });

  describe('warrantyStatus', () => {
    const today = '2026-08-02';

    it('reports an in-cover warranty as ACTIVE with no message', () => {
      const status = warrantyStatus('2027-01-01', today, 30);
      expect(status.state).toBe('ACTIVE');
      expect(status.message).toBeNull();
      expect(status.daysLeft).toBe(152);
    });

    it('reports one inside the window as EXPIRING', () => {
      const status = warrantyStatus('2026-08-20', today, 30);
      expect(status.state).toBe('EXPIRING');
      expect(status.daysLeft).toBe(18);
      expect(status.message).toMatch(/expires in 18 day/);
    });

    it('treats the day itself as EXPIRING, not EXPIRED', () => {
      const status = warrantyStatus(today, today, 30);
      expect(status.state).toBe('EXPIRING');
      expect(status.daysLeft).toBe(0);
      expect(status.message).toBe('Warranty expires today.');
    });

    it('reports a lapsed warranty as EXPIRED with a negative count', () => {
      const status = warrantyStatus('2026-07-01', today, 30);
      expect(status.state).toBe('EXPIRED');
      expect(status.daysLeft).toBe(-32);
    });

    it('**a missing date is not a valid one** — it reports UNKNOWN, not ACTIVE', () => {
      // The projector whose warranty nobody recorded is the one most
      // likely to be out of cover when it breaks (the M25 rule).
      for (const missing of [null, undefined, '']) {
        const status = warrantyStatus(missing, today, 30);
        expect(status.state).toBe('UNKNOWN');
        expect(status.daysLeft).toBeNull();
        expect(status.message).toBe('No warranty date recorded.');
      }
    });

    it('honours the window size', () => {
      expect(warrantyStatus('2026-09-15', today, 30).state).toBe('ACTIVE');
      expect(warrantyStatus('2026-09-15', today, 90).state).toBe('EXPIRING');
    });
  });

  describe('daysBetween', () => {
    it('counts whole calendar days without a timezone in the arithmetic', () => {
      expect(daysBetween('2026-08-02', '2026-08-03')).toBe(1);
      expect(daysBetween('2026-08-03', '2026-08-02')).toBe(-1);
      expect(daysBetween('2026-08-02', '2026-08-02')).toBe(0);
    });

    it('crosses months and years', () => {
      expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
      expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
    });

    it('handles a leap day', () => {
      expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    });
  });

  describe('warrantyAlerts', () => {
    const today = '2026-08-02';
    const row = (id: string, until: string | null) => ({
      id,
      status: warrantyStatus(until, today, 30),
    });

    it('drops ACTIVE rows and sorts worst first', () => {
      const alerts = warrantyAlerts([
        row('active', '2027-06-01'),
        row('expiring', '2026-08-20'),
        row('expired', '2026-05-01'),
        row('unknown', null),
      ]);
      expect(alerts.map((a) => a.id)).toEqual([
        'expired',
        'expiring',
        'unknown',
      ]);
    });

    it('sorts UNKNOWN with the alerts rather than at the bottom', () => {
      const alerts = warrantyAlerts([
        row('unknown', null),
        row('active', '2028-01-01'),
      ]);
      expect(alerts.map((a) => a.id)).toEqual(['unknown']);
    });

    it('orders several expired rows by how long ago they lapsed', () => {
      const alerts = warrantyAlerts([
        row('recent', '2026-07-20'),
        row('ancient', '2024-01-01'),
      ]);
      expect(alerts.map((a) => a.id)).toEqual(['ancient', 'recent']);
    });
  });

  describe('normalizeAssetTag', () => {
    it('matches what the unique index sees — upper(btrim(...))', () => {
      // Two implementations of that comparison is how a 409 turns into a
      // 500 on a constraint violation.
      expect(normalizeAssetTag('  ast-0001 ')).toBe('AST-0001');
      expect(normalizeAssetTag('AST-0001')).toBe('AST-0001');
    });
  });

  describe('assetTagsFor', () => {
    const render = (pattern: string, seq: number) =>
      pattern.replace('{SEQ}', String(seq).padStart(5, '0'));

    it('renders a contiguous batch from a claimed start', () => {
      expect(assetTagsFor('AST-{SEQ}', 7, 3, render)).toEqual([
        'AST-00007',
        'AST-00008',
        'AST-00009',
      ]);
    });

    it('normalizes every tag it emits', () => {
      expect(assetTagsFor('ast-{SEQ}', 1, 1, render)).toEqual(['AST-00001']);
    });

    it('produces nothing for a zero or negative count', () => {
      expect(assetTagsFor('AST-{SEQ}', 1, 0, render)).toEqual([]);
      expect(assetTagsFor('AST-{SEQ}', 1, -5, render)).toEqual([]);
    });
  });
});
