import { money, percentOf, sumMoney } from '../../fee/calc/money.util';
import { halfDays } from './leave.engine';
import { StructureComputation } from './salary.engine';
import { TaxSlab, monthlyTax } from './tax.engine';

/**
 * The monthly payroll computation — dependency-free and golden-tested.
 * Everything a payslip prints is decided here, from one structure, one
 * attendance summary and one config object. No Prisma, no settings
 * service, no clock.
 *
 * The order of operations is the part worth reading, because it is what
 * a BD school's pay office actually does:
 *
 *   1. **Prorate** by the working days the person was employed for. A
 *      mid-month joiner earns a fraction of the scale, not the whole of
 *      it (roadmap §8).
 *   2. **Deduct attendance** at a per-day rate computed from the FULL
 *      monthly figure, never the prorated one — a day's absence costs the
 *      same whether you joined on the 1st or the 15th.
 *   3. **Withhold statutory amounts** (provident fund, tax) from what was
 *      earned.
 *   4. **Round** the net, and keep the adjustment as an explicit line so
 *      the payslip still adds up and the ledger still balances.
 */

export type RoundingMode = 'NONE' | 'NEAREST_1' | 'NEAREST_5' | 'NEAREST_10';
export type DeductionBase = 'BASIC' | 'GROSS';

export interface PayrollConfig {
  absentDeductionEnabled: boolean;
  absentDeductionBase: DeductionBase;
  unpaidLeaveDeductionEnabled: boolean;
  pfEnabled: boolean;
  pfEmployeePercent: number;
  pfEmployerPercent: number;
  taxEnabled: boolean;
  taxSlabs: readonly TaxSlab[];
  taxRebatePercent: number;
  rounding: RoundingMode;
}

export interface BonusLine {
  name: string;
  amount: number;
}

export interface AdHocLine {
  label: string;
  type: 'ALLOWANCE' | 'DEDUCTION';
  amount: number;
  /** Why this one-off exists — roadmap §8's exam-committee allowance. */
  reason?: string | null;
}

export interface AttendanceSummary {
  presentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
}

export interface PayslipInput {
  structure: StructureComputation;
  /** The month's working days, frozen on the run. */
  workingDays: number;
  /** Working days inside the person's employment window this month. */
  eligibleDays: number;
  attendance: AttendanceSummary;
  bonuses: readonly BonusLine[];
  adHoc: readonly AdHocLine[];
  /** Whether this employee has served long enough to join the fund. */
  pfEligible: boolean;
  config: PayrollConfig;
}

export interface BreakdownLine {
  label: string;
  kind: 'EARNING' | 'DEDUCTION';
  amount: number;
  note?: string | null;
}

export interface PayslipComputation {
  basic: number;
  totalAllowances: number;
  gross: number;
  /** Structure DEDUCTION lines + ad-hoc deductions, prorated. */
  otherDeductions: number;
  attendanceDeduction: number;
  pfEmployee: number;
  pfEmployer: number;
  tax: number;
  bonus: number;
  totalDeductions: number;
  netPayable: number;
  /** `netPayable − the exact figure`; positive when rounded up. */
  roundingAdjustment: number;
  prorationFactor: number;
  perDayRate: number;
  daysPresent: number;
  daysLeavePaid: number;
  daysAbsent: number;
  daysUnpaidLeave: number;
  workingDays: number;
  lines: BreakdownLine[];
}

export function computePayslip(input: PayslipInput): PayslipComputation {
  const workingDays = Math.max(0, Math.trunc(input.workingDays));
  const eligibleDays = Math.min(
    workingDays,
    Math.max(0, Math.trunc(input.eligibleDays)),
  );
  const factor = workingDays > 0 ? eligibleDays / workingDays : 0;

  const { structure } = input;
  const basic = money(structure.basic * factor);
  const structureAllowances = money(structure.allowanceTotal * factor);
  const structureDeductions = money(structure.deductionTotal * factor);

  const adHocAllowances = sumMoney(
    input.adHoc.filter((l) => l.type === 'ALLOWANCE').map((l) => l.amount),
  );
  const adHocDeductions = sumMoney(
    input.adHoc.filter((l) => l.type === 'DEDUCTION').map((l) => l.amount),
  );

  const totalAllowances = money(structureAllowances + adHocAllowances);
  const gross = money(basic + totalAllowances);
  const bonus = sumMoney(input.bonuses.map((b) => b.amount));

  // A day costs a day: the per-day rate divides the FULL monthly figure,
  // so a person who joined mid-month is not charged a larger fraction of
  // their (already prorated) pay for the same single absence.
  const dailyBase =
    input.config.absentDeductionBase === 'GROSS'
      ? structure.gross
      : structure.basic;
  const perDayRate = workingDays > 0 ? money(dailyBase / workingDays) : 0;

  const daysAbsent = halfDays(Math.max(0, input.attendance.absentDays));
  const daysUnpaidLeave = halfDays(
    Math.max(0, input.attendance.unpaidLeaveDays),
  );

  const rawAbsentDeduction = input.config.absentDeductionEnabled
    ? money(perDayRate * daysAbsent)
    : 0;
  const rawUnpaidDeduction = input.config.unpaidLeaveDeductionEnabled
    ? money(perDayRate * daysUnpaidLeave)
    : 0;

  // Attendance can wipe out a month's pay but never take it below zero —
  // a school does not invoice a teacher for having been away.
  const attendanceDeduction = Math.min(
    money(rawAbsentDeduction + rawUnpaidDeduction),
    gross,
  );

  const pfBaseEarned = money(structure.pfBase * factor);
  // The provident fund follows the PAY SCALE, not the attendance
  // register: it is computed on the earned base before absence
  // deductions, which is how a BD school's fund is administered — a day
  // off is a pay penalty, not a change of grade.
  const pfEmployee =
    input.config.pfEnabled && input.pfEligible
      ? percentOf(pfBaseEarned, clampPercent(input.config.pfEmployeePercent))
      : 0;
  const pfEmployer =
    input.config.pfEnabled && input.pfEligible
      ? percentOf(pfBaseEarned, clampPercent(input.config.pfEmployerPercent))
      : 0;

  // Tax is assessed on what was actually earned this month (ad-hoc
  // allowances included, attendance deductions removed), annualized by
  // `tax.engine`.
  const taxableEarned = Math.max(
    0,
    money(
      money(structure.taxableGross * factor) +
        adHocAllowances -
        attendanceDeduction,
    ),
  );
  const tax = input.config.taxEnabled
    ? monthlyTax(
        taxableEarned,
        input.config.taxSlabs,
        input.config.taxRebatePercent,
      )
    : 0;

  // The discretionary deductions absorb whatever room is left, so the net
  // is non-negative BY CONSTRUCTION rather than by a floor. A floor would
  // make the payslip stop adding up — and the salary voucher, which is
  // derived from these same figures, stop balancing.
  const capacity = Math.max(
    0,
    money(gross + bonus - attendanceDeduction - pfEmployee - tax),
  );
  const otherDeductions = Math.min(
    money(structureDeductions + adHocDeductions),
    capacity,
  );

  const totalDeductions = money(
    otherDeductions + attendanceDeduction + pfEmployee + tax,
  );
  const exactNet = money(gross + bonus - totalDeductions);
  const netPayable = roundNet(exactNet, input.config.rounding);
  const roundingAdjustment = money(netPayable - exactNet);

  return {
    basic,
    totalAllowances,
    gross,
    otherDeductions,
    attendanceDeduction,
    pfEmployee,
    pfEmployer,
    tax,
    bonus,
    totalDeductions,
    netPayable,
    roundingAdjustment,
    prorationFactor: factor,
    perDayRate,
    daysPresent: halfDays(Math.max(0, input.attendance.presentDays)),
    daysLeavePaid: halfDays(Math.max(0, input.attendance.paidLeaveDays)),
    daysAbsent,
    daysUnpaidLeave,
    workingDays,
    lines: breakdownLines({
      input,
      factor,
      basic,
      structureAllowances,
      structureDeductions: Math.min(structureDeductions, otherDeductions),
      adHocAllowances,
      adHocDeductions: money(
        Math.max(
          0,
          otherDeductions - Math.min(structureDeductions, otherDeductions),
        ),
      ),
      attendanceDeduction,
      pfEmployee,
      tax,
      roundingAdjustment,
    }),
  };
}

/**
 * The salary-expense debit the M20 voucher needs, derived from the stored
 * payslip columns alone.
 *
 * The identity: debits are `salaryExpense + bonus + pfEmployer`, credits
 * are `pfEmployee + pfEmployer + tax + net`. Setting them equal and
 * solving gives exactly this expression — which is why the payroll
 * voucher balances to the paisa without any splitting or remainder
 * arithmetic, and why it keeps balancing after a payslip is edited by
 * hand (the edit moves `net`, and this moves with it).
 */
export function salaryExpenseFor(payslip: {
  netPayable: number;
  pfEmployee: number;
  tax: number;
  bonus: number;
}): number {
  return money(
    payslip.netPayable + payslip.pfEmployee + payslip.tax - payslip.bonus,
  );
}

/** Round the net to the unit a school hands out in cash. */
export function roundNet(value: number, mode: RoundingMode): number {
  const amount = money(Math.max(0, value));
  const unit =
    mode === 'NEAREST_10'
      ? 10
      : mode === 'NEAREST_5'
        ? 5
        : mode === 'NEAREST_1'
          ? 1
          : 0;
  if (unit === 0) return amount;
  return money(Math.round(amount / unit) * unit);
}

// ── bonus eligibility ─────────────────────────────────────────────────

export interface BonusRule {
  name: string;
  basis: 'PERCENT_OF_BASIC' | 'FLAT';
  value: number;
  minServiceMonths: number;
  prorate: boolean;
}

/**
 * What a bonus round pays one employee.
 *
 * Somebody short of the minimum service gets nothing — unless the round
 * prorates, in which case they get the fraction of the qualifying period
 * they have actually served. Returning `0` rather than omitting the line
 * lets the review grid show *why* a person's bonus is zero, which is the
 * question the office is asked every Eid.
 */
export function bonusAmount(
  rule: BonusRule,
  basic: number,
  serviceMonths: number,
): number {
  const full =
    rule.basis === 'PERCENT_OF_BASIC'
      ? percentOf(Math.max(0, basic), clampPercent(rule.value))
      : money(Math.max(0, rule.value));

  const required = Math.max(0, rule.minServiceMonths);
  const served = Math.max(0, serviceMonths);
  if (served >= required) return full;
  if (!rule.prorate || required === 0) return 0;
  return money((full * served) / required);
}

// ── internals ─────────────────────────────────────────────────────────

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function breakdownLines(args: {
  input: PayslipInput;
  factor: number;
  basic: number;
  structureAllowances: number;
  structureDeductions: number;
  adHocAllowances: number;
  adHocDeductions: number;
  attendanceDeduction: number;
  pfEmployee: number;
  tax: number;
  roundingAdjustment: number;
}): BreakdownLine[] {
  const lines: BreakdownLine[] = [
    { label: 'Basic', kind: 'EARNING', amount: args.basic },
  ];

  for (const component of args.input.structure.components) {
    const amount = money(component.amount * args.factor);
    if (amount === 0 && component.amount === 0) continue;
    lines.push({
      label: component.name,
      kind: component.type === 'ALLOWANCE' ? 'EARNING' : 'DEDUCTION',
      amount,
      note:
        component.calc === 'PERCENT_OF_BASIC'
          ? `${component.value}% of basic`
          : null,
    });
  }

  for (const line of args.input.adHoc) {
    lines.push({
      label: line.label,
      kind: line.type === 'ALLOWANCE' ? 'EARNING' : 'DEDUCTION',
      amount: money(line.amount),
      note: line.reason ?? null,
    });
  }

  for (const bonusLine of args.input.bonuses) {
    lines.push({
      label: bonusLine.name,
      kind: 'EARNING',
      amount: money(bonusLine.amount),
      note: 'Bonus',
    });
  }

  if (args.attendanceDeduction > 0) {
    lines.push({
      label: 'Attendance deduction',
      kind: 'DEDUCTION',
      amount: args.attendanceDeduction,
      note: `${args.input.attendance.absentDays} absent + ${args.input.attendance.unpaidLeaveDays} unpaid leave day(s)`,
    });
  }
  if (args.pfEmployee > 0) {
    lines.push({
      label: 'Provident fund (employee)',
      kind: 'DEDUCTION',
      amount: args.pfEmployee,
    });
  }
  if (args.tax > 0) {
    lines.push({
      label: 'Income tax (TDS)',
      kind: 'DEDUCTION',
      amount: args.tax,
    });
  }
  if (args.roundingAdjustment !== 0) {
    lines.push({
      label: 'Rounding',
      kind: args.roundingAdjustment > 0 ? 'EARNING' : 'DEDUCTION',
      amount: Math.abs(args.roundingAdjustment),
    });
  }

  return lines;
}
