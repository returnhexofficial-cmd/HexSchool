/**
 * Chart-of-accounts structure rules (roadmap M20 §3/§5), dependency-free.
 *
 * The COA is a tree per school, but a tree with two invariants a plain
 * parent pointer does not give you: a child never leaves its parent's
 * top-level group (an expense filed under Assets would silently move
 * money between two statements), and the graph stays acyclic (a cycle
 * makes every subtotal an infinite loop, and the recursive walk that
 * builds a balance sheet would never terminate).
 */

export interface AccountNode {
  id: string;
  parentId: string | null;
  group: string;
  code: string;
  name: string;
  isGroup: boolean;
  isActive: boolean;
  displayOrder: number;
}

export interface AccountTreeNode<T extends AccountNode = AccountNode> {
  account: T;
  children: AccountTreeNode<T>[];
  /** 0 for a root. */
  depth: number;
}

/** Code ranges each group's accounts live in — the BD/standard convention. */
export const GROUP_CODE_BASE: Readonly<Record<string, number>> = {
  ASSET: 1000,
  LIABILITY: 2000,
  EQUITY: 3000,
  INCOME: 4000,
  EXPENSE: 5000,
};

export const ACCOUNT_GROUPS = [
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'INCOME',
  'EXPENSE',
] as const;

/**
 * Build the forest, ordered by `displayOrder` then `code` at every level.
 *
 * Nodes whose parent is missing from the input (filtered out, soft-deleted,
 * belonging to another school) surface as roots rather than vanishing —
 * a report that silently drops accounts is worse than one that shows an
 * account in an odd place, because the totals stop reconciling with no
 * visible cause.
 */
export function buildTree<T extends AccountNode>(
  accounts: T[],
): AccountTreeNode<T>[] {
  const byId = new Map<string, AccountTreeNode<T>>();
  for (const account of accounts) {
    byId.set(account.id, { account, children: [], depth: 0 });
  }

  const roots: AccountTreeNode<T>[] = [];
  for (const node of byId.values()) {
    const parentId = node.account.parentId;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sort = (nodes: AccountTreeNode<T>[], depth: number): void => {
    nodes.sort(
      (a, b) =>
        a.account.displayOrder - b.account.displayOrder ||
        a.account.code.localeCompare(b.account.code, 'en', { numeric: true }),
    );
    for (const node of nodes) {
      node.depth = depth;
      sort(node.children, depth + 1);
    }
  };
  sort(roots, 0);

  return roots;
}

/** Depth-first flatten, so a table can render the tree with indentation. */
export function flattenTree<T extends AccountNode>(
  roots: AccountTreeNode<T>[],
): Array<{ account: T; depth: number }> {
  const out: Array<{ account: T; depth: number }> = [];
  const walk = (nodes: AccountTreeNode<T>[]): void => {
    for (const node of nodes) {
      out.push({ account: node.account, depth: node.depth });
      walk(node.children);
    }
  };
  walk(roots);
  return out;
}

/** Every descendant id of `rootId`, excluding the root itself. */
export function descendantIds(
  accounts: AccountNode[],
  rootId: string,
): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const account of accounts) {
    if (!account.parentId) continue;
    const siblings = childrenOf.get(account.parentId) ?? [];
    siblings.push(account.id);
    childrenOf.set(account.parentId, siblings);
  }

  const found = new Set<string>();
  const stack = [...(childrenOf.get(rootId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    // A pre-existing cycle would loop forever without this guard; the
    // walk is also how we DETECT one (`wouldCycle` below), so it must be
    // safe to run on a graph that is not yet known to be acyclic.
    if (found.has(id)) continue;
    found.add(id);
    stack.push(...(childrenOf.get(id) ?? []));
  }
  return found;
}

/**
 * Would re-parenting `accountId` under `newParentId` create a cycle?
 *
 * True when the proposed parent is the account itself or one of its
 * descendants. The DB CHECK only catches the self-parent case — the
 * deeper one needs the whole tree, which is why it lives here and is
 * called from `AccountsService`.
 */
export function wouldCycle(
  accounts: AccountNode[],
  accountId: string,
  newParentId: string | null,
): boolean {
  if (!newParentId) return false;
  if (newParentId === accountId) return true;
  return descendantIds(accounts, accountId).has(newParentId);
}

/**
 * The next free code under a parent (or at the root of a group).
 *
 * Roots step by 100 inside their group's thousand (1000 → 1100 → 1200),
 * children by 10 then by 1 as the tree deepens, which keeps sibling codes
 * sorted and leaves room to insert. When the natural stride is exhausted
 * it falls back to "highest sibling + 1", because a suggestion that
 * collides is worse than an ugly one.
 */
export function suggestCode(params: {
  group: string;
  siblings: string[];
  parentCode?: string | null;
  depth: number;
}): string {
  const numeric = params.siblings
    .map((code) => Number.parseInt(code, 10))
    .filter((value) => Number.isFinite(value));

  if (!params.parentCode) {
    const base = GROUP_CODE_BASE[params.group] ?? 9000;
    const stride = 100;
    let candidate = base + stride;
    while (numeric.includes(candidate) && candidate < base + 1000) {
      candidate += stride;
    }
    if (candidate >= base + 1000) {
      candidate = numeric.length > 0 ? Math.max(...numeric) + 1 : base + 1;
    }
    return String(candidate);
  }

  const parent = Number.parseInt(params.parentCode, 10);
  if (!Number.isFinite(parent)) {
    return `${params.parentCode}-${params.siblings.length + 1}`;
  }

  const stride = params.depth <= 1 ? 10 : 1;
  let candidate = parent + stride;
  const ceiling = parent + stride * 99;
  while (numeric.includes(candidate) && candidate <= ceiling) {
    candidate += stride;
  }
  if (candidate > ceiling) {
    candidate = numeric.length > 0 ? Math.max(...numeric) + 1 : parent + 1;
  }
  return String(candidate);
}

const CODE_SHAPE = /^[A-Za-z0-9][A-Za-z0-9-]{0,19}$/;

/** `null` when the code is usable, else why not. */
export function codeError(code: string): string | null {
  const trimmed = code.trim();
  if (trimmed.length === 0) return 'An account code is required';
  if (!CODE_SHAPE.test(trimmed)) {
    return 'An account code may contain letters, digits and hyphens only, and must start with a letter or digit';
  }
  return null;
}
