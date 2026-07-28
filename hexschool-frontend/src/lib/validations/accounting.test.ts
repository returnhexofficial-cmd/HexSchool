import { describe, expect, it } from "vitest";
import {
  accountSchema,
  balanceDifference,
  budgetSchema,
  fiscalPeriodSchema,
  settlementSchema,
  sumSide,
  voucherEntrySchema,
  voucherSchema,
} from "./accounting";

const line = (debit: number, credit: number) => ({
  accountId: "11111111-1111-4111-8111-111111111111",
  debit,
  credit,
});

describe("accounting validations — accounts", () => {
  const base = {
    group: "ASSET" as const,
    type: "CASH" as const,
    code: "1110",
    name: "Cash in Hand",
    isGroup: false,
  };

  it("accepts a well-formed account", () => {
    expect(accountSchema.safeParse(base).success).toBe(true);
  });

  it("accepts a hyphenated alphanumeric code", () => {
    expect(
      accountSchema.safeParse({ ...base, code: "CASH-01" }).success,
    ).toBe(true);
  });

  it("refuses a code with a space or a leading hyphen", () => {
    expect(accountSchema.safeParse({ ...base, code: "11 10" }).success).toBe(
      false,
    );
    expect(accountSchema.safeParse({ ...base, code: "-1110" }).success).toBe(
      false,
    );
  });

  it("refuses a one-character name", () => {
    expect(accountSchema.safeParse({ ...base, name: "C" }).success).toBe(false);
  });
});

describe("accounting validations — voucher lines", () => {
  it("accepts a one-sided line", () => {
    expect(voucherEntrySchema.safeParse(line(500, 0)).success).toBe(true);
    expect(voucherEntrySchema.safeParse(line(0, 500)).success).toBe(true);
  });

  it("refuses a line carrying both sides", () => {
    const result = voucherEntrySchema.safeParse(line(500, 500));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("never both");
    }
  });

  it("refuses an empty line", () => {
    const result = voucherEntrySchema.safeParse(line(0, 0));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("must carry an amount");
    }
  });

  it("refuses a negative amount", () => {
    expect(voucherEntrySchema.safeParse(line(-10, 0)).success).toBe(false);
  });
});

describe("accounting validations — the balance rule", () => {
  const voucher = (entries: Array<{ debit: number; credit: number }>) => ({
    type: "CREDIT" as const,
    date: "2026-07-28",
    narration: "Fees collected",
    entries: entries.map((entry) => ({ ...line(0, 0), ...entry })),
  });

  it("accepts a balanced voucher", () => {
    expect(
      voucherSchema.safeParse(voucher([{ debit: 1500, credit: 0 }, { debit: 0, credit: 1500 }]))
        .success,
    ).toBe(true);
  });

  it("refuses an unbalanced voucher", () => {
    const result = voucherSchema.safeParse(
      voucher([{ debit: 1500, credit: 0 }, { debit: 0, credit: 1200 }]),
    );
    expect(result.success).toBe(false);
  });

  it("refuses a single-line voucher — one line cannot balance", () => {
    expect(
      voucherSchema.safeParse(voucher([{ debit: 100, credit: 0 }])).success,
    ).toBe(false);
  });

  it("refuses a voucher with no narration", () => {
    const result = voucherSchema.safeParse({
      ...voucher([{ debit: 100, credit: 0 }, { debit: 0, credit: 100 }]),
      narration: "",
    });
    expect(result.success).toBe(false);
  });

  it("refuses a badly-shaped date", () => {
    const result = voucherSchema.safeParse({
      ...voucher([{ debit: 100, credit: 0 }, { debit: 0, credit: 100 }]),
      date: "28-07-2026",
    });
    expect(result.success).toBe(false);
  });
});

describe("accounting validations — the live balance indicator", () => {
  it("rounds per line then sums, matching the backend money rule", () => {
    const entries = [
      { debit: 33.333, credit: 0 },
      { debit: 33.333, credit: 0 },
      { debit: 0, credit: 66.67 },
    ];
    // 33.33 + 33.33 = 66.66 against 66.67 — the indicator must show the
    // one-paisa gap rather than hiding it behind a late rounding.
    expect(sumSide(entries, "debit")).toBe(66.66);
    expect(balanceDifference(entries)).toBe(-0.01);
  });

  it("reports zero for a balanced set", () => {
    expect(
      balanceDifference([
        { debit: 1000, credit: 0 },
        { debit: 500, credit: 0 },
        { debit: 0, credit: 1500 },
      ]),
    ).toBe(0);
  });

  it("signs the difference so the UI can say which way it is out", () => {
    expect(balanceDifference([{ debit: 100, credit: 0 }, { debit: 0, credit: 90 }])).toBe(10);
    expect(balanceDifference([{ debit: 90, credit: 0 }, { debit: 0, credit: 100 }])).toBe(-10);
  });

  it("treats blank inputs as zero rather than NaN", () => {
    expect(
      balanceDifference([
        { debit: Number(""), credit: 0 },
        { debit: 0, credit: Number("") },
      ]),
    ).toBe(0);
  });
});

describe("accounting validations — budgets, periods and settlements", () => {
  const budget = {
    accountId: "11111111-1111-4111-8111-111111111111",
    period: "YEARLY" as const,
    amount: 100000,
  };

  it("accepts a yearly budget with no month", () => {
    expect(budgetSchema.safeParse(budget).success).toBe(true);
  });

  it("refuses a monthly budget with no month", () => {
    const result = budgetSchema.safeParse({ ...budget, period: "MONTHLY" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("needs a month");
    }
  });

  it("refuses a period whose end precedes its start", () => {
    const result = fiscalPeriodSchema.safeParse({
      name: "FY 2026",
      startDate: "2026-12-31",
      endDate: "2026-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("refuses a settlement whose commission exceeds the gross", () => {
    const result = settlementSchema.safeParse({
      clearingAccountId: "11111111-1111-4111-8111-111111111111",
      bankAccountId: "22222222-2222-4222-8222-222222222222",
      gross: 100,
      charges: 150,
      date: "2026-07-28",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a settlement with no commission", () => {
    expect(
      settlementSchema.safeParse({
        clearingAccountId: "11111111-1111-4111-8111-111111111111",
        bankAccountId: "22222222-2222-4222-8222-222222222222",
        gross: 5000,
        charges: 0,
        date: "2026-07-28",
      }).success,
    ).toBe(true);
  });
});
