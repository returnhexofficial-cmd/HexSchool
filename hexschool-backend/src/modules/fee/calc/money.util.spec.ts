import {
  clampMoney,
  equalMoney,
  formatMoney,
  money,
  percentOf,
  sumMoney,
  toMoney,
} from './money.util';

describe('money arithmetic', () => {
  describe('money()', () => {
    it('rounds to two decimals', () => {
      expect(money(1234.567)).toBe(1234.57);
      expect(money(1234.564)).toBe(1234.56);
    });

    it('does not drift on the classic float cases', () => {
      // These are the reason this helper exists at all: a chain of
      // untouched float arithmetic breaks chk_invoices_payable.
      expect(money(0.1 + 0.2)).toBe(0.3);
      expect(money(1.005)).toBe(1.01);
      expect(money(1.015)).toBe(1.02);
      expect(money(8.165)).toBe(8.17);
    });

    it('rounds half away from zero, like a cashier', () => {
      expect(money(2.5 / 100)).toBe(0.03);
      expect(money(-1.005)).toBe(-1.01);
    });

    it('survives nonsense rather than producing NaN', () => {
      expect(money(Number.NaN)).toBe(0);
      expect(money(Number.POSITIVE_INFINITY)).toBe(0);
    });
  });

  describe('sumMoney()', () => {
    it('rounds as it goes, not only at the end', () => {
      // Ten lines of 0.1 must be exactly 1.00, not 0.9999999999999999.
      expect(sumMoney(Array.from({ length: 10 }, () => 0.1))).toBe(1);
    });

    it('is zero for an empty basket', () => {
      expect(sumMoney([])).toBe(0);
    });

    it('adds a realistic invoice', () => {
      expect(sumMoney([1500, 350.5, 200.25, 75.75])).toBe(2126.5);
    });
  });

  describe('percentOf()', () => {
    it('computes a percentage to the paisa', () => {
      expect(percentOf(1000, 10)).toBe(100);
      expect(percentOf(1234.56, 12.5)).toBe(154.32);
      expect(percentOf(333.33, 33.33)).toBe(111.1);
    });

    it('is zero at 0 %', () => {
      expect(percentOf(1000, 0)).toBe(0);
    });
  });

  describe('clampMoney()', () => {
    it('caps at the ceiling and floors at zero', () => {
      expect(clampMoney(1200, 1000)).toBe(1000);
      expect(clampMoney(-50, 1000)).toBe(0);
      expect(clampMoney(400.005, 1000)).toBe(400.01);
    });
  });

  it('compares to the paisa', () => {
    expect(equalMoney(0.1 + 0.2, 0.3)).toBe(true);
    expect(equalMoney(100, 100.004)).toBe(true);
    expect(equalMoney(100, 100.01)).toBe(false);
  });

  it('parses whatever Prisma returns', () => {
    expect(toMoney('1234.50')).toBe(1234.5);
    expect(toMoney(null)).toBe(0);
    expect(toMoney({ toString: () => '99.99' })).toBe(99.99);
  });

  it('formats for receipts', () => {
    expect(formatMoney(1234.5)).toBe('1,234.50');
    expect(formatMoney(0)).toBe('0.00');
    expect(formatMoney(1000000)).toBe('1,000,000.00');
  });
});
