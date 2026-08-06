import type { CertificateTypeCode } from './types';

/**
 * **The aggregated clearance check** — roadmap M27 §4's "clearance check
 * (dues, library, hostel — aggregated clearance service)" and §6's "TC
 * requires full clearance (hard) — override `certificate.clearance.override`
 * with mandatory reason".
 *
 * MODULE_DEPENDENCIES has pointed three modules at this function for
 * months: M16's `LedgerService.outstandingFor` is the dues half, M23
 * exports `LibraryClearanceService.clearanceForPerson` and M26 exports the
 * hostel half. What was *not* decided until here is what "aggregated"
 * means, and the answer is that it is **one verdict, not three**.
 *
 * Three separate checks in the issue flow would each get their own
 * warning, their own override and eventually their own opinion about
 * whether a student may leave — which is how a school ends up handing out
 * a transfer certificate to a child who still has the library's copy of a
 * textbook and a bed the warden has not released. So the three sources
 * come in as data, one verdict comes out, and the issue endpoint, the
 * wizard's clearance panel and the audit snapshot all read that same
 * verdict (the M16 `deriveStatus` / M23 `canIssue` / M25 `capacity.engine`
 * rule, fifth use).
 *
 * **Dependency-free** and golden-tested: it does not know what a Prisma
 * client is, which is what lets the wizard preview a clearance the caller
 * has not yet earned the right to override.
 */

/** One source's contribution — money owed, things held, or both. */
export interface ClearanceSourceInput {
  /** Money outstanding to this source, in BDT. */
  amount?: number;
  /** Physical things not returned (books out, a bed still held). */
  items?: number;
  /** Lines the panel prints verbatim, already written by the source. */
  details?: string[];
  /**
   * The source could not be read.
   *
   * **This flag exists because the obvious implementation is dangerous.**
   * A source that fails returns no amount and no items, which is
   * indistinguishable from a source that returned "nothing owed" — so
   * without it, a library that is down reads as a student who has
   * returned every book, and the verdict says CLEARED. It reports as a
   * loud warning rather than as a refusal, because a school must still be
   * able to issue a character certificate while another module is
   * misbehaving (the M25 "nothing in the fee source ever throws" rule);
   * `complete: false` is what the panel and the stored snapshot record.
   */
  incomplete?: boolean;
}

export interface ClearanceInput {
  type: CertificateTypeCode;
  /** M16 — total outstanding across every enrollment of this student. */
  fees: ClearanceSourceInput;
  /** M23 — `LibraryClearanceService.clearanceForPerson`. Absent = off. */
  library?: ClearanceSourceInput;
  /** M26 — beds still held, deposits unreturned. Absent = off. */
  hostel?: ClearanceSourceInput;
  /** `documents.clearance_required_types` — types this gate applies to. */
  requiredTypes: readonly CertificateTypeCode[];
  /** Whether the caller holds `certificate.clearance.override`. */
  override: boolean;
}

export interface ClearanceBlocker {
  source: 'FEES' | 'LIBRARY' | 'HOSTEL';
  amount: number;
  items: number;
  details: string[];
}

export interface ClearanceVerdict {
  /** True when the student owes nothing anywhere. */
  cleared: boolean;
  /** True when issuing may proceed — cleared, overridden, or not gated. */
  allowed: boolean;
  /** Whether this certificate type is gated at all. */
  required: boolean;
  /** False when a source could not be read — `cleared` is then a guess. */
  complete: boolean;
  blockers: ClearanceBlocker[];
  /** Total money owed across every source, to the paisa. */
  totalOutstanding: number;
  warnings: string[];
  /** The 409 body when `allowed` is false; null otherwise. */
  reason: string | null;
}

/** Two-decimal money, matching M16's `money.util` contract. */
function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toBlocker(
  source: ClearanceBlocker['source'],
  input: ClearanceSourceInput | undefined,
): ClearanceBlocker | null {
  if (!input) return null;
  const amount = money(Math.max(0, input.amount ?? 0));
  const items = Math.max(0, Math.trunc(input.items ?? 0));
  if (amount <= 0 && items <= 0) return null;
  return { source, amount, items, details: input.details ?? [] };
}

const SOURCE_LABEL: Record<ClearanceBlocker['source'], string> = {
  FEES: 'fees',
  LIBRARY: 'the library',
  HOSTEL: 'the hostel',
};

/** "142.00 BDT of fees" / "2 item(s) with the library" / both. */
function describe(blocker: ClearanceBlocker): string {
  const parts: string[] = [];
  if (blocker.amount > 0) {
    parts.push(
      `${blocker.amount.toFixed(2)} BDT owed to ${SOURCE_LABEL[blocker.source]}`,
    );
  }
  if (blocker.items > 0) {
    parts.push(
      `${blocker.items} item(s) still held from ${SOURCE_LABEL[blocker.source]}`,
    );
  }
  return parts.join(' and ');
}

/**
 * Is this student clear enough for this certificate?
 *
 * **Which types are gated is a school setting, and that is deliberate.**
 * Roadmap §6 makes the rule about the TC, and only the TC — because a
 * transfer certificate is the document that ends the relationship, and it
 * is the last moment the school has any leverage to get its textbooks and
 * its fees back. A character certificate is a reference; refusing to say a
 * child is of good character because their family owes two months' tuition
 * is a different, meaner act, and a system that made it the default would
 * be making a decision that is not the system's to make. So the default
 * list is `["TRANSFER"]` and a school may widen it.
 *
 * An ungated type still **reports** what is owed (`blockers` is populated,
 * `cleared` is honest) — the office should see it on the wizard's panel
 * even where it does not stop them. `allowed` is the only field that
 * changes.
 */
export function aggregateClearance(input: ClearanceInput): ClearanceVerdict {
  const sources: Array<
    [ClearanceBlocker['source'], ClearanceSourceInput | undefined]
  > = [
    ['FEES', input.fees],
    ['LIBRARY', input.library],
    ['HOSTEL', input.hostel],
  ];

  const blockers = sources
    .map(([source, value]) => toBlocker(source, value))
    .filter((b): b is ClearanceBlocker => b !== null);

  // A source that could not be read never claims the student is clear.
  const unreadable = sources
    .filter(([, value]) => value?.incomplete === true)
    .flatMap(([source, value]) => [
      `${SOURCE_LABEL[source]} could not be checked — this clearance is incomplete.`,
      ...(value?.details ?? []),
    ]);
  const complete = unreadable.length === 0;

  const totalOutstanding = money(
    blockers.reduce((sum, b) => sum + b.amount, 0),
  );
  const cleared = blockers.length === 0 && complete;
  const required = input.requiredTypes.includes(input.type);

  const warnings = [
    ...unreadable,
    ...blockers.flatMap((b) => [describe(b), ...b.details]),
  ];

  if (blockers.length === 0) {
    return {
      cleared,
      allowed: true,
      required,
      complete,
      blockers,
      totalOutstanding: 0,
      warnings,
      reason: null,
    };
  }

  const summary = blockers.map(describe).join('; ');

  if (!required) {
    return {
      cleared: false,
      allowed: true,
      required,
      complete,
      blockers,
      totalOutstanding,
      warnings: [
        ...unreadable,
        `Not clear: ${summary}. A ${input.type} certificate does not require clearance, so this is a note rather than a refusal.`,
        ...blockers.flatMap((b) => b.details),
      ],
      reason: null,
    };
  }

  if (input.override) {
    return {
      cleared: false,
      allowed: true,
      required,
      complete,
      blockers,
      totalOutstanding,
      warnings: [
        ...unreadable,
        `Not clear: ${summary}. Issued under certificate.clearance.override.`,
        ...blockers.flatMap((b) => b.details),
      ],
      reason: null,
    };
  }

  return {
    cleared: false,
    allowed: false,
    required,
    complete,
    blockers,
    totalOutstanding,
    warnings,
    reason:
      `Clearance not met: ${summary}. Settle it, or ask somebody with ` +
      `certificate.clearance.override to issue anyway with a reason.`,
  };
}
