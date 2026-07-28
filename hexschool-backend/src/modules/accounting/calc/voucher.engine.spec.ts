import {
  AccountFacts,
  DraftEntry,
  balanceError,
  creditTotal,
  debitTotal,
  firstProblemMessage,
  hasProblems,
  naturalSide,
  reverseEntries,
  reversalType,
  shapeError,
  sideOf,
  signedMovement,
  validateEntries,
  validateVoucher,
} from './voucher.engine';

const CASH = 'acc-cash';
const BANK = 'acc-bank';
const TUITION = 'acc-tuition';
const HEADING = 'acc-heading';
const CLOSED = 'acc-closed';

const facts = (
  overrides: Partial<AccountFacts> & { id: string },
): AccountFacts => ({
  isGroup: false,
  isActive: true,
  code: '1000',
  name: 'Account',
  ...overrides,
});

const ACCOUNTS = new Map<string, AccountFacts>([
  [CASH, facts({ id: CASH, code: '1100', name: 'Cash in Hand' })],
  [BANK, facts({ id: BANK, code: '1200', name: 'Bank' })],
  [TUITION, facts({ id: TUITION, code: '4100', name: 'Tuition Income' })],
  [
    HEADING,
    facts({ id: HEADING, code: '4000', name: 'Income', isGroup: true }),
  ],
  [
    CLOSED,
    facts({ id: CLOSED, code: '5900', name: 'Old Expense', isActive: false }),
  ],
]);

const TYPES = new Map<string, string>([
  [CASH, 'CASH'],
  [BANK, 'BANK'],
  [TUITION, 'INCOME'],
  [HEADING, 'INCOME'],
  [CLOSED, 'EXPENSE'],
]);

const line = (
  accountId: string,
  debit: number,
  credit: number,
): DraftEntry => ({ accountId, debit, credit });

describe('voucher.engine — totals and balance', () => {
  it('sums each side rounding per line, not only at the end', () => {
    const entries = [
      line(CASH, 33.333, 0),
      line(CASH, 33.333, 0),
      line(TUITION, 0, 66.67),
    ];
    // 33.33 + 33.33 = 66.66, which is NOT 66.67 — the point of the test
    // is that the engine reports the drift rather than hiding it.
    expect(debitTotal(entries)).toBe(66.66);
    expect(creditTotal(entries)).toBe(66.67);
    expect(balanceError(entries)).toEqual({
      debitTotal: 66.66,
      creditTotal: 66.67,
      difference: -0.01,
    });
  });

  it('accepts a voucher that balances exactly', () => {
    expect(
      balanceError([line(CASH, 1500, 0), line(TUITION, 0, 1500)]),
    ).toBeNull();
  });

  it('accepts a multi-line voucher that balances across several accounts', () => {
    const entries = [
      line(CASH, 1000, 0),
      line(BANK, 500, 0),
      line(TUITION, 0, 1200),
      line(TUITION, 0, 300),
    ];
    expect(balanceError(entries)).toBeNull();
  });

  it('reports the direction of the imbalance, not just its size', () => {
    const over = balanceError([line(CASH, 100, 0), line(TUITION, 0, 90)]);
    const under = balanceError([line(CASH, 90, 0), line(TUITION, 0, 100)]);
    expect(over?.difference).toBe(10);
    expect(under?.difference).toBe(-10);
  });

  it('treats an empty voucher as balanced (nothing is out of balance)', () => {
    // The "must have at least two lines" rule belongs to the service, not
    // to arithmetic — this documents the split rather than asserting a bug.
    expect(balanceError([])).toBeNull();
  });

  it('reads the side of a line', () => {
    expect(sideOf(line(CASH, 10, 0))).toBe('DEBIT');
    expect(sideOf(line(CASH, 0, 10))).toBe('CREDIT');
  });
});

describe('voucher.engine — per-line validation', () => {
  it('refuses a line carrying both a debit and a credit', () => {
    const [problem] = validateEntries([line(CASH, 10, 10)], ACCOUNTS);
    expect(problem.code).toBe('BOTH_SIDES');
  });

  it('refuses an empty line', () => {
    const [problem] = validateEntries([line(CASH, 0, 0)], ACCOUNTS);
    expect(problem.code).toBe('EMPTY');
  });

  it('refuses a negative amount — it is the opposite side in disguise', () => {
    const [problem] = validateEntries([line(CASH, -10, 0)], ACCOUNTS);
    expect(problem.code).toBe('NEGATIVE');
  });

  it('refuses posting to a heading (roadmap §7: leaf-only posting)', () => {
    const [problem] = validateEntries([line(HEADING, 10, 0)], ACCOUNTS);
    expect(problem.code).toBe('GROUP_NODE');
    expect(problem.message).toContain('4000 Income is a heading');
  });

  it('refuses an inactive account', () => {
    const [problem] = validateEntries([line(CLOSED, 10, 0)], ACCOUNTS);
    expect(problem.code).toBe('INACTIVE');
  });

  it('refuses an account from another school (absent from the map)', () => {
    const [problem] = validateEntries([line('stranger', 10, 0)], ACCOUNTS);
    expect(problem.code).toBe('UNKNOWN_ACCOUNT');
  });

  it('reports every bad line at once, with its index (M15 rule)', () => {
    const problems = validateEntries(
      [line(CASH, 100, 0), line(HEADING, 0, 50), line(CLOSED, 0, 50)],
      ACCOUNTS,
    );
    expect(problems.map((p) => p.index)).toEqual([1, 2]);
  });
});

describe('voucher.engine — voucher shape by type', () => {
  it('a receipt must debit cash or bank', () => {
    expect(
      shapeError('CREDIT', [line(CASH, 500, 0), line(TUITION, 0, 500)], TYPES),
    ).toBeNull();
    expect(
      shapeError(
        'CREDIT',
        [line(TUITION, 500, 0), line(CLOSED, 0, 500)],
        TYPES,
      ),
    ).toContain('debit a cash or bank account');
  });

  it('a payment must credit cash or bank', () => {
    expect(
      shapeError('DEBIT', [line(CLOSED, 500, 0), line(BANK, 0, 500)], TYPES),
    ).toBeNull();
    expect(
      shapeError('DEBIT', [line(CASH, 500, 0), line(TUITION, 0, 500)], TYPES),
    ).toContain('credit a cash or bank account');
  });

  it('a contra moves money only between the school’s own funds accounts', () => {
    expect(
      shapeError('CONTRA', [line(BANK, 2000, 0), line(CASH, 0, 2000)], TYPES),
    ).toBeNull();
    expect(
      shapeError(
        'CONTRA',
        [line(BANK, 2000, 0), line(TUITION, 0, 2000)],
        TYPES,
      ),
    ).toContain('CASH or BANK');
  });

  it('a journal is deliberately unconstrained', () => {
    expect(
      shapeError('JOURNAL', [line(TUITION, 10, 0), line(CLOSED, 0, 10)], TYPES),
    ).toBeNull();
  });
});

describe('voucher.engine — validateVoucher', () => {
  const check = (
    type: 'DEBIT' | 'CREDIT' | 'JOURNAL' | 'CONTRA',
    entries: DraftEntry[],
  ) =>
    validateVoucher({ type, entries, accounts: ACCOUNTS, accountTypes: TYPES });

  it('passes a clean receipt', () => {
    const problems = check('CREDIT', [
      line(CASH, 1500, 0),
      line(TUITION, 0, 1500),
    ]);
    expect(hasProblems(problems)).toBe(false);
  });

  it('does not judge balance while a line is malformed', () => {
    // A "both sides" line makes the balance verdict meaningless — showing
    // an imbalance the operator did not cause would send them hunting the
    // wrong thing.
    const problems = check('CREDIT', [line(CASH, 10, 10)]);
    expect(problems.entries).toHaveLength(1);
    expect(problems.balance).toBeNull();
    expect(problems.shape).toBeNull();
  });

  it('explains an imbalance with both totals', () => {
    const problems = check('CREDIT', [
      line(CASH, 1500, 0),
      line(TUITION, 0, 1200),
    ]);
    expect(firstProblemMessage(problems)).toBe(
      'Debits (1500.00) and credits (1200.00) differ by 300.00 — a voucher must balance exactly before it can be posted',
    );
  });
});

describe('voucher.engine — reversal', () => {
  it('swaps every side and stays balanced by construction', () => {
    const original = [
      line(CASH, 1000, 0),
      line(BANK, 500, 0),
      line(TUITION, 0, 1500),
    ];
    const reversed = reverseEntries(original);
    expect(reversed).toEqual([
      { accountId: CASH, debit: 0, credit: 1000, narration: null },
      { accountId: BANK, debit: 0, credit: 500, narration: null },
      { accountId: TUITION, debit: 1500, credit: 0, narration: null },
    ]);
    expect(balanceError(reversed)).toBeNull();
  });

  it('keeps line order so the two documents read as mirror images', () => {
    const original = [
      line(CASH, 10, 0),
      line(BANK, 20, 0),
      line(TUITION, 0, 30),
    ];
    expect(reverseEntries(original).map((e) => e.accountId)).toEqual([
      CASH,
      BANK,
      TUITION,
    ]);
  });

  it('reversing twice returns the original', () => {
    const original = [line(CASH, 1000, 0), line(TUITION, 0, 1000)];
    expect(reverseEntries(reverseEntries(original))).toEqual(
      original.map((entry) => ({ ...entry, narration: null })),
    );
  });

  it('a payment reverses as a receipt, and symmetric types stay put', () => {
    expect(reversalType('DEBIT')).toBe('CREDIT');
    expect(reversalType('CREDIT')).toBe('DEBIT');
    expect(reversalType('JOURNAL')).toBe('JOURNAL');
    expect(reversalType('CONTRA')).toBe('CONTRA');
  });
});

describe('voucher.engine — natural sides', () => {
  it('assets and expenses are debit-normal; the rest are credit-normal', () => {
    expect(naturalSide('ASSET')).toBe('DEBIT');
    expect(naturalSide('EXPENSE')).toBe('DEBIT');
    expect(naturalSide('LIABILITY')).toBe('CREDIT');
    expect(naturalSide('EQUITY')).toBe('CREDIT');
    expect(naturalSide('INCOME')).toBe('CREDIT');
  });

  it('a debit grows an asset and shrinks an income account', () => {
    expect(signedMovement('ASSET', 500, 0)).toBe(500);
    expect(signedMovement('INCOME', 500, 0)).toBe(-500);
    expect(signedMovement('INCOME', 0, 500)).toBe(500);
    expect(signedMovement('EXPENSE', 0, 500)).toBe(-500);
  });
});
