import { money } from '../../fee/calc/money.util';

/**
 * Income tax deducted at source — dependency-free and golden-tested.
 *
 * This is deliberately the "simple slab config" the roadmap asks for
 * (M21 §4) and PROJECT_CONTEXT §17 records as an assumption, not a full
 * BD tax engine: no investment-rebate schedules, no separate slabs for
 * women/senior citizens, no minimum-tax floor. Those are a payroll
 * bureau's job. What a school needs is a monthly deduction that adds up
 * to roughly the right annual figure, configured per school in
 * `payroll.tax_slabs` so it can be corrected when a budget changes
 * without a deploy.
 */

export interface TaxSlab {
  /** Top of the band in annual taka; `null` on the last, open-ended one. */
  upTo: number | null;
  /** Percent applied to the part of income that falls inside this band. */
  rate: number;
}

/** The default the settings registry ships, kept here for tests/fallback. */
export const DEFAULT_TAX_SLABS: readonly TaxSlab[] = [
  { upTo: 350_000, rate: 0 },
  { upTo: 450_000, rate: 5 },
  { upTo: 750_000, rate: 10 },
  { upTo: 1_150_000, rate: 15 },
  { upTo: 1_650_000, rate: 20 },
  { upTo: null, rate: 25 },
];

/**
 * Tax on an annual taxable income, band by band.
 *
 * Each band taxes only the slice of income inside it — the marginal
 * structure every real slab table has. Reading the slabs as "whichever
 * band you land in, that rate applies to everything" is the classic
 * mistake, and it produces a cliff where earning one taka more costs
 * thousands.
 */
export function annualTax(
  annualTaxable: number,
  slabs: readonly TaxSlab[] = DEFAULT_TAX_SLABS,
  rebatePercent = 0,
): number {
  const income = Math.max(0, money(annualTaxable));
  if (income === 0) return 0;

  const ordered = normalizeSlabs(slabs);
  let tax = 0;
  let floor = 0;

  for (const slab of ordered) {
    const ceiling = slab.upTo ?? Number.POSITIVE_INFINITY;
    if (income <= floor) break;
    const slice = Math.min(income, ceiling) - floor;
    if (slice > 0) tax += (slice * clampRate(slab.rate)) / 100;
    floor = ceiling;
    if (!Number.isFinite(floor)) break;
  }

  const rebate = (tax * clampRate(rebatePercent)) / 100;
  return money(Math.max(0, tax - rebate));
}

/**
 * The month's deduction: annualize, tax, divide back.
 *
 * Annualizing the current month rather than tracking year-to-date is the
 * simplification this engine is honest about. It is exact for a steady
 * salary, which is the normal case; a mid-year increment makes the early
 * months slightly under-deducted and the later ones slightly over, which
 * the employee settles on their own return. Tracking YTD properly needs
 * the fiscal-year boundary and every prior payslip, and belongs with a
 * real tax module.
 */
export function monthlyTax(
  monthlyTaxable: number,
  slabs: readonly TaxSlab[] = DEFAULT_TAX_SLABS,
  rebatePercent = 0,
): number {
  const monthly = Math.max(0, money(monthlyTaxable));
  if (monthly === 0) return 0;
  return money(annualTax(monthly * 12, slabs, rebatePercent) / 12);
}

// ── slab hygiene ──────────────────────────────────────────────────────

/**
 * Sort by band ceiling and drop anything malformed, so a hand-edited
 * settings value can never make payroll throw. A missing open-ended band
 * is *added*: without it the highest earners would silently pay no tax on
 * income above the last ceiling, which looks like a working configuration
 * and is not one.
 */
export function normalizeSlabs(slabs: readonly TaxSlab[]): TaxSlab[] {
  const clean = slabs
    .filter(
      (slab) =>
        slab !== null &&
        typeof slab === 'object' &&
        Number.isFinite(slab.rate) &&
        (slab.upTo === null || (Number.isFinite(slab.upTo) && slab.upTo > 0)),
    )
    .map((slab) => ({ upTo: slab.upTo, rate: clampRate(slab.rate) }));

  if (clean.length === 0) return [...DEFAULT_TAX_SLABS];

  const bounded = clean
    .filter((slab) => slab.upTo !== null)
    .sort((a, b) => (a.upTo as number) - (b.upTo as number));
  const open = clean.filter((slab) => slab.upTo === null);

  if (open.length === 0) {
    const top = bounded[bounded.length - 1];
    return [...bounded, { upTo: null, rate: top.rate }];
  }
  return [...bounded, open[open.length - 1]];
}

export interface SlabProblem {
  index: number;
  message: string;
}

/** Validation for the settings screen — the same rules, reported. */
export function slabProblems(slabs: readonly TaxSlab[]): SlabProblem[] {
  const problems: SlabProblem[] = [];
  let previous = 0;

  slabs.forEach((slab, index) => {
    if (!Number.isFinite(slab.rate) || slab.rate < 0 || slab.rate > 100) {
      problems.push({ index, message: 'Rate must be between 0 and 100' });
    }
    if (slab.upTo === null) {
      if (index !== slabs.length - 1) {
        problems.push({
          index,
          message: 'Only the last slab may be open-ended',
        });
      }
      return;
    }
    if (!Number.isFinite(slab.upTo) || slab.upTo <= previous) {
      problems.push({
        index,
        message: 'Each slab ceiling must be higher than the one before it',
      });
    }
    previous = slab.upTo;
  });

  if (slabs.length > 0 && slabs[slabs.length - 1].upTo !== null) {
    problems.push({
      index: slabs.length - 1,
      message:
        'The last slab must be open-ended (upTo: null), or income above it goes untaxed',
    });
  }

  return problems;
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 0;
  return Math.min(100, Math.max(0, rate));
}
