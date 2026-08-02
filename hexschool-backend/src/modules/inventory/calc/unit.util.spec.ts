import {
  allowsFraction,
  formatQty,
  QTY_SCALE,
  qty,
  qtySum,
  toBaseQty,
  toPackQty,
  unitCostPerBase,
  validateQty,
} from './unit.util';

describe('unit.util', () => {
  describe('qty', () => {
    it('rounds to the NUMERIC(14,3) scale', () => {
      expect(qty(1.23456)).toBe(1.235);
      expect(qty(0.0004)).toBe(0);
      expect(qty(0.0005)).toBe(0.001);
    });

    it('is a no-op on values already at scale', () => {
      expect(qty(12)).toBe(12);
      expect(qty(0.5)).toBe(0.5);
      expect(qty(999.999)).toBe(999.999);
    });

    it('treats a non-finite value as zero rather than propagating NaN', () => {
      expect(qty(Number.NaN)).toBe(0);
      expect(qty(Number.POSITIVE_INFINITY)).toBe(0);
    });

    it('exposes the scale it enforces', () => {
      expect(QTY_SCALE).toBe(3);
    });
  });

  describe('qtySum', () => {
    it('rounds once at the end, not per term', () => {
      // Three thirds of a litre: rounding each to 0.333 loses a
      // millilitre, and a stock balance that drifts by a millilitre per
      // issue is a balance that stops matching the shelf.
      expect(qtySum([1 / 3, 1 / 3, 1 / 3])).toBe(1);
    });

    it('sums an empty list to zero', () => {
      expect(qtySum([])).toBe(0);
    });
  });

  describe('allowsFraction', () => {
    it('permits fractions only for weight and volume (roadmap §7)', () => {
      expect(allowsFraction('LITER')).toBe(true);
      expect(allowsFraction('KG')).toBe(true);
      expect(allowsFraction('PCS')).toBe(false);
      expect(allowsFraction('BOX')).toBe(false);
      expect(allowsFraction('REAM')).toBe(false);
      expect(allowsFraction('SET')).toBe(false);
      expect(allowsFraction('OTHER')).toBe(false);
    });
  });

  describe('validateQty', () => {
    it('accepts a whole quantity of a counted unit', () => {
      expect(validateQty(12, 'PCS')).toEqual({ ok: true, qty: 12 });
    });

    it('accepts a fraction of litres', () => {
      expect(validateQty(0.5, 'LITER')).toEqual({ ok: true, qty: 0.5 });
    });

    it('refuses half a chair', () => {
      const verdict = validateQty(2.5, 'PCS');
      expect(verdict.ok).toBe(false);
      expect(verdict.ok === false && verdict.reason).toMatch(/whole units/);
    });

    it('refuses zero and negatives', () => {
      expect(validateQty(0, 'PCS').ok).toBe(false);
      expect(validateQty(-1, 'KG').ok).toBe(false);
    });

    it('refuses more precision than the column holds, rather than silently rounding', () => {
      // The column would round 0.0005 to 0.001 on the way in, and the
      // balance the service just computed would disagree with the one the
      // database stored.
      const verdict = validateQty(1.2345, 'KG');
      expect(verdict.ok).toBe(false);
      expect(verdict.ok === false && verdict.reason).toMatch(/decimal places/);
    });

    it('refuses a non-finite quantity', () => {
      expect(validateQty(Number.NaN, 'PCS').ok).toBe(false);
    });

    it('returns the normalized value, so a caller cannot validate one number and store another', () => {
      const verdict = validateQty(3.0, 'PCS');
      expect(verdict).toEqual({ ok: true, qty: 3 });
    });
  });

  describe('toBaseQty / toPackQty — roadmap §8 box → pcs', () => {
    it('multiplies packs into base units', () => {
      expect(toBaseQty(4, 12)).toBe(48);
      expect(toBaseQty(2, 500)).toBe(1000);
    });

    it('is the identity when the item has no pack', () => {
      expect(toBaseQty(7, null)).toBe(7);
      expect(toBaseQty(7, undefined)).toBe(7);
    });

    it('treats a zero or negative pack size as no pack', () => {
      // A pack size of 0 would make a purchase of four boxes arrive as
      // nothing, and the school would find out at the next stock take.
      expect(toBaseQty(4, 0)).toBe(4);
      expect(toBaseQty(4, -12)).toBe(4);
    });

    it('round-trips through toPackQty', () => {
      expect(toPackQty(toBaseQty(4, 12), 12)).toBe(4);
      expect(toPackQty(48, 12)).toBe(4);
    });

    it('reports a part-pack balance as a fraction of a pack', () => {
      expect(toPackQty(18, 12)).toBe(1.5);
    });
  });

  describe('unitCostPerBase', () => {
    it('divides the invoice price by the pack', () => {
      expect(unitCostPerBase(240, 12)).toBe(20);
    });

    it('keeps four decimals, so a ream values back to what was paid', () => {
      // 150 / 500 = 0.30 exactly; the four-decimal column is what stops
      // 500 × 0.3 drifting away from 150.
      expect(unitCostPerBase(150, 500)).toBe(0.3);
      expect(unitCostPerBase(100, 3)).toBe(33.3333);
    });

    it('is the price itself when there is no pack', () => {
      expect(unitCostPerBase(85, null)).toBe(85);
    });

    it('floors a nonsense price at zero rather than propagating it', () => {
      expect(unitCostPerBase(-5, 12)).toBe(0);
      expect(unitCostPerBase(Number.NaN, 12)).toBe(0);
    });
  });

  describe('formatQty', () => {
    it('drops the column padding a store register never had', () => {
      expect(formatQty(12)).toBe('12');
      expect(formatQty(12.5)).toBe('12.5');
      expect(formatQty(0.25)).toBe('0.25');
    });

    it('appends the unit when one is given', () => {
      expect(formatQty(3, 'REAM')).toBe('3 REAM');
    });
  });
});
