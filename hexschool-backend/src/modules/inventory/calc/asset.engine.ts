/**
 * The asset lifecycle (roadmap M24 §3 asset_units, §4 "asset assignment /
 * transfer / repair / disposal", §6 "DISPOSED/LOST excluded from register
 * counts; disposal needs approval permission", §7 "warranty date ≥
 * purchase date").
 *
 * Dependency-free and golden-tested.
 *
 * The governing idea is that **an asset's status is a position in a life,
 * not a flag**. A projector goes into the store, out to a room, into the
 * workshop, back to the store, and eventually off the books — and the
 * transitions that are *not* allowed are the ones that would let the
 * register lie: bringing a written-off unit back without a word, or
 * assigning something the school has already declared lost.
 *
 * Which of those refusals is structural and which is policy follows the
 * M13/M14/M23 split, and is stated per transition below.
 */

import type { AssetStatus } from './types';

/**
 * Units that are still the school's property to move around. Roadmap §6:
 * DISPOSED and LOST are **excluded from register counts** — a school that
 * writes off twelve chairs must not still be told it owns them, which is
 * the whole reason the counting query cares about status at all.
 */
export const ON_BOOKS_STATUSES: readonly AssetStatus[] = [
  'IN_STORE',
  'ASSIGNED',
  'UNDER_REPAIR',
];

export const OFF_BOOKS_STATUSES: readonly AssetStatus[] = ['DISPOSED', 'LOST'];

export function isOnBooks(status: AssetStatus): boolean {
  return ON_BOOKS_STATUSES.includes(status);
}

/**
 * The allowed moves.
 *
 * Note what is missing: there is no edge **out of** DISPOSED or LOST. A
 * written-off unit that turns up in a cupboard is not "un-disposed" — the
 * school records a new unit with its own tag, because the disposal was an
 * approved act with a name on it and quietly reversing it would erase the
 * approval. That is the M20 immutability rule applied to things: the
 * correction is a new document, never an edit of the old one.
 */
const TRANSITIONS: Readonly<Record<AssetStatus, readonly AssetStatus[]>> = {
  ['IN_STORE']: ['ASSIGNED', 'UNDER_REPAIR', 'DISPOSED', 'LOST'],
  ['ASSIGNED']: [
    // Transfer is ASSIGNED → ASSIGNED: the custodian changes, the
    // status does not, which is exactly why `transfer` is its own
    // endpoint rather than a status move.
    'ASSIGNED',
    'IN_STORE',
    'UNDER_REPAIR',
    'DISPOSED',
    'LOST',
  ],
  ['UNDER_REPAIR']: [
    'IN_STORE',
    // Straight back to the person who had it — the common case, and
    // forcing it through the store would make the register briefly lie
    // about where the thing is.
    'ASSIGNED',
    'DISPOSED',
    'LOST',
  ],
  ['DISPOSED']: [],
  ['LOST']: [],
};

export interface TransitionVerdict {
  allowed: boolean;
  reason: string | null;
  /** Set when the refusal is a POLICY one a permission can pass. */
  overridePermission?: string;
}

export function canTransition(
  from: AssetStatus,
  to: AssetStatus,
): TransitionVerdict {
  if (from === to && to !== 'ASSIGNED') {
    return { allowed: false, reason: `The unit is already ${label(from)}.` };
  }
  if (TRANSITIONS[from].includes(to)) {
    return { allowed: true, reason: null };
  }
  // Structural, not policy: no permission brings a written-off unit back,
  // because the write-off was somebody's signature.
  if (OFF_BOOKS_STATUSES.includes(from)) {
    return {
      allowed: false,
      reason: `This unit was recorded as ${label(from)} — that cannot be undone. Register a new unit if it has turned up.`,
    };
  }
  return {
    allowed: false,
    reason: `A unit that is ${label(from)} cannot become ${label(to)}.`,
  };
}

function label(status: AssetStatus): string {
  return status.toLowerCase().replace(/_/g, ' ');
}

// ── warranty ─────────────────────────────────────────────────────────

export type WarrantyState = 'UNKNOWN' | 'ACTIVE' | 'EXPIRING' | 'EXPIRED';

export interface WarrantyStatus {
  state: WarrantyState;
  until: string | null;
  /** Negative once expired; `null` when no date is recorded. */
  daysLeft: number | null;
  message: string | null;
}

/**
 * Roadmap §4's warranty-expiring report, in the shape M25's
 * `expiry.engine.ts` established — and with the same load-bearing rule:
 * **a missing date is not a valid one.** It reports UNKNOWN and shows up
 * in the list, because the projector whose warranty nobody recorded is
 * the one most likely to be out of cover when it breaks. A truthy/falsy
 * implementation lets exactly that row pass every check silently.
 *
 * Dates are `YYYY-MM-DD` strings throughout, compared lexicographically —
 * which is correct for ISO dates and, more importantly, keeps a timezone
 * out of arithmetic that is about calendar days (the M25 lesson, where a
 * fixture built in UTC against a server on Asia/Dhaka broke for six hours
 * of every day).
 */
export function warrantyStatus(
  until: string | null | undefined,
  today: string,
  windowDays: number,
): WarrantyStatus {
  if (!until) {
    return {
      state: 'UNKNOWN',
      until: null,
      daysLeft: null,
      message: 'No warranty date recorded.',
    };
  }

  const daysLeft = daysBetween(today, until);
  if (daysLeft < 0) {
    return {
      state: 'EXPIRED',
      until,
      daysLeft,
      message: `Warranty expired on ${until}.`,
    };
  }
  if (daysLeft <= windowDays) {
    return {
      state: 'EXPIRING',
      until,
      daysLeft,
      message:
        daysLeft === 0
          ? 'Warranty expires today.'
          : `Warranty expires in ${daysLeft} day(s), on ${until}.`,
    };
  }
  return { state: 'ACTIVE', until, daysLeft, message: null };
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(
    Number(from.slice(0, 4)),
    Number(from.slice(5, 7)) - 1,
    Number(from.slice(8, 10)),
  );
  const b = Date.UTC(
    Number(to.slice(0, 4)),
    Number(to.slice(5, 7)) - 1,
    Number(to.slice(8, 10)),
  );
  return Math.round((b - a) / 86_400_000);
}

/**
 * The report list: everything expired or expiring inside the window,
 * plus everything with no date at all, worst first. UNKNOWN sorts with
 * the expiring rather than at the bottom, for the reason above.
 */
export interface WarrantyRow {
  id: string;
  status: WarrantyStatus;
}

const STATE_RANK: Record<WarrantyState, number> = {
  EXPIRED: 0,
  EXPIRING: 1,
  UNKNOWN: 2,
  ACTIVE: 3,
};

export function warrantyAlerts<T extends WarrantyRow>(rows: T[]): T[] {
  return rows
    .filter((row) => row.status.state !== 'ACTIVE')
    .sort(
      (a, b) =>
        STATE_RANK[a.status.state] - STATE_RANK[b.status.state] ||
        (a.status.daysLeft ?? 0) - (b.status.daysLeft ?? 0),
    );
}

// ── tags ─────────────────────────────────────────────────────────────

/**
 * Normalized the way the unique index sees it (`upper(btrim(...))`), so
 * the service's duplicate check and the database's constraint agree about
 * what "the same tag" means. Two implementations of that comparison is
 * how a 409 turns into a 500.
 */
export function normalizeAssetTag(tag: string): string {
  return tag.trim().toUpperCase();
}

/**
 * Tags for a batch generated at RECEIVE. `SequenceService` claims the
 * numbers (gap-free, inside the caller's transaction, so a rolled-back
 * receipt burns none); this only renders them, which is what makes the
 * batch testable without a database.
 */
export function assetTagsFor(
  pattern: string,
  startSeq: number,
  count: number,
  render: (pattern: string, seq: number) => string,
): string[] {
  return Array.from({ length: Math.max(0, Math.trunc(count)) }, (_, index) =>
    normalizeAssetTag(render(pattern, startSeq + index)),
  );
}
