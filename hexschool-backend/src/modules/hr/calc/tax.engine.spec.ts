import {
  DEFAULT_TAX_SLABS,
  TaxSlab,
  annualTax,
  monthlyTax,
  normalizeSlabs,
  slabProblems,
} from './tax.engine';

describe('tax.engine', () => {
  describe('annualTax', () => {
    it('taxes nothing inside the exempt band', () => {
      expect(annualTax(350_000)).toBe(0);
      expect(annualTax(0)).toBe(0);
    });

    it('taxes only the slice above the exempt band', () => {
      // 400,000 → first 350,000 free, next 50,000 at 5 %.
      expect(annualTax(400_000)).toBe(2500);
    });

    it('accumulates across bands (marginal, not cliff)', () => {
      // 800,000 = 350,000@0 + 100,000@5 (5,000) + 300,000@10 (30,000)
      //         + 50,000@15 (7,500) = 42,500
      expect(annualTax(800_000)).toBe(42_500);
    });

    it('has no cliff at a band edge', () => {
      // The classic bug: reading "you are in the 10 % band" as 10 % of
      // everything makes one extra taka of income cost thousands.
      const below = annualTax(449_999);
      const above = annualTax(450_001);
      expect(above - below).toBeLessThan(1);
    });

    it('applies the top rate to everything above the last ceiling', () => {
      // 2,000,000 = 42,500 (to 800k, above) + rest…
      // 350k@0 + 100k@5=5,000 + 300k@10=30,000 + 400k@15=60,000
      // + 500k@20=100,000 + 350k@25=87,500 → 282,500
      expect(annualTax(2_000_000)).toBe(282_500);
    });

    it('applies a flat investment rebate to the computed tax', () => {
      expect(annualTax(400_000, DEFAULT_TAX_SLABS, 20)).toBe(2000);
    });

    it('never returns a negative tax, whatever the rebate', () => {
      expect(annualTax(400_000, DEFAULT_TAX_SLABS, 300)).toBe(0);
    });

    it('treats a negative income as zero', () => {
      expect(annualTax(-100_000)).toBe(0);
    });
  });

  describe('monthlyTax', () => {
    it('annualizes the month, taxes it, and divides back', () => {
      // 40,000/month → 480,000/year → 350k@0 + 100k@5 (5,000)
      // + 30k@10 (3,000) = 8,000 → 666.67 a month.
      expect(monthlyTax(40_000)).toBe(666.67);
    });

    it('deducts nothing from a salary below the exempt threshold', () => {
      expect(monthlyTax(25_000)).toBe(0);
    });

    it('is zero for a zero month (a payslip with no earnings)', () => {
      expect(monthlyTax(0)).toBe(0);
    });
  });

  describe('normalizeSlabs', () => {
    it('sorts bands by ceiling', () => {
      const messy: TaxSlab[] = [
        { upTo: null, rate: 25 },
        { upTo: 450_000, rate: 5 },
        { upTo: 350_000, rate: 0 },
      ];
      expect(normalizeSlabs(messy).map((s) => s.upTo)).toEqual([
        350_000,
        450_000,
        null,
      ]);
    });

    it('ADDS an open-ended band when the config forgot one', () => {
      // Without this, the highest earners pay nothing on income above the
      // last ceiling — a configuration that looks like it works and does
      // not.
      const bounded: TaxSlab[] = [
        { upTo: 350_000, rate: 0 },
        { upTo: 450_000, rate: 5 },
      ];
      const fixed = normalizeSlabs(bounded);
      expect(fixed[fixed.length - 1]).toEqual({ upTo: null, rate: 5 });
      expect(annualTax(10_000_000, bounded)).toBeGreaterThan(0);
    });

    it('falls back to the defaults when the value is unusable', () => {
      expect(normalizeSlabs([])).toEqual([...DEFAULT_TAX_SLABS]);
      expect(normalizeSlabs([{ upTo: NaN, rate: NaN }])).toEqual([
        ...DEFAULT_TAX_SLABS,
      ]);
    });

    it('clamps a nonsense rate rather than throwing', () => {
      const slabs = normalizeSlabs([{ upTo: null, rate: 900 }]);
      expect(slabs[0].rate).toBe(100);
    });
  });

  describe('slabProblems', () => {
    it('accepts the shipped defaults', () => {
      expect(slabProblems(DEFAULT_TAX_SLABS)).toEqual([]);
    });

    it('refuses ceilings that do not ascend', () => {
      const problems = slabProblems([
        { upTo: 450_000, rate: 0 },
        { upTo: 350_000, rate: 5 },
        { upTo: null, rate: 10 },
      ]);
      expect(problems).toHaveLength(1);
      expect(problems[0].message).toMatch(/higher than the one before/);
    });

    it('refuses an open-ended band in the middle', () => {
      const problems = slabProblems([
        { upTo: null, rate: 0 },
        { upTo: 450_000, rate: 5 },
      ]);
      expect(
        problems.some((p) => /last slab may be open-ended/.test(p.message)),
      ).toBe(true);
    });

    it('refuses a table with no open-ended band', () => {
      const problems = slabProblems([{ upTo: 350_000, rate: 0 }]);
      expect(problems.some((p) => /untaxed/.test(p.message))).toBe(true);
    });

    it('refuses a rate outside 0–100', () => {
      expect(
        slabProblems([{ upTo: null, rate: 120 }]).some((p) =>
          /between 0 and 100/.test(p.message),
        ),
      ).toBe(true);
    });
  });
});
