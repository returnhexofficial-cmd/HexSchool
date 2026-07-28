import {
  AccountNode,
  buildTree,
  codeError,
  descendantIds,
  flattenTree,
  suggestCode,
  wouldCycle,
} from './coa.engine';

const node = (
  id: string,
  code: string,
  parentId: string | null = null,
  overrides: Partial<AccountNode> = {},
): AccountNode => ({
  id,
  parentId,
  group: 'ASSET',
  code,
  name: id,
  isGroup: false,
  isActive: true,
  displayOrder: 0,
  ...overrides,
});

describe('coa.engine — tree building', () => {
  const accounts = [
    node('cash', '1110', 'current'),
    node('current', '1100', 'assets', { isGroup: true }),
    node('assets', '1000', null, { isGroup: true }),
    node('bank', '1120', 'current'),
    node('income', '4000', null, { isGroup: true, group: 'INCOME' }),
  ];

  it('nests children under their parents and depths them', () => {
    const roots = buildTree(accounts);
    expect(roots.map((r) => r.account.id)).toEqual(['assets', 'income']);
    const [assets] = roots;
    expect(assets.children.map((c) => c.account.id)).toEqual(['current']);
    expect(assets.children[0].children.map((c) => c.account.id)).toEqual([
      'cash',
      'bank',
    ]);
    expect(assets.children[0].children[0].depth).toBe(2);
  });

  it('orders siblings by displayOrder then numerically by code', () => {
    const roots = buildTree([
      node('a', '1120', null, { displayOrder: 1 }),
      node('b', '1110', null, { displayOrder: 1 }),
      node('c', '1130', null, { displayOrder: 0 }),
      // Plain string sorting would put "1200" before "999".
      node('d', '999', null, { displayOrder: 0 }),
    ]);
    expect(roots.map((r) => r.account.id)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('surfaces an orphan as a root rather than dropping it', () => {
    // A dropped account is a report that silently stops reconciling —
    // strictly worse than one showing an account in an odd place.
    const roots = buildTree([node('lonely', '1500', 'missing-parent')]);
    expect(roots.map((r) => r.account.id)).toEqual(['lonely']);
  });

  it('flattens depth-first with indentation depths', () => {
    expect(
      flattenTree(buildTree(accounts)).map((r) => [r.account.id, r.depth]),
    ).toEqual([
      ['assets', 0],
      ['current', 1],
      ['cash', 2],
      ['bank', 2],
      ['income', 0],
    ]);
  });
});

describe('coa.engine — descendants and cycles', () => {
  const accounts = [
    node('root', '1000'),
    node('mid', '1100', 'root'),
    node('leaf', '1110', 'mid'),
    node('other', '2000'),
  ];

  it('collects every descendant, not just direct children', () => {
    expect([...descendantIds(accounts, 'root')].sort()).toEqual([
      'leaf',
      'mid',
    ]);
    expect([...descendantIds(accounts, 'leaf')]).toEqual([]);
  });

  it('refuses to re-parent an account under itself', () => {
    expect(wouldCycle(accounts, 'mid', 'mid')).toBe(true);
  });

  it('refuses to re-parent an account under its own descendant', () => {
    expect(wouldCycle(accounts, 'root', 'leaf')).toBe(true);
  });

  it('allows a legitimate move and a move to the root', () => {
    expect(wouldCycle(accounts, 'leaf', 'other')).toBe(false);
    expect(wouldCycle(accounts, 'leaf', null)).toBe(false);
  });

  it('terminates on an already-cyclic graph instead of hanging', () => {
    // The walk is how a cycle is DETECTED, so it must survive one.
    const cyclic = [node('a', '1', 'b'), node('b', '2', 'a')];
    expect([...descendantIds(cyclic, 'a')].sort()).toEqual(['a', 'b']);
  });
});

describe('coa.engine — code suggestion', () => {
  it('starts each group in its own thousand and strides by 100 at the root', () => {
    expect(suggestCode({ group: 'ASSET', siblings: [], depth: 0 })).toBe(
      '1100',
    );
    expect(suggestCode({ group: 'INCOME', siblings: [], depth: 0 })).toBe(
      '4100',
    );
    expect(suggestCode({ group: 'EXPENSE', siblings: [], depth: 0 })).toBe(
      '5100',
    );
  });

  it('skips codes already taken by siblings', () => {
    expect(
      suggestCode({ group: 'ASSET', siblings: ['1100', '1200'], depth: 0 }),
    ).toBe('1300');
  });

  it('strides by 10 under a parent, then by 1 deeper in', () => {
    expect(
      suggestCode({
        group: 'ASSET',
        siblings: [],
        parentCode: '1100',
        depth: 1,
      }),
    ).toBe('1110');
    expect(
      suggestCode({
        group: 'ASSET',
        siblings: ['1110'],
        parentCode: '1100',
        depth: 1,
      }),
    ).toBe('1120');
    expect(
      suggestCode({
        group: 'ASSET',
        siblings: [],
        parentCode: '1110',
        depth: 2,
      }),
    ).toBe('1111');
  });

  it('falls back to highest+1 rather than suggesting a collision', () => {
    const siblings = Array.from({ length: 10 }, (_, i) =>
      String(1100 + i * 100),
    );
    // 1100…2000 fills the thousand; the natural stride is exhausted.
    expect(suggestCode({ group: 'ASSET', siblings, depth: 0 })).toBe('2001');
  });

  it('handles a non-numeric parent code without producing nonsense', () => {
    expect(
      suggestCode({
        group: 'ASSET',
        siblings: ['CASH-1'],
        parentCode: 'CASH',
        depth: 1,
      }),
    ).toBe('CASH-2');
  });
});

describe('coa.engine — code validation', () => {
  it('accepts letters, digits and hyphens', () => {
    expect(codeError('1100')).toBeNull();
    expect(codeError('CASH-01')).toBeNull();
  });

  it('refuses empty, spaced and oddly-started codes', () => {
    expect(codeError('   ')).toContain('required');
    expect(codeError('11 00')).toContain('letters, digits and hyphens');
    expect(codeError('-1100')).toContain('letters, digits and hyphens');
  });
});
