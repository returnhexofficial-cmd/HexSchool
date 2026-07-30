import { z } from "zod";
import type {
  BonusBasis,
  ComponentCalc,
  ComponentType,
  LeaveStatus,
  PayrollRunStatus,
  PayslipStatus,
} from "@/lib/api/hr";

/** Mirrors the backend HR & Payroll DTOs (Module 21). */

export const COMPONENT_TYPES = ["ALLOWANCE", "DEDUCTION"] as const;
export const COMPONENT_CALCS = ["FLAT", "PERCENT_OF_BASIC"] as const;
export const PAYMENT_MODES = ["BANK", "CASH", "MOBILE_BANKING"] as const;
export const BONUS_TYPES = ["FESTIVAL", "PERFORMANCE", "OTHER"] as const;
export const BONUS_BASES = ["PERCENT_OF_BASIC", "FLAT"] as const;
export const LEAVE_APPLICABLE_TO = ["ALL", "TEACHER", "STAFF"] as const;

export const COMPONENT_CALC_LABELS: Record<ComponentCalc, string> = {
  FLAT: "Flat (BDT)",
  PERCENT_OF_BASIC: "% of basic",
};

export const COMPONENT_TYPE_LABELS: Record<ComponentType, string> = {
  ALLOWANCE: "Allowance",
  DEDUCTION: "Deduction",
};

export const BONUS_BASIS_LABELS: Record<BonusBasis, string> = {
  PERCENT_OF_BASIC: "% of basic",
  FLAT: "Flat (BDT)",
};

export const LEAVE_STATUS_VARIANT: Record<
  LeaveStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  PENDING: "outline",
  APPROVED: "default",
  REJECTED: "destructive",
  CANCELLED: "secondary",
};

export const RUN_STATUS_VARIANT: Record<
  PayrollRunStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  DRAFT: "outline",
  GENERATED: "secondary",
  APPROVED: "secondary",
  DISBURSED: "default",
  CANCELLED: "destructive",
};

export const PAYSLIP_STATUS_VARIANT: Record<
  PayslipStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  PENDING: "outline",
  PAID: "default",
  HELD: "destructive",
};

// ── schemas ─────────────────────────────────────────────────────────────

const money = z
  .number({ message: "Enter an amount" })
  .min(0, "Cannot be negative")
  .refine((v) => Number.isFinite(v) && Math.round(v * 100) === v * 100, {
    message: "At most 2 decimal places",
  });

const days = z
  .number({ message: "Enter a number of days" })
  .min(0, "Cannot be negative")
  .max(365, "That is more than a year");

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const monthString = z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM");

export const leaveTypeSchema = z
  .object({
    name: z.string().trim().min(2, "Name is required").max(80),
    code: z
      .string()
      .trim()
      .min(2)
      .max(30)
      .regex(/^[A-Z0-9_]+$/, "UPPER_SNAKE_CASE — it is a stable handle"),
    annualQuota: days,
    carryForward: z.boolean(),
    maxCarry: days,
    isPaid: z.boolean(),
    applicableTo: z.enum(LEAVE_APPLICABLE_TO),
  })
  // The DB CHECK pins `max_carry` to 0 when carry-forward is off; saying
  // so here means the form explains it instead of the server refusing it.
  .refine((v) => v.carryForward || v.maxCarry === 0, {
    message: "A carry cap only means something when carry-forward is on",
    path: ["maxCarry"],
  });

export type LeaveTypeValues = z.infer<typeof leaveTypeSchema>;

export const leaveApplicationSchema = z
  .object({
    personType: z.enum(["TEACHER", "STAFF"]),
    personId: z.string().min(1, "Pick an employee"),
    leaveTypeId: z.string().min(1, "Pick a leave type"),
    fromDate: dateString,
    toDate: dateString,
    halfDay: z.boolean().optional(),
    reason: z.string().trim().min(3, "Give a reason").max(500),
  })
  .refine((v) => v.fromDate <= v.toDate, {
    message: "End must be on/after start",
    path: ["toDate"],
  })
  // Mirrors `chk_leave_applications_range`: half of a fortnight is not a
  // half-day leave, it is a data-entry mistake that would consume 0.5 of
  // quota for two weeks off.
  .refine((v) => !v.halfDay || v.fromDate === v.toDate, {
    message: "A half day covers exactly one date",
    path: ["halfDay"],
  });

export type LeaveApplicationValues = z.infer<typeof leaveApplicationSchema>;

export const salaryComponentSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(80),
    type: z.enum(COMPONENT_TYPES),
    calc: z.enum(COMPONENT_CALCS),
    value: money,
    isTaxable: z.boolean(),
    isPfBase: z.boolean(),
  })
  // The roadmap §7 rule, also a DB CHECK and an engine rule: a percentage
  // of basic above 100 is a typo every time.
  .refine((v) => v.calc !== "PERCENT_OF_BASIC" || v.value <= 100, {
    message: "A percentage of basic cannot exceed 100",
    path: ["value"],
  });

export type SalaryComponentValues = z.infer<typeof salaryComponentSchema>;

export const salaryStructureSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  grade: z.string().trim().max(30).optional().or(z.literal("")),
  basic: money,
  description: z.string().trim().max(500).optional().or(z.literal("")),
  components: z.array(salaryComponentSchema).max(40),
});

export type SalaryStructureValues = z.infer<typeof salaryStructureSchema>;

export const assignSalarySchema = z
  .object({
    personType: z.enum(["TEACHER", "STAFF"]),
    structureId: z.string().min(1, "Pick a salary structure"),
    basicOverride: money.optional(),
    effectiveFrom: dateString,
    paymentMode: z.enum(PAYMENT_MODES),
    bankName: z.string().trim().max(150).optional().or(z.literal("")),
    branchName: z.string().trim().max(150).optional().or(z.literal("")),
    accountNo: z.string().trim().max(40).optional().or(z.literal("")),
    accountName: z.string().trim().max(150).optional().or(z.literal("")),
    routingNo: z.string().trim().max(30).optional().or(z.literal("")),
    note: z.string().trim().max(300).optional().or(z.literal("")),
  })
  // Roadmap §7. The bank advice sheet is generated weeks later; a blank
  // account number discovered then is a payment nobody can make.
  .refine((v) => v.paymentMode !== "BANK" || (v.bankName && v.accountNo), {
    message: "Bank name and account number are required for a bank transfer",
    path: ["accountNo"],
  });

export type AssignSalaryValues = z.infer<typeof assignSalarySchema>;

export const payrollRunSchema = z.object({
  month: monthString,
  note: z.string().trim().max(500).optional().or(z.literal("")),
});

export type PayrollRunValues = z.infer<typeof payrollRunSchema>;

export const bonusRunSchema = z
  .object({
    name: z.string().trim().min(2, "Name is required").max(120),
    type: z.enum(BONUS_TYPES),
    basis: z.enum(BONUS_BASES),
    value: money,
    monthPaidWith: monthString.optional().or(z.literal("")),
    minServiceMonths: z.number().int().min(0).max(600),
    prorate: z.boolean(),
    applicableTo: z.enum(LEAVE_APPLICABLE_TO),
  })
  .refine((v) => v.basis !== "PERCENT_OF_BASIC" || v.value <= 100, {
    message: "A percentage of basic cannot exceed 100",
    path: ["value"],
  });

export type BonusRunValues = z.infer<typeof bonusRunSchema>;

export const payslipEditSchema = z.object({
  reason: z.string().trim().min(5, "Say why — this is audited").max(300),
  bonus: money.optional(),
  adHoc: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(80),
        type: z.enum(COMPONENT_TYPES),
        amount: money,
      }),
    )
    .max(20)
    .optional(),
});

export type PayslipEditValues = z.infer<typeof payslipEditSchema>;

export const holdPayslipSchema = z.object({
  reason: z.string().trim().min(5, "Say why — the employee will ask").max(300),
});

export type HoldPayslipValues = z.infer<typeof holdPayslipSchema>;

export const pfEntrySchema = z.object({
  personType: z.enum(["TEACHER", "STAFF"]),
  personId: z.string().min(1, "Pick an employee"),
  month: monthString,
  type: z.enum(["WITHDRAWAL", "ADJUSTMENT"]),
  employeeAmt: money.optional(),
  employerAmt: money.optional(),
  note: z.string().trim().min(3, "Say what this is").max(300),
});

export type PfEntryValues = z.infer<typeof pfEntrySchema>;
