import { aggregateClearance, type ClearanceInput } from './clearance.engine';

const base: ClearanceInput = {
  type: 'TRANSFER',
  fees: {},
  requiredTypes: ['TRANSFER'],
  override: false,
};

describe('clearance.engine — aggregateClearance', () => {
  describe('a clear student', () => {
    it('clears when nothing is owed anywhere', () => {
      const verdict = aggregateClearance({
        ...base,
        fees: { amount: 0 },
        library: { amount: 0, items: 0 },
        hostel: { amount: 0, items: 0 },
      });
      expect(verdict).toMatchObject({
        cleared: true,
        allowed: true,
        required: true,
        totalOutstanding: 0,
        reason: null,
      });
      expect(verdict.blockers).toHaveLength(0);
      expect(verdict.warnings).toHaveLength(0);
    });

    it('treats an absent source as switched off, not as owing zero', () => {
      const verdict = aggregateClearance({ ...base, fees: {} });
      expect(verdict.cleared).toBe(true);
      expect(verdict.blockers).toHaveLength(0);
    });
  });

  describe('the three sources', () => {
    it('reports fee dues', () => {
      const verdict = aggregateClearance({
        ...base,
        fees: { amount: 1500 },
      });
      expect(verdict.cleared).toBe(false);
      expect(verdict.allowed).toBe(false);
      expect(verdict.blockers).toEqual([
        { source: 'FEES', amount: 1500, items: 0, details: [] },
      ]);
      expect(verdict.reason).toContain('1500.00 BDT owed to fees');
    });

    it('reports library books still out even with no fine', () => {
      const verdict = aggregateClearance({
        ...base,
        library: {
          items: 2,
          details: ['"Physics I" (A-1042) is still on loan'],
        },
      });
      expect(verdict.cleared).toBe(false);
      expect(verdict.blockers[0]).toMatchObject({
        source: 'LIBRARY',
        amount: 0,
        items: 2,
      });
      expect(verdict.warnings).toContain(
        '"Physics I" (A-1042) is still on loan',
      );
    });

    it('reports a hostel bed still held', () => {
      const verdict = aggregateClearance({
        ...base,
        hostel: { items: 1, details: ['Bed B-2, room 104, Boys Hostel'] },
      });
      expect(verdict.blockers[0].source).toBe('HOSTEL');
      expect(verdict.reason).toContain('1 item(s) still held from the hostel');
    });

    it('sums money across all three into one figure', () => {
      const verdict = aggregateClearance({
        ...base,
        fees: { amount: 1200.5 },
        library: { amount: 40.25 },
        hostel: { amount: 300 },
      });
      expect(verdict.totalOutstanding).toBe(1540.75);
      expect(verdict.blockers).toHaveLength(3);
    });

    it('rounds each source to the paisa the way M16 money does', () => {
      const verdict = aggregateClearance({
        ...base,
        fees: { amount: 0.1 + 0.2 },
      });
      expect(verdict.blockers[0].amount).toBe(0.3);
    });

    it('never reports a negative balance as a credit blocker', () => {
      const verdict = aggregateClearance({
        ...base,
        fees: { amount: -500 },
      });
      expect(verdict.cleared).toBe(true);
      expect(verdict.blockers).toHaveLength(0);
    });

    it('describes money and items together when a source has both', () => {
      const verdict = aggregateClearance({
        ...base,
        library: { amount: 60, items: 1 },
      });
      expect(verdict.reason).toContain('60.00 BDT owed to the library');
      expect(verdict.reason).toContain('1 item(s) still held from the library');
    });
  });

  describe('which types are gated', () => {
    it('refuses a TRANSFER — the document that ends the relationship', () => {
      const verdict = aggregateClearance({ ...base, fees: { amount: 100 } });
      expect(verdict.required).toBe(true);
      expect(verdict.allowed).toBe(false);
    });

    it('lets a CHARACTER certificate through, and still reports the dues', () => {
      const verdict = aggregateClearance({
        ...base,
        type: 'CHARACTER',
        fees: { amount: 100 },
      });
      expect(verdict.required).toBe(false);
      expect(verdict.cleared).toBe(false);
      expect(verdict.allowed).toBe(true);
      expect(verdict.reason).toBeNull();
      expect(verdict.blockers).toHaveLength(1);
      expect(verdict.warnings[0]).toContain('does not require clearance');
    });

    it('gates whatever the school configured', () => {
      const verdict = aggregateClearance({
        ...base,
        type: 'TESTIMONIAL',
        fees: { amount: 100 },
        requiredTypes: ['TRANSFER', 'TESTIMONIAL'],
      });
      expect(verdict.required).toBe(true);
      expect(verdict.allowed).toBe(false);
    });

    it('gates nothing when the school empties the list', () => {
      const verdict = aggregateClearance({
        ...base,
        fees: { amount: 100 },
        requiredTypes: [],
      });
      expect(verdict.allowed).toBe(true);
    });
  });

  describe('a source that could not be read', () => {
    // The defect this flag exists to prevent: a failed read returns no
    // amount and no items, which is indistinguishable from "nothing owed"
    // — so without it, a library that is down reads as a student who has
    // returned every book, and the verdict says CLEARED.
    it('never reports the student as cleared', () => {
      const verdict = aggregateClearance({
        ...base,
        library: { incomplete: true, details: ['Check with the librarian.'] },
      });
      expect(verdict.cleared).toBe(false);
      expect(verdict.complete).toBe(false);
    });

    it('warns loudly rather than refusing — the office must keep working', () => {
      const verdict = aggregateClearance({
        ...base,
        library: { incomplete: true, details: ['Check with the librarian.'] },
      });
      expect(verdict.allowed).toBe(true);
      expect(verdict.reason).toBeNull();
      expect(verdict.warnings[0]).toContain('could not be checked');
      expect(verdict.warnings).toContain('Check with the librarian.');
    });

    it('names which source failed', () => {
      expect(
        aggregateClearance({ ...base, fees: { incomplete: true } }).warnings[0],
      ).toContain('fees');
      expect(
        aggregateClearance({ ...base, hostel: { incomplete: true } })
          .warnings[0],
      ).toContain('the hostel');
    });

    it('still refuses on the sources that DID read, and reports both', () => {
      const verdict = aggregateClearance({
        ...base,
        fees: { amount: 400 },
        library: { incomplete: true },
      });
      expect(verdict.allowed).toBe(false);
      expect(verdict.complete).toBe(false);
      expect(verdict.reason).toContain('400.00 BDT owed to fees');
      expect(verdict.warnings.join(' ')).toContain('could not be checked');
    });

    it('reports complete when every source answered', () => {
      expect(
        aggregateClearance({ ...base, fees: { amount: 0 } }).complete,
      ).toBe(true);
    });
  });

  describe('the override', () => {
    it('lets an unclear TRANSFER through and says so in the warnings', () => {
      const verdict = aggregateClearance({
        ...base,
        fees: { amount: 900 },
        override: true,
      });
      expect(verdict.cleared).toBe(false);
      expect(verdict.allowed).toBe(true);
      expect(verdict.reason).toBeNull();
      expect(verdict.warnings[0]).toContain(
        'Issued under certificate.clearance.override',
      );
    });

    it('never claims the student was clear', () => {
      const verdict = aggregateClearance({
        ...base,
        fees: { amount: 900 },
        override: true,
      });
      expect(verdict.cleared).toBe(false);
      expect(verdict.totalOutstanding).toBe(900);
    });

    it('changes nothing for an already-clear student', () => {
      const withOverride = aggregateClearance({ ...base, override: true });
      const without = aggregateClearance({ ...base, override: false });
      expect(withOverride).toEqual(without);
    });
  });

  describe('the refusal message', () => {
    it('names every source and points at the override', () => {
      const verdict = aggregateClearance({
        ...base,
        fees: { amount: 500 },
        library: { items: 1 },
        hostel: { amount: 2000 },
      });
      expect(verdict.reason).toContain('500.00 BDT owed to fees');
      expect(verdict.reason).toContain('1 item(s) still held from the library');
      expect(verdict.reason).toContain('2000.00 BDT owed to the hostel');
      expect(verdict.reason).toContain('certificate.clearance.override');
    });

    it('carries each source’s own detail lines through to the panel', () => {
      const verdict = aggregateClearance({
        ...base,
        fees: { amount: 500, details: ['INV-2607-000012 due 2026-07-10'] },
        library: { items: 1, details: ['"Algebra" (A-9) on loan'] },
      });
      expect(verdict.warnings).toContain('INV-2607-000012 due 2026-07-10');
      expect(verdict.warnings).toContain('"Algebra" (A-9) on loan');
    });
  });
});
