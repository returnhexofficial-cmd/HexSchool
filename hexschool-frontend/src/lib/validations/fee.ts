import { z } from "zod";
import type {
  FeeHeadType,
  FeeOverrideType,
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
} from "@/lib/api/fee";

/** Mirrors the backend Fees & Payments DTOs (Module 16). */

export const FEE_HEAD_TYPES = [
  "RECURRING_MONTHLY",
  "ONE_TIME",
  "ON_DEMAND",
] as const;

export const FEE_HEAD_TYPE_LABELS: Record<FeeHeadType, string> = {
  RECURRING_MONTHLY: "Monthly (recurring)",
  ONE_TIME: "One-time",
  ON_DEMAND: "On demand",
};

export const FEE_OVERRIDE_TYPES = [
  "DISCOUNT_PERCENT",
  "DISCOUNT_FLAT",
  "WAIVER",
  "SCHOLARSHIP",
] as const;

export const FEE_OVERRIDE_TYPE_LABELS: Record<FeeOverrideType, string> = {
  DISCOUNT_PERCENT: "Discount (%)",
  DISCOUNT_FLAT: "Discount (flat)",
  WAIVER: "Full waiver",
  SCHOLARSHIP: "Scholarship",
};

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  UNPAID: "Unpaid",
  PARTIAL: "Partial",
  PAID: "Paid",
  OVERDUE: "Overdue",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

export const INVOICE_STATUS_VARIANT: Record<
  InvoiceStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  UNPAID: "outline",
  PARTIAL: "secondary",
  PAID: "default",
  OVERDUE: "destructive",
  CANCELLED: "secondary",
  REFUNDED: "secondary",
};

export const PAYMENT_STATUS_VARIANT: Record<
  PaymentStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  SUCCESS: "default",
  PENDING: "outline",
  FAILED: "destructive",
  REFUNDED: "secondary",
  CANCELLED: "secondary",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Cash",
  BANK: "Bank transfer",
  CHEQUE: "Cheque",
  ADJUSTMENT: "Adjustment",
  SSLCOMMERZ: "SSLCommerz",
  BKASH: "bKash",
  NAGAD: "Nagad",
  ROCKET: "Rocket",
};

// ── schemas ─────────────────────────────────────────────────────────────

const money = z
  .number({ message: "Enter an amount" })
  .min(0, "Cannot be negative")
  .max(99999999, "Too large");

export const feeHeadSchema = z.object({
  name: z.string().trim().min(2, "Name is too short").max(100),
  code: z.string().trim().max(20).optional(),
  type: z.enum(FEE_HEAD_TYPES),
  isRefundable: z.boolean(),
  displayOrder: z.number().int().min(0).max(999).optional(),
});

export type FeeHeadForm = z.infer<typeof feeHeadSchema>;

export const feeOverrideSchema = z
  .object({
    feeHeadId: z.string().uuid("Pick a fee head"),
    type: z.enum(FEE_OVERRIDE_TYPES),
    value: money,
    reason: z.string().trim().min(3, "A reason is required").max(500),
  })
  .refine(
    (v) => v.type !== "DISCOUNT_PERCENT" || v.value <= 100,
    { message: "A percentage cannot exceed 100", path: ["value"] },
  );

export type FeeOverrideForm = z.infer<typeof feeOverrideSchema>;

export const collectPaymentSchema = z.object({
  amount: money.refine((v) => v >= 0.01, "Enter an amount"),
  method: z.enum(["CASH", "BANK", "CHEQUE", "ADJUSTMENT"]),
  reference: z.string().trim().max(100).optional(),
  paidOn: z.string().optional(),
  remarks: z.string().trim().max(500).optional(),
});

export type CollectPaymentForm = z.infer<typeof collectPaymentSchema>;

export const refundSchema = z.object({
  amount: money.refine((v) => v >= 0.01, "Enter an amount"),
  reason: z.string().trim().min(3, "A reason is required").max(500),
});

export type RefundForm = z.infer<typeof refundSchema>;
