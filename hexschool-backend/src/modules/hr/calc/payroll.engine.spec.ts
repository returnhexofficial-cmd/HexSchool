import { ComponentSpec, computeStructure } from './salary.engine';
import { DEFAULT_TAX_SLABS } from './tax.engine';
import {
  PayrollConfig,
  PayslipInput,
  bonusAmount,
  computePayslip,
  roundNet,
  salaryExpenseFor,
} from './payroll.engine';

const SCALE: ComponentSpec[] = [
  {
    name: 'House Rent',
    type: 'ALLOWANCE',
    calc: 'PERCENT_OF_BASIC',
    value: 40,
    isTaxable: true,
    isPfBase: false,
    displayOrder: 1,
  },
  {
    name: 'Medical',
    type: 'ALLOWANCE',
    calc: 'FLAT',
    value: 1500,
    isTaxable: true,
    isPfBase: false,
    displayOrder: 2,
  },
];

/** basic 20,000 + HR 8,000 + medical 1,500 = gross 29,500. */
const structure = computeStructure(20_000, SCALE);

const CONFIG: PayrollConfig = {
  absentDeductionEnabled: true,
  absentDeductionBase: 'BASIC',
  unpaidLeaveDeductionEnabled: true,
  pfEnabled: false,
  pfEmployeePercent: 10,
  pfEmployerPercent: 10,
  taxEnabled: false,
  taxSlabs: DEFAULT_TAX_SLABS,
  taxRebatePercent: 0,
  rounding: 'NONE',
};

const input = (over: Partial<PayslipInput> = {}): PayslipInput => ({
  structure,
  workingDays: 25,
  eligibleDays: 25,
  attendance: {
    presentDays: 25,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    absentDays: 0,
  },
  bonuses: [],
  adHoc: [],
  pfEligible: true,
  config: CONFIG,
  ...over,
});

describe('payroll.engine', () => {
  describe('a full month, nothing unusual', () => {
    const result = computePayslip(input());

    it('pays the whole scale', () => {
      expect(result.basic).toBe(20_000);
      expect(result.totalAllowances).toBe(9500);
      expect(result.gross).toBe(29_500);
      expect(result.netPayable).toBe(29_500);
    });

    it('deducts nothing', () => {
      expect(result.totalDeductions).toBe(0);
      expect(result.attendanceDeduction).toBe(0);
    });

    it('prints one breakdown line per component plus basic', () => {
      expect(result.lines.map((l) => l.label)).toEqual([
        'Basic',
        'House Rent',
        'Medical',
      ]);
    });
  });

  describe('proration (roadmap §8 — a mid-month joiner)', () => {
    const result = computePayslip(
      input({
        eligibleDays: 10,
        attendance: {
          presentDays: 10,
          paidLeaveDays: 0,
          unpaidLeaveDays: 0,
          absentDays: 0,
        },
      }),
    );

    it('pays the employed fraction of the scale', () => {
      expect(result.prorationFactor).toBeCloseTo(0.4, 6);
      expect(result.basic).toBe(8000);
      expect(result.gross).toBe(11_800);
      expect(result.netPayable).toBe(11_800);
    });

    it('never pays more than the month, however the days are entered', () => {
      const over = computePayslip(input({ eligibleDays: 40 }));
      expect(over.gross).toBe(29_500);
    });

    it('pays nothing when the person was employed for no working day', () => {
      const none = computePayslip(input({ eligibleDays: 0 }));
      expect(none.gross).toBe(0);
      expect(none.netPayable).toBe(0);
    });
  });

  describe('attendance deductions', () => {
    it('charges basic ÷ working days per absent day', () => {
      const result = computePayslip(
        input({
          attendance: {
            presentDays: 23,
            paidLeaveDays: 0,
            unpaidLeaveDays: 0,
            absentDays: 2,
          },
        }),
      );
      expect(result.perDayRate).toBe(800); // 20,000 / 25
      expect(result.attendanceDeduction).toBe(1600);
      expect(result.netPayable).toBe(27_900);
    });

    it('charges gross ÷ working days when configured that way', () => {
      const result = computePayslip(
        input({
          config: { ...CONFIG, absentDeductionBase: 'GROSS' },
          attendance: {
            presentDays: 24,
            paidLeaveDays: 0,
            unpaidLeaveDays: 0,
            absentDays: 1,
          },
        }),
      );
      expect(result.perDayRate).toBe(1180); // 29,500 / 25
      expect(result.attendanceDeduction).toBe(1180);
    });

    it('charges unpaid leave the same way as absence', () => {
      const result = computePayslip(
        input({
          attendance: {
            presentDays: 22,
            paidLeaveDays: 1,
            unpaidLeaveDays: 2,
            absentDays: 0,
          },
        }),
      );
      expect(result.attendanceDeduction).toBe(1600);
      expect(result.daysLeavePaid).toBe(1);
    });

    it('charges nothing for PAID leave', () => {
      const result = computePayslip(
        input({
          attendance: {
            presentDays: 20,
            paidLeaveDays: 5,
            unpaidLeaveDays: 0,
            absentDays: 0,
          },
        }),
      );
      expect(result.attendanceDeduction).toBe(0);
      expect(result.netPayable).toBe(29_500);
    });

    it('honours the switches being off', () => {
      const result = computePayslip(
        input({
          config: {
            ...CONFIG,
            absentDeductionEnabled: false,
            unpaidLeaveDeductionEnabled: false,
          },
          attendance: {
            presentDays: 0,
            paidLeaveDays: 0,
            unpaidLeaveDays: 10,
            absentDays: 15,
          },
        }),
      );
      expect(result.attendanceDeduction).toBe(0);
    });

    it('uses the FULL monthly rate even for a prorated joiner', () => {
      // A single absence costs 800 whether you worked all month or half
      // of it; charging a fraction-of-a-fraction would penalise a joiner
      // less for the same missed day.
      const result = computePayslip(
        input({
          eligibleDays: 10,
          attendance: {
            presentDays: 9,
            paidLeaveDays: 0,
            unpaidLeaveDays: 0,
            absentDays: 1,
          },
        }),
      );
      expect(result.perDayRate).toBe(800);
      expect(result.attendanceDeduction).toBe(800);
      expect(result.netPayable).toBe(11_000); // 11,800 − 800
    });

    it('never deducts more than was earned', () => {
      const result = computePayslip(
        input({
          config: { ...CONFIG, absentDeductionBase: 'GROSS' },
          attendance: {
            presentDays: 0,
            paidLeaveDays: 0,
            unpaidLeaveDays: 0,
            absentDays: 30,
          },
        }),
      );
      expect(result.attendanceDeduction).toBe(29_500);
      expect(result.netPayable).toBe(0);
    });
  });

  describe('provident fund', () => {
    const pfConfig: PayrollConfig = { ...CONFIG, pfEnabled: true };

    it('withholds the employee side and accrues the employer side', () => {
      const result = computePayslip(input({ config: pfConfig }));
      expect(result.pfEmployee).toBe(2000); // 10 % of basic
      expect(result.pfEmployer).toBe(2000);
      expect(result.netPayable).toBe(27_500);
    });

    it('deducts nothing from somebody not yet eligible', () => {
      const result = computePayslip(
        input({ config: pfConfig, pfEligible: false }),
      );
      expect(result.pfEmployee).toBe(0);
      expect(result.pfEmployer).toBe(0);
    });

    it('follows the pay scale, not the attendance register', () => {
      // Two absent days cost 1,600 of pay but do not change the grade the
      // fund is administered against.
      const result = computePayslip(
        input({
          config: pfConfig,
          attendance: {
            presentDays: 23,
            paidLeaveDays: 0,
            unpaidLeaveDays: 0,
            absentDays: 2,
          },
        }),
      );
      expect(result.pfEmployee).toBe(2000);
    });

    it('prorates with the employment window', () => {
      const result = computePayslip(
        input({ config: pfConfig, eligibleDays: 10 }),
      );
      expect(result.pfEmployee).toBe(800); // 10 % of 8,000 earned basic
    });
  });

  describe('tax', () => {
    it('deducts nothing when tax is switched off', () => {
      expect(computePayslip(input()).tax).toBe(0);
    });

    it('assesses the taxable gross, monthly', () => {
      const result = computePayslip(
        input({ config: { ...CONFIG, taxEnabled: true } }),
      );
      // 29,500 × 12 = 354,000 → 4,000 above the exempt band at 5 % = 200
      expect(result.tax).toBe(16.67);
      expect(result.netPayable).toBe(29_483.33);
    });

    it('assesses what was EARNED, so absence lowers the tax too', () => {
      const result = computePayslip(
        input({
          config: { ...CONFIG, taxEnabled: true },
          attendance: {
            presentDays: 20,
            paidLeaveDays: 0,
            unpaidLeaveDays: 0,
            absentDays: 5,
          },
        }),
      );
      expect(result.tax).toBe(0);
    });
  });

  describe('bonus and ad-hoc lines', () => {
    it('adds a bonus on top of the gross without inflating it', () => {
      const result = computePayslip(
        input({ bonuses: [{ name: 'Eid-ul-Fitr Bonus', amount: 20_000 }] }),
      );
      expect(result.gross).toBe(29_500);
      expect(result.bonus).toBe(20_000);
      expect(result.netPayable).toBe(49_500);
    });

    it('carries a one-off allowance with its reason (roadmap §8)', () => {
      const result = computePayslip(
        input({
          adHoc: [
            {
              label: 'Exam committee',
              type: 'ALLOWANCE',
              amount: 3000,
              reason: 'SSC 2027 committee duty',
            },
          ],
        }),
      );
      expect(result.totalAllowances).toBe(12_500);
      expect(result.netPayable).toBe(32_500);
      expect(result.lines.find((l) => l.label === 'Exam committee')?.note).toBe(
        'SSC 2027 committee duty',
      );
    });

    it('withholds a one-off deduction', () => {
      const result = computePayslip(
        input({
          adHoc: [
            { label: 'Advance recovery', type: 'DEDUCTION', amount: 2500 },
          ],
        }),
      );
      expect(result.otherDeductions).toBe(2500);
      expect(result.netPayable).toBe(27_000);
    });
  });

  describe('rounding', () => {
    it('leaves the exact figure alone on NONE', () => {
      expect(roundNet(27_483.33, 'NONE')).toBe(27_483.33);
    });

    it('rounds to the nearest taka / five / ten', () => {
      expect(roundNet(27_483.33, 'NEAREST_1')).toBe(27_483);
      expect(roundNet(27_483.33, 'NEAREST_5')).toBe(27_485);
      expect(roundNet(27_483.33, 'NEAREST_10')).toBe(27_480);
    });

    it('records the adjustment so the payslip still adds up', () => {
      const result = computePayslip(
        input({
          config: { ...CONFIG, taxEnabled: true, rounding: 'NEAREST_10' },
        }),
      );
      expect(result.netPayable).toBe(29_480);
      expect(result.roundingAdjustment).toBe(-3.33);
      expect(result.lines.some((l) => l.label === 'Rounding')).toBe(true);
    });
  });

  describe('salaryExpenseFor — the voucher identity', () => {
    const balances = (slip: {
      netPayable: number;
      pfEmployee: number;
      pfEmployer: number;
      tax: number;
      bonus: number;
    }) => {
      const debits = salaryExpenseFor(slip) + slip.bonus + slip.pfEmployer;
      const credits =
        slip.pfEmployee + slip.pfEmployer + slip.tax + slip.netPayable;
      return Math.abs(debits - credits);
    };

    it('balances to the paisa on a plain payslip', () => {
      const slip = computePayslip(input());
      expect(balances(slip)).toBeLessThan(0.005);
    });

    it('balances with PF, tax, a bonus and rounding all in play', () => {
      const slip = computePayslip(
        input({
          config: {
            ...CONFIG,
            pfEnabled: true,
            taxEnabled: true,
            rounding: 'NEAREST_5',
          },
          bonuses: [{ name: 'Eid Bonus', amount: 20_000 }],
          adHoc: [{ label: 'Advance', type: 'DEDUCTION', amount: 1234.56 }],
          attendance: {
            presentDays: 21,
            paidLeaveDays: 1,
            unpaidLeaveDays: 1,
            absentDays: 2,
          },
        }),
      );
      expect(balances(slip)).toBeLessThan(0.005);
    });

    it('balances on a zero-pay month', () => {
      const slip = computePayslip(input({ eligibleDays: 0 }));
      expect(balances(slip)).toBeLessThan(0.005);
      expect(salaryExpenseFor(slip)).toBe(0);
    });
  });

  describe('bonusAmount', () => {
    const rule = {
      name: 'Eid-ul-Fitr',
      basis: 'PERCENT_OF_BASIC' as const,
      value: 100,
      minServiceMonths: 6,
      prorate: false,
    };

    it('pays a full basic to somebody who qualifies', () => {
      expect(bonusAmount(rule, 20_000, 18)).toBe(20_000);
    });

    it('pays nothing to somebody short of the minimum service', () => {
      expect(bonusAmount(rule, 20_000, 3)).toBe(0);
    });

    it('prorates when the round says to', () => {
      expect(bonusAmount({ ...rule, prorate: true }, 20_000, 3)).toBe(10_000);
    });

    it('pays a flat round as taka, not a percentage', () => {
      expect(
        bonusAmount({ ...rule, basis: 'FLAT', value: 5000 }, 20_000, 12),
      ).toBe(5000);
    });

    it('qualifies exactly at the boundary', () => {
      expect(bonusAmount(rule, 20_000, 6)).toBe(20_000);
    });

    it('pays everybody when there is no minimum', () => {
      expect(bonusAmount({ ...rule, minServiceMonths: 0 }, 20_000, 0)).toBe(
        20_000,
      );
    });
  });
});
