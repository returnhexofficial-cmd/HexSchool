/**
 * Document expiry (roadmap M25 §4 "expiry alert job — fitness / tax /
 * insurance / licence within 30 days → admin notification", §7 "expiry
 * dates ≥ today on create (warn otherwise)").
 *
 * Dependency-free and golden-tested. Dates are `YYYY-MM-DD` strings, the
 * M05 rule — an expiry is a calendar day printed on a paper document, and
 * comparing it as an instant would make a certificate expire at a
 * different hour in a different timezone.
 *
 * The governing decision: **a missing date is not a valid one.** A
 * vehicle with no fitness date recorded is the single most likely one to
 * be unfit, so it reports UNKNOWN and appears in the alert list rather
 * than silently passing every check — which is what a truthy/falsy
 * implementation would do.
 */

export type ExpiryState = 'UNKNOWN' | 'EXPIRED' | 'DUE_SOON' | 'OK';

/** Which paper it is. Free-form on purpose — M26 will add its own. */
export type ExpiryKind = 'FITNESS' | 'TAX_TOKEN' | 'INSURANCE' | 'LICENSE';

export const EXPIRY_LABELS: Record<ExpiryKind, string> = {
  FITNESS: 'Fitness certificate',
  TAX_TOKEN: 'Tax token',
  INSURANCE: 'Insurance',
  LICENSE: 'Driving licence',
};

export interface ExpiryItem {
  kind: ExpiryKind;
  label: string;
  /** `YYYY-MM-DD`, or `null` when nothing was recorded. */
  expiry: string | null;
  /** Negative once expired; `null` when unknown. */
  daysLeft: number | null;
  state: ExpiryState;
}

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export function expiryState(
  expiry: string | null | undefined,
  today: string,
  windowDays: number,
): { state: ExpiryState; daysLeft: number | null } {
  if (!expiry || !DATE_SHAPE.test(expiry)) {
    return { state: 'UNKNOWN', daysLeft: null };
  }
  const daysLeft = daysBetween(today, expiry);
  // Expiry day itself is still valid — a fitness certificate reading
  // "valid to 31 December" is valid ON the 31st, which is the day the
  // office is most likely to be looking at it.
  if (daysLeft < 0) return { state: 'EXPIRED', daysLeft };
  if (daysLeft <= windowDays) return { state: 'DUE_SOON', daysLeft };
  return { state: 'OK', daysLeft };
}

/** Sort order for an alert list: worst first, then soonest. */
const STATE_RANK: Record<ExpiryState, number> = {
  EXPIRED: 0,
  DUE_SOON: 1,
  UNKNOWN: 2,
  OK: 3,
};

export function expiryItems(
  documents: Array<{ kind: ExpiryKind; expiry: string | null | undefined }>,
  today: string,
  windowDays: number,
): ExpiryItem[] {
  return documents
    .map(({ kind, expiry }) => {
      const { state, daysLeft } = expiryState(expiry, today, windowDays);
      return {
        kind,
        label: EXPIRY_LABELS[kind],
        expiry: expiry && DATE_SHAPE.test(expiry) ? expiry : null,
        daysLeft,
        state,
      };
    })
    .sort(
      (a, b) =>
        STATE_RANK[a.state] - STATE_RANK[b.state] ||
        (a.daysLeft ?? 9_999) - (b.daysLeft ?? 9_999),
    );
}

/** Items that belong in an alert: expired, nearly expired, or missing. */
export function alertable(items: ExpiryItem[]): ExpiryItem[] {
  return items.filter((item) => item.state !== 'OK');
}

/**
 * The worst state across a set — what colours a vehicle's row in the
 * fleet list. UNKNOWN ranks *below* DUE_SOON deliberately: a paper whose
 * date nobody entered is a worry, but a paper the school knows expires on
 * Thursday is the one that has to be dealt with this week.
 */
export function worstState(items: ExpiryItem[]): ExpiryState {
  let worst: ExpiryState = 'OK';
  for (const item of items) {
    if (STATE_RANK[item.state] < STATE_RANK[worst]) worst = item.state;
  }
  return worst;
}

/**
 * The one-line summary an alert message carries. Written as a sentence
 * rather than assembled in the notification service, so the wording is
 * golden-tested with the arithmetic that produced it.
 */
export function expirySummary(subject: string, items: ExpiryItem[]): string {
  const flagged = alertable(items);
  if (flagged.length === 0) return `${subject}: all documents are current.`;

  const parts = flagged.map((item) => {
    if (item.state === 'UNKNOWN') return `${item.label} not recorded`;
    if (item.state === 'EXPIRED') {
      const days = Math.abs(item.daysLeft ?? 0);
      return `${item.label} expired ${days} day(s) ago`;
    }
    return `${item.label} expires in ${item.daysLeft} day(s)`;
  });
  return `${subject}: ${parts.join('; ')}.`;
}

/**
 * Roadmap §7's create-time rule, as a *warning* rather than a refusal: a
 * school entering a bus whose tax token lapsed last month is recording a
 * true fact, and refusing it would leave the vehicle off the system
 * entirely — which is worse than knowing about it.
 */
export function pastDateWarnings(
  documents: Array<{ kind: ExpiryKind; expiry: string | null | undefined }>,
  today: string,
): string[] {
  return documents
    .map(({ kind, expiry }) => {
      const { state, daysLeft } = expiryState(expiry, today, 0);
      return state === 'EXPIRED'
        ? `${EXPIRY_LABELS[kind]} expired ${Math.abs(daysLeft ?? 0)} day(s) ago (${expiry}).`
        : null;
    })
    .filter((warning): warning is string => warning !== null);
}
