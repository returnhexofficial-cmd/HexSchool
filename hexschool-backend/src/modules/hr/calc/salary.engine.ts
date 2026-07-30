import { money, sumMoney } from '../../fee/calc/money.util';

/**
 * Salary-structure arithmetic — dependency-free and golden-tested. A
 * structure is a basic figure plus lines computed from it; this module
 * turns the pair into the four totals every later step needs (gross, the
 * deduction side, the taxable base and the provident-fund base).
 *
 * It reuses M16's `money.util` for the same reason the M20 engines do:
 * every intermediate value has to stay on the 2-decimal grid the database
 * stores, or a payslip ends up a paisa away from its own components.
 */

export type ComponentType = 'ALLOWANCE' | 'DEDUCTION';
export type ComponentCalc = 'FLAT' | 'PERCENT_OF_BASIC';
export type PfBaseMode = 'BASIC' | 'COMPONENTS';

export interface ComponentSpec {
  name: string;
  type: ComponentType;
  calc: ComponentCalc;
  /** Taka for FLAT, percent (0–100) for PERCENT_OF_BASIC. */
  value: number;
  isTaxable: boolean;
  isPfBase: boolean;
  displayOrder?: number;
}

export interface ComputedComponent extends ComponentSpec {
  /** The line's value in taka for this basic. */
  amount: number;
}

export interface StructureComputation {
  basic: number;
  components: ComputedComponent[];
  allowanceTotal: number;
  /** Recurring structure deductions — NOT tax, PF or attendance. */
  deductionTotal: number;
  /** basic + allowances: what "gross salary" means on a BD payslip. */
  gross: number;
  /** The part of gross that income tax is assessed on. */
  taxableGross: number;
  /** What the provident-fund percentages are applied to. */
  pfBase: number;
}

/**
 * Compute every line of a structure for a given basic.
 *
 * `basic` is passed in rather than read off the structure so the same
 * function serves the preview (structure's own basic), an employee with a
 * `basic_override`, and the roadmap §8 MPO case where the school's basic
 * is zero and only allowances are paid. A PERCENT_OF_BASIC line on a zero
 * basic is legitimately zero — that is exactly what an MPO structure
 * looks like, not an error.
 */
export function computeStructure(
  basic: number,
  components: readonly ComponentSpec[],
  options: { pfBase?: PfBaseMode } = {},
): StructureComputation {
  const base = money(Math.max(0, basic));
  const computed: ComputedComponent[] = [...components]
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
    .map((component) => ({
      ...component,
      amount:
        component.calc === 'PERCENT_OF_BASIC'
          ? money((base * clampPercent(component.value)) / 100)
          : money(Math.max(0, component.value)),
    }));

  const allowances = computed.filter((c) => c.type === 'ALLOWANCE');
  const deductions = computed.filter((c) => c.type === 'DEDUCTION');

  const allowanceTotal = sumMoney(allowances.map((c) => c.amount));
  const deductionTotal = sumMoney(deductions.map((c) => c.amount));
  const gross = money(base + allowanceTotal);

  // Basic is always taxable and always part of the PF base — every BD pay
  // scale is built that way, and a structure that said otherwise would be
  // describing an allowance, not a basic.
  const taxableGross = money(
    base + sumMoney(allowances.filter((c) => c.isTaxable).map((c) => c.amount)),
  );
  const pfBase =
    options.pfBase === 'COMPONENTS'
      ? money(
          base +
            sumMoney(allowances.filter((c) => c.isPfBase).map((c) => c.amount)),
        )
      : base;

  return {
    basic: base,
    components: computed,
    allowanceTotal,
    deductionTotal,
    gross,
    taxableGross,
    pfBase,
  };
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

// ── validation ────────────────────────────────────────────────────────

export interface ComponentProblem {
  index: number;
  name: string;
  message: string;
}

/**
 * Every problem in a structure at once (the M15 all-at-once rule), so the
 * builder can paint each bad row instead of making the author fix one,
 * resubmit, and find the next.
 *
 * The 0–100 bound on a percentage is the roadmap §7 rule and is also a
 * DB CHECK; it lives here as well because the client mirrors this
 * function, and a red cell before submission beats a 409 after it.
 */
export function structureProblems(
  basic: number,
  components: readonly ComponentSpec[],
): ComponentProblem[] {
  const problems: ComponentProblem[] = [];

  if (!Number.isFinite(basic) || basic < 0) {
    problems.push({
      index: -1,
      name: 'basic',
      message: 'Basic pay cannot be negative',
    });
  }

  const seen = new Set<string>();
  components.forEach((component, index) => {
    const key = component.name.trim().toLowerCase();
    if (key.length === 0) {
      problems.push({
        index,
        name: component.name,
        message: 'Name is required',
      });
    } else if (seen.has(key)) {
      problems.push({
        index,
        name: component.name,
        // Two lines called "House Rent" print twice on the payslip and
        // are impossible to tell apart in the breakdown JSON.
        message: `Duplicate component name "${component.name.trim()}"`,
      });
    }
    seen.add(key);

    if (!Number.isFinite(component.value) || component.value < 0) {
      problems.push({
        index,
        name: component.name,
        message: 'Value cannot be negative',
      });
    } else if (component.calc === 'PERCENT_OF_BASIC' && component.value > 100) {
      problems.push({
        index,
        name: component.name,
        message: 'A percentage of basic cannot exceed 100',
      });
    }
  });

  // A structure whose recurring deductions swallow the whole gross pays
  // nobody anything, every month, silently. That is a mis-typed
  // percentage, not a pay scale.
  const computed = computeStructure(basic, components);
  if (computed.gross > 0 && computed.deductionTotal >= computed.gross) {
    problems.push({
      index: -1,
      name: 'deductions',
      message: `Deductions (${computed.deductionTotal.toFixed(2)}) consume the whole gross (${computed.gross.toFixed(2)})`,
    });
  }

  return problems;
}
