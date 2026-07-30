import {
  ComponentSpec,
  computeStructure,
  structureProblems,
} from './salary.engine';

const line = (over: Partial<ComponentSpec>): ComponentSpec => ({
  name: 'Line',
  type: 'ALLOWANCE',
  calc: 'FLAT',
  value: 0,
  isTaxable: true,
  isPfBase: false,
  ...over,
});

/**
 * The reference scale used across these fixtures — a plain BD school
 * package: basic 20,000, house rent 40 % of basic, a flat medical
 * allowance, a non-taxable conveyance allowance, and a welfare-fund
 * deduction.
 */
const SCALE: ComponentSpec[] = [
  line({
    name: 'House Rent',
    calc: 'PERCENT_OF_BASIC',
    value: 40,
    isPfBase: true,
    displayOrder: 1,
  }),
  line({ name: 'Medical', value: 1500, displayOrder: 2 }),
  line({ name: 'Conveyance', value: 800, isTaxable: false, displayOrder: 3 }),
  line({
    name: 'Welfare Fund',
    type: 'DEDUCTION',
    value: 200,
    displayOrder: 4,
  }),
];

describe('salary.engine', () => {
  describe('computeStructure', () => {
    const result = computeStructure(20000, SCALE);

    it('reads a percentage line against basic', () => {
      expect(result.components[0].amount).toBe(8000);
    });

    it('reads a flat line as taka', () => {
      expect(result.components[1].amount).toBe(1500);
    });

    it('totals allowances and deductions separately', () => {
      expect(result.allowanceTotal).toBe(10300); // 8000 + 1500 + 800
      expect(result.deductionTotal).toBe(200);
    });

    it('gross is basic + allowances (deductions are withheld, not netted)', () => {
      expect(result.gross).toBe(30300);
    });

    it('excludes a non-taxable allowance from the taxable base', () => {
      // 20000 basic + 8000 house rent + 1500 medical; conveyance is out.
      expect(result.taxableGross).toBe(29500);
    });

    it('defaults the PF base to basic alone', () => {
      expect(result.pfBase).toBe(20000);
    });

    it('widens the PF base to the flagged components on request', () => {
      const wide = computeStructure(20000, SCALE, { pfBase: 'COMPONENTS' });
      expect(wide.pfBase).toBe(28000); // basic + house rent
    });

    it('orders lines by displayOrder so a payslip prints predictably', () => {
      const shuffled = computeStructure(20000, [
        line({ name: 'Second', value: 100, displayOrder: 2 }),
        line({ name: 'First', value: 100, displayOrder: 1 }),
      ]);
      expect(shuffled.components.map((c) => c.name)).toEqual([
        'First',
        'Second',
      ]);
    });

    it('rounds each line to paisa as it goes', () => {
      const odd = computeStructure(12345.67, [
        line({ name: 'HR', calc: 'PERCENT_OF_BASIC', value: 40 }),
      ]);
      expect(odd.components[0].amount).toBe(4938.27);
      expect(odd.gross).toBe(17283.94);
    });

    it('handles the MPO case: zero basic, school-paid allowances only', () => {
      // Roadmap §8 — the government pays the basic, the school tops up.
      const mpo = computeStructure(0, [
        line({ name: 'House Rent', calc: 'PERCENT_OF_BASIC', value: 40 }),
        line({ name: 'School Allowance', value: 2500 }),
      ]);
      expect(mpo.basic).toBe(0);
      expect(mpo.components[0].amount).toBe(0);
      expect(mpo.gross).toBe(2500);
      expect(mpo.pfBase).toBe(0);
    });

    it('clamps a percentage above 100 rather than paying it', () => {
      const absurd = computeStructure(1000, [
        line({ name: 'Bad', calc: 'PERCENT_OF_BASIC', value: 400 }),
      ]);
      expect(absurd.components[0].amount).toBe(1000);
    });

    it('treats a negative basic as zero', () => {
      expect(computeStructure(-5000, []).basic).toBe(0);
    });
  });

  describe('structureProblems', () => {
    it('accepts a sound scale', () => {
      expect(structureProblems(20000, SCALE)).toEqual([]);
    });

    it('refuses a percentage above 100', () => {
      const problems = structureProblems(20000, [
        line({ name: 'HR', calc: 'PERCENT_OF_BASIC', value: 140 }),
      ]);
      expect(problems).toHaveLength(1);
      expect(problems[0].message).toMatch(/cannot exceed 100/);
    });

    it('refuses a negative value', () => {
      expect(
        structureProblems(20000, [line({ name: 'HR', value: -1 })]),
      ).toHaveLength(1);
    });

    it('refuses two lines with the same name', () => {
      const problems = structureProblems(20000, [
        line({ name: 'House Rent', value: 100 }),
        line({ name: '  house rent ', value: 200 }),
      ]);
      expect(problems.map((p) => p.message)).toEqual([
        'Duplicate component name "house rent"',
      ]);
    });

    it('refuses a name that is only whitespace', () => {
      expect(
        structureProblems(20000, [line({ name: '   ', value: 100 })]),
      ).toHaveLength(1);
    });

    it('refuses deductions that swallow the whole gross', () => {
      const problems = structureProblems(10000, [
        line({ name: 'Everything', type: 'DEDUCTION', value: 10000 }),
      ]);
      expect(problems).toHaveLength(1);
      expect(problems[0].message).toMatch(/consume the whole gross/);
    });

    it('reports every problem at once, not just the first', () => {
      const problems = structureProblems(-1, [
        line({ name: '', value: 100 }),
        line({ name: 'HR', calc: 'PERCENT_OF_BASIC', value: 200 }),
      ]);
      expect(problems.length).toBeGreaterThanOrEqual(3);
    });
  });
});
