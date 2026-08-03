/**
 * The security deposit, and the clearance a boarder has to pass to get it
 * back.
 *
 * Dependency-free and golden-tested; it reuses M16's `money.util`.
 *
 * **The deposit is the only money in this module the school does not
 * earn.** It is taken at allocation, held as a liability, and handed back
 * at vacate less whatever the school is keeping — a broken window, an
 * unreturned key. That single fact produces every rule here:
 *
 *   * a refund never exceeds the deposit (you cannot hand back money you
 *     were never given);
 *   * a deduction has to say what it is for, because the family is being
 *     told they are getting less than they paid and "administrative" is
 *     not a reason anybody can argue with;
 *   * and a deposit is refunded when somebody *leaves*, not while they
 *     are still asleep in the bed it secures — which is a CHECK, not a
 *     service rule.
 *
 * **The dues gate is a POLICY refusal** (roadmap §6, "vacate requires
 * dues clearance check (override permission)") — the M23
 * `library.clearance_block_exit` shape. A school that will not let a
 * family leave over an unpaid bill has to be able to let them leave
 * anyway when the head says so, and the override puts a name against it.
 */

import { money } from '../../fee/calc/money.util';

export interface Deduction {
  amount: number;
  reason: string;
}

export interface RefundInput {
  securityDeposit: number;
  deductions: ReadonlyArray<Deduction>;
}

export interface RefundResult {
  ok: boolean;
  /** What the family gets back. */
  refund: number;
  /** What the school keeps. */
  withheld: number;
  reason: string | null;
}

/**
 * What comes back. Deductions are summed, capped at the deposit (keeping
 * more than was held is a claim, not a deduction — the school invoices
 * for that), and each one needs a reason.
 */
export function computeRefund(input: RefundInput): RefundResult {
  const deposit = money(Math.max(0, input.securityDeposit));

  for (const deduction of input.deductions) {
    if (deduction.amount < 0) {
      return {
        ok: false,
        refund: 0,
        withheld: 0,
        reason: 'A deduction cannot be negative — that would be a top-up.',
      };
    }
    if (deduction.amount > 0 && deduction.reason.trim().length === 0) {
      return {
        ok: false,
        refund: 0,
        withheld: 0,
        reason:
          'Every deduction needs a reason on it — the family is being told they are getting less back.',
      };
    }
  }

  const claimed = money(
    input.deductions.reduce((sum, d) => sum + money(Math.max(0, d.amount)), 0),
  );

  if (deposit === 0) {
    return claimed > 0
      ? {
          ok: false,
          refund: 0,
          withheld: 0,
          reason:
            'No deposit was taken for this allocation, so there is nothing to deduct from.',
        }
      : { ok: true, refund: 0, withheld: 0, reason: null };
  }

  const withheld = Math.min(deposit, claimed);
  return {
    ok: true,
    refund: money(deposit - withheld),
    withheld: money(withheld),
    reason:
      claimed > deposit
        ? `Deductions of ${claimed} exceed the ${deposit} deposit — ${money(claimed - deposit)} is not recovered here and has to be invoiced.`
        : null,
  };
}

export interface ClearanceInput {
  /** Fee dues from M16's `LedgerService.outstandingFor`. */
  outstandingFees: number;
  /** Meal-off requests still waiting on a decision. */
  pendingMealOffs: number;
  /** `hostel.vacate_block_dues` — off means warn, on means refuse. */
  blockOnDues: boolean;
  /** Whether the caller holds `hostel.vacate.override`. */
  override: boolean;
}

export interface ClearanceVerdict {
  cleared: boolean;
  /** True when the vacate may proceed (cleared, or overridden, or warn-only). */
  allowed: boolean;
  warnings: string[];
  /** The 409 body when `allowed` is false. */
  reason: string | null;
}

/**
 * Can this boarder leave?
 *
 * Pending meal-offs are a **warning, never a refusal**: a request nobody
 * got round to deciding is the office's failure, not the family's, and
 * blocking a student from moving out over it would be absurd. They are
 * reported because the credit will otherwise land on an invoice for a
 * month the student was not here — the one loose end vacating leaves.
 */
export function checkClearance(input: ClearanceInput): ClearanceVerdict {
  const warnings: string[] = [];
  const dues = money(Math.max(0, input.outstandingFees));

  if (input.pendingMealOffs > 0) {
    warnings.push(
      `${input.pendingMealOffs} meal-off request(s) are still undecided — settle them before the next invoice run, or the credit lands on a bill for a month this student was not here.`,
    );
  }

  if (dues <= 0) {
    return { cleared: true, allowed: true, warnings, reason: null };
  }

  const message = `This student owes ${dues} in fees.`;
  if (!input.blockOnDues) {
    warnings.push(`${message} Vacating anyway — the dues stay on the ledger.`);
    return { cleared: false, allowed: true, warnings, reason: null };
  }
  if (input.override) {
    warnings.push(`${message} Vacated under hostel.vacate.override.`);
    return { cleared: false, allowed: true, warnings, reason: null };
  }
  return {
    cleared: false,
    allowed: false,
    warnings,
    reason: `${message} Clear the dues, or ask somebody with hostel.vacate.override to release the bed.`,
  };
}
