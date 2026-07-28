import { z } from "zod";
import type {
  AccountGroup,
  AccountType,
  VoucherStatus,
  VoucherType,
} from "@/lib/api/accounting";

/** Mirrors the backend Accounting & Finance DTOs (Module 20). */

export const ACCOUNT_TYPES = [
  "CASH",
  "BANK",
  "RECEIVABLE",
  "PAYABLE",
  "INCOME",
  "EXPENSE",
  "EQUITY",
  "OTHER",
] as const;

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  CASH: "Cash",
  BANK: "Bank",
  RECEIVABLE: "Receivable",
  PAYABLE: "Payable",
  INCOME: "Income",
  EXPENSE: "Expense",
  EQUITY: "Equity",
  OTHER: "Other",
};

export const VOUCHER_TYPES = ["CREDIT", "DEBIT", "JOURNAL", "CONTRA"] as const;

export const VOUCHER_STATUS_VARIANT: Record<
  VoucherStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  DRAFT: "outline",
  POSTED: "default",
  CANCELLED: "destructive",
};

/**
 * Which account types each voucher type expects to touch — the client
 * mirror of `shapeError` in `accounting/calc/voucher.engine.ts`. The
 * entry grid warns before a save is attempted; the server decides.
 */
export const VOUCHER_TYPE_HINTS: Record<VoucherType, string> = {
  CREDIT: "Money in — debit a cash or bank account",
  DEBIT: "Money out — credit a cash or bank account",
  JOURNAL: "Anything else — no cash or bank line required",
  CONTRA: "Between the school’s own cash and bank accounts only",
};

// ── schemas ─────────────────────────────────────────────────────────────

const money = z
  .number({ message: "Enter an amount" })
  .min(0, "Cannot be negative")
  .max(9999999999, "Too large");

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");

export const accountSchema = z.object({
  group: z.enum(["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"]),
  type: z.enum(ACCOUNT_TYPES),
  code: z
    .string()
    .trim()
    .min(1, "A code is required")
    .max(20)
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9-]*$/,
      "Letters, digits and hyphens only, starting with a letter or digit",
    ),
  name: z.string().trim().min(2, "Name is too short").max(150),
  nameBn: z.string().trim().max(150).optional(),
  parentId: z.string().uuid().nullable().optional(),
  isGroup: z.boolean(),
  openingBalance: money.optional(),
  bankAccountNo: z.string().trim().max(60).optional(),
  bankName: z.string().trim().max(150).optional(),
  branchName: z.string().trim().max(150).optional(),
  description: z.string().trim().max(500).optional(),
});

export type AccountForm = z.infer<typeof accountSchema>;

export const voucherEntrySchema = z
  .object({
    accountId: z.string().uuid("Pick an account"),
    debit: money,
    credit: money,
    narration: z.string().trim().max(300).optional(),
  })
  .refine((v) => !(v.debit > 0 && v.credit > 0), {
    message: "A line is either a debit or a credit, never both",
    path: ["credit"],
  })
  .refine((v) => v.debit > 0 || v.credit > 0, {
    message: "A line must carry an amount",
    path: ["debit"],
  });

/**
 * The client mirror of the module's central rule. It is checked here so
 * the Post button can stay disabled with a live "out by X" readout —
 * the server re-checks and is the authority (the M14/M15 mirrored-bounds
 * convention).
 */
export const voucherSchema = z
  .object({
    type: z.enum(VOUCHER_TYPES),
    date: isoDate,
    narration: z.string().trim().min(2, "A narration is required").max(500),
    reference: z.string().trim().max(120).optional(),
    entries: z.array(voucherEntrySchema).min(2, "A voucher needs at least two lines"),
  })
  .refine(
    (v) => Math.abs(sumSide(v.entries, "debit") - sumSide(v.entries, "credit")) < 0.005,
    { message: "Debits and credits must match exactly", path: ["entries"] },
  );

export type VoucherForm = z.infer<typeof voucherSchema>;

export const budgetSchema = z
  .object({
    accountId: z.string().uuid("Pick an account"),
    period: z.enum(["YEARLY", "MONTHLY"]),
    month: z.number().int().min(1).max(12).optional(),
    amount: money,
    note: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.period !== "MONTHLY" || v.month !== undefined, {
    message: "A monthly budget needs a month",
    path: ["month"],
  });

export type BudgetForm = z.infer<typeof budgetSchema>;

export const fiscalPeriodSchema = z
  .object({
    name: z.string().trim().min(2, "A name is required").max(100),
    startDate: isoDate,
    endDate: isoDate,
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "The end date is before the start date",
    path: ["endDate"],
  });

export type FiscalPeriodForm = z.infer<typeof fiscalPeriodSchema>;

export const settlementSchema = z
  .object({
    clearingAccountId: z.string().uuid("Pick the gateway clearing account"),
    bankAccountId: z.string().uuid("Pick the bank account"),
    gross: money.refine((v) => v >= 0.01, "Enter the gross amount"),
    charges: money,
    date: isoDate,
    reference: z.string().trim().max(120).optional(),
  })
  .refine((v) => v.charges <= v.gross, {
    message: "The commission cannot exceed the gross amount",
    path: ["charges"],
  });

export type SettlementForm = z.infer<typeof settlementSchema>;

export const cancelVoucherSchema = z.object({
  reason: z.string().trim().min(3, "A reason is required").max(500),
});

export type CancelVoucherForm = z.infer<typeof cancelVoucherSchema>;

export const reopenPeriodSchema = z.object({
  reason: z.string().trim().min(3, "A reason is required").max(500),
});

export type ReopenPeriodForm = z.infer<typeof reopenPeriodSchema>;

/** Rounded per line then summed — the `money()` rule the backend uses. */
export function sumSide(
  entries: Array<{ debit: number; credit: number }>,
  side: "debit" | "credit",
): number {
  return (
    entries.reduce(
      (total, entry) => total + Math.round((Number(entry[side]) || 0) * 100),
      0,
    ) / 100
  );
}

/** Signed difference (debit − credit) for the live balance indicator. */
export function balanceDifference(
  entries: Array<{ debit: number; credit: number }>,
): number {
  return (
    Math.round((sumSide(entries, "debit") - sumSide(entries, "credit")) * 100) /
    100
  );
}

export const GROUP_ORDER: AccountGroup[] = [
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "INCOME",
  "EXPENSE",
];
