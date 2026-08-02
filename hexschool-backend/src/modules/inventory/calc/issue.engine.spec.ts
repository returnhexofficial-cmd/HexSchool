import {
  canIssue,
  canReturn,
  deriveIssueStatus,
  outstandingLines,
  type IssueLineContext,
  type ReturnLineContext,
} from './issue.engine';

const item = (over: Partial<IssueLineContext> = {}): IssueLineContext => ({
  itemId: 'i1',
  itemName: 'A4 Paper',
  itemCode: 'STA-001',
  type: 'CONSUMABLE',
  unit: 'REAM',
  available: 20,
  ...over,
});

const ctx = (items: IssueLineContext[]) =>
  new Map(items.map((row) => [row.itemId, row]));

const returnRow = (
  over: Partial<ReturnLineContext> = {},
): ReturnLineContext => ({
  issueItemId: 'l1',
  itemId: 'i1',
  itemName: 'A4 Paper',
  unit: 'REAM',
  issued: 10,
  returned: 0,
  ...over,
});

describe('issue.engine', () => {
  describe('canIssue', () => {
    it('allows a line inside the balance and normalizes it', () => {
      const verdict = canIssue([{ itemId: 'i1', quantity: 5 }], ctx([item()]));
      expect(verdict.allowed).toBe(true);
      expect(verdict.refusals).toEqual([]);
      expect(verdict.lines).toEqual([{ itemId: 'i1', quantity: 5 }]);
    });

    it('allows issuing the whole balance', () => {
      expect(
        canIssue([{ itemId: 'i1', quantity: 20 }], ctx([item()])).allowed,
      ).toBe(true);
    });

    it('refuses more than is on hand, naming the shortfall', () => {
      const verdict = canIssue([{ itemId: 'i1', quantity: 25 }], ctx([item()]));
      expect(verdict.allowed).toBe(false);
      expect(verdict.refusals[0].reason).toBe(
        'Only 20 REAM on hand — 25 cannot be issued.',
      );
    });

    it('refuses an ASSET outright — assets are assigned, not issued by quantity', () => {
      const verdict = canIssue(
        [{ itemId: 'i1', quantity: 1 }],
        ctx([item({ type: 'ASSET', itemName: 'Projector' })]),
      );
      expect(verdict.allowed).toBe(false);
      expect(verdict.refusals[0].reason).toMatch(/asset register/);
    });

    it('refuses an unknown item', () => {
      const verdict = canIssue(
        [{ itemId: 'ghost', quantity: 1 }],
        ctx([item()]),
      );
      expect(verdict.allowed).toBe(false);
      expect(verdict.refusals[0].reason).toMatch(/not in the catalogue/);
    });

    it('refuses the same item listed twice, and says to combine them', () => {
      const verdict = canIssue(
        [
          { itemId: 'i1', quantity: 5 },
          { itemId: 'i1', quantity: 3 },
        ],
        ctx([item()]),
      );
      expect(verdict.allowed).toBe(false);
      expect(verdict.refusals[0].reason).toMatch(/twice/);
    });

    it('refuses an empty slip', () => {
      const verdict = canIssue([], ctx([item()]));
      expect(verdict.allowed).toBe(false);
      expect(verdict.lines).toEqual([]);
    });

    it('refuses a fractional quantity of a counted unit', () => {
      const verdict = canIssue(
        [{ itemId: 'i1', quantity: 2.5 }],
        ctx([item({ unit: 'PCS' })]),
      );
      expect(verdict.allowed).toBe(false);
      expect(verdict.refusals[0].reason).toMatch(/whole units/);
    });

    it('allows a fractional quantity of litres', () => {
      expect(
        canIssue(
          [{ itemId: 'i1', quantity: 0.5 }],
          ctx([item({ unit: 'LITER', available: 5 })]),
        ).allowed,
      ).toBe(true);
    });

    it('reports EVERY bad line at once, not just the first', () => {
      // The M22 bulk-grid rule: a store keeper filling a six-item slip
      // should be told about all the problems in one go.
      const verdict = canIssue(
        [
          { itemId: 'i1', quantity: 999 },
          { itemId: 'i2', quantity: 1 },
          { itemId: 'i3', quantity: 0 },
        ],
        ctx([
          item(),
          item({ itemId: 'i2', itemName: 'Projector', type: 'ASSET' }),
          item({ itemId: 'i3', itemName: 'Chalk', available: 100 }),
        ]),
      );
      expect(verdict.allowed).toBe(false);
      expect(verdict.refusals).toHaveLength(3);
      expect(verdict.refusals.map((r) => r.itemName)).toEqual([
        'A4 Paper',
        'Projector',
        'Chalk',
      ]);
    });

    it('is all-or-nothing — one bad line refuses the whole slip', () => {
      const verdict = canIssue(
        [
          { itemId: 'i1', quantity: 5 },
          { itemId: 'i2', quantity: 999 },
        ],
        ctx([item(), item({ itemId: 'i2', itemName: 'Chalk', available: 10 })]),
      );
      expect(verdict.allowed).toBe(false);
      // The good line is still reported, so the UI can keep it green
      // while the bad one is red.
      expect(verdict.lines).toEqual([{ itemId: 'i1', quantity: 5 }]);
    });
  });

  describe('canReturn', () => {
    it('allows a return inside what went out', () => {
      const verdict = canReturn(
        [{ issueItemId: 'l1', quantity: 4 }],
        new Map([['l1', returnRow()]]),
      );
      expect(verdict.allowed).toBe(true);
      expect(verdict.lines).toEqual([
        { issueItemId: 'l1', itemId: 'i1', quantity: 4 },
      ]);
    });

    it('allows returning everything still out', () => {
      expect(
        canReturn(
          [{ issueItemId: 'l1', quantity: 6 }],
          new Map([['l1', returnRow({ issued: 10, returned: 4 })]]),
        ).allowed,
      ).toBe(true);
    });

    it('refuses more than went out — the excess would be stock nobody bought', () => {
      const verdict = canReturn(
        [{ issueItemId: 'l1', quantity: 11 }],
        new Map([['l1', returnRow()]]),
      );
      expect(verdict.allowed).toBe(false);
      expect(verdict.refusals[0].reason).toBe(
        'Only 10 REAM of that line is still out.',
      );
    });

    it('accounts for what has already come back', () => {
      const verdict = canReturn(
        [{ issueItemId: 'l1', quantity: 5 }],
        new Map([['l1', returnRow({ issued: 10, returned: 8 })]]),
      );
      expect(verdict.allowed).toBe(false);
      expect(verdict.refusals[0].reason).toBe(
        'Only 2 REAM of that line is still out.',
      );
    });

    it('says so plainly when a line is fully back', () => {
      const verdict = canReturn(
        [{ issueItemId: 'l1', quantity: 1 }],
        new Map([['l1', returnRow({ issued: 10, returned: 10 })]]),
      );
      expect(verdict.refusals[0].reason).toMatch(/already come back/);
    });

    it('refuses a line that is not on the slip', () => {
      const verdict = canReturn(
        [{ issueItemId: 'other', quantity: 1 }],
        new Map([['l1', returnRow()]]),
      );
      expect(verdict.allowed).toBe(false);
      expect(verdict.refusals[0].reason).toMatch(/not on this issue slip/);
    });

    it('refuses an empty return', () => {
      expect(canReturn([], new Map()).allowed).toBe(false);
    });

    it('refuses a duplicated line', () => {
      const verdict = canReturn(
        [
          { issueItemId: 'l1', quantity: 2 },
          { issueItemId: 'l1', quantity: 3 },
        ],
        new Map([['l1', returnRow()]]),
      );
      expect(verdict.allowed).toBe(false);
      expect(verdict.refusals[0].reason).toMatch(/twice/);
    });
  });

  describe('deriveIssueStatus — computed, never assigned', () => {
    it('is ISSUED when nothing has come back', () => {
      expect(
        deriveIssueStatus([
          { qty: 10, returnedQty: 0 },
          { qty: 5, returnedQty: 0 },
        ]),
      ).toBe('ISSUED');
    });

    it('is RETURNED only when every line is fully back', () => {
      expect(
        deriveIssueStatus([
          { qty: 10, returnedQty: 10 },
          { qty: 5, returnedQty: 5 },
        ]),
      ).toBe('RETURNED');
    });

    it('is PARTIAL_RETURN when one line is short by a single unit', () => {
      // Three lines complete and one short is still outstanding stores,
      // and a school chasing them needs the slip to say so.
      expect(
        deriveIssueStatus([
          { qty: 10, returnedQty: 10 },
          { qty: 10, returnedQty: 10 },
          { qty: 10, returnedQty: 10 },
          { qty: 10, returnedQty: 9 },
        ]),
      ).toBe('PARTIAL_RETURN');
    });

    it('is PARTIAL_RETURN when one line has come back and another has not', () => {
      expect(
        deriveIssueStatus([
          { qty: 10, returnedQty: 10 },
          { qty: 5, returnedQty: 0 },
        ]),
      ).toBe('PARTIAL_RETURN');
    });

    it('treats a slip with no lines as ISSUED rather than RETURNED', () => {
      // Vacuously "all returned" would mark an empty slip complete, which
      // is the wrong default for a document somebody is still filling in.
      expect(deriveIssueStatus([])).toBe('ISSUED');
    });

    it('handles fractional returns', () => {
      expect(deriveIssueStatus([{ qty: 2.5, returnedQty: 2.5 }])).toBe(
        'RETURNED',
      );
      expect(deriveIssueStatus([{ qty: 2.5, returnedQty: 1.25 }])).toBe(
        'PARTIAL_RETURN',
      );
    });
  });

  describe('outstandingLines', () => {
    it('lists what is still out, dropping settled lines', () => {
      expect(
        outstandingLines([
          { issueItemId: 'l1', qty: 10, returnedQty: 10 },
          { issueItemId: 'l2', qty: 10, returnedQty: 4 },
          { issueItemId: 'l3', qty: 5, returnedQty: 0 },
        ]),
      ).toEqual([
        { issueItemId: 'l2', outstanding: 6 },
        { issueItemId: 'l3', outstanding: 5 },
      ]);
    });

    it('is empty for a fully returned slip', () => {
      expect(
        outstandingLines([{ issueItemId: 'l1', qty: 3, returnedQty: 3 }]),
      ).toEqual([]);
    });
  });
});
