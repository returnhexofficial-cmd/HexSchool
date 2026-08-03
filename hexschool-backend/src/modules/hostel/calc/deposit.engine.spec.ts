import { checkClearance, computeRefund } from './deposit.engine';

describe('computeRefund', () => {
  it('returns the whole deposit when nothing is withheld', () => {
    expect(computeRefund({ securityDeposit: 5000, deductions: [] })).toEqual({
      ok: true,
      refund: 5000,
      withheld: 0,
      reason: null,
    });
  });

  it('withholds what the school is keeping', () => {
    expect(
      computeRefund({
        securityDeposit: 5000,
        deductions: [{ amount: 1200, reason: 'Broken window pane' }],
      }),
    ).toEqual({ ok: true, refund: 3800, withheld: 1200, reason: null });
  });

  it('sums several deductions', () => {
    expect(
      computeRefund({
        securityDeposit: 5000,
        deductions: [
          { amount: 1200, reason: 'Broken window' },
          { amount: 300, reason: 'Unreturned key' },
        ],
      }).refund,
    ).toBe(3500);
  });

  it('caps deductions at the deposit and says what is left uncovered', () => {
    const result = computeRefund({
      securityDeposit: 5000,
      deductions: [{ amount: 8000, reason: 'Damaged door' }],
    });
    expect(result).toMatchObject({ ok: true, refund: 0, withheld: 5000 });
    expect(result.reason).toMatch(/has to be invoiced/);
  });

  it('refuses a deduction with no reason on it', () => {
    const result = computeRefund({
      securityDeposit: 5000,
      deductions: [{ amount: 500, reason: '   ' }],
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/needs a reason/);
  });

  it('allows a zero-amount line with no reason — it changes nothing', () => {
    expect(
      computeRefund({
        securityDeposit: 5000,
        deductions: [{ amount: 0, reason: '' }],
      }).ok,
    ).toBe(true);
  });

  it('refuses a negative deduction', () => {
    expect(
      computeRefund({
        securityDeposit: 5000,
        deductions: [{ amount: -100, reason: 'Goodwill' }],
      }).reason,
    ).toMatch(/cannot be negative/);
  });

  it('handles an allocation that never took a deposit', () => {
    expect(computeRefund({ securityDeposit: 0, deductions: [] })).toEqual({
      ok: true,
      refund: 0,
      withheld: 0,
      reason: null,
    });
  });

  it('refuses to deduct from a deposit that was never taken', () => {
    expect(
      computeRefund({
        securityDeposit: 0,
        deductions: [{ amount: 500, reason: 'Broken chair' }],
      }).ok,
    ).toBe(false);
  });

  it('rounds to the paisa', () => {
    expect(
      computeRefund({
        securityDeposit: 5000,
        deductions: [{ amount: 1333.333, reason: 'Share of a repair' }],
      }).refund,
    ).toBe(3666.67);
  });
});

describe('checkClearance', () => {
  const clear = {
    outstandingFees: 0,
    pendingMealOffs: 0,
    blockOnDues: true,
    override: false,
  };

  it('clears a boarder who owes nothing', () => {
    expect(checkClearance(clear)).toEqual({
      cleared: true,
      allowed: true,
      warnings: [],
      reason: null,
    });
  });

  it('warns about dues but lets them go when the block is off', () => {
    const verdict = checkClearance({
      ...clear,
      outstandingFees: 4200,
      blockOnDues: false,
    });
    expect(verdict.cleared).toBe(false);
    expect(verdict.allowed).toBe(true);
    expect(verdict.warnings[0]).toMatch(/4200/);
  });

  it('refuses when the block is on, and names the way past it', () => {
    const verdict = checkClearance({ ...clear, outstandingFees: 4200 });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/hostel\.vacate\.override/);
  });

  it('lets the override through with the decision recorded as a warning', () => {
    const verdict = checkClearance({
      ...clear,
      outstandingFees: 4200,
      override: true,
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.cleared).toBe(false);
    expect(verdict.warnings.join(' ')).toMatch(/override/);
  });

  it('warns about undecided meal-offs but never refuses over them', () => {
    const verdict = checkClearance({ ...clear, pendingMealOffs: 2 });
    expect(verdict.allowed).toBe(true);
    expect(verdict.cleared).toBe(true);
    expect(verdict.warnings[0]).toMatch(/2 meal-off request/);
  });

  it('reports both problems at once', () => {
    const verdict = checkClearance({
      ...clear,
      outstandingFees: 4200,
      pendingMealOffs: 1,
      blockOnDues: false,
    });
    expect(verdict.warnings).toHaveLength(2);
  });

  it('treats a negative dues figure as nothing owed', () => {
    // An overpaid family is not blocked from moving out.
    expect(checkClearance({ ...clear, outstandingFees: -500 }).cleared).toBe(
      true,
    );
  });
});
