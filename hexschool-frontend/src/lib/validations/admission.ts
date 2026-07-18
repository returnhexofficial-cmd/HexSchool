import { z } from "zod";
import { GUARDIAN_RELATIONS, RELIGIONS } from "./student";

export { GUARDIAN_RELATIONS, RELIGIONS };

/** Mirrors backend M10 DTOs. */

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const bdPhone = z
  .string()
  .trim()
  .regex(/^01[3-9]\d{8}$/, "BD mobile: 01XXXXXXXXX");

export const CYCLE_STATUSES = [
  "DRAFT",
  "OPEN",
  "CLOSED",
  "COMPLETED",
] as const;

export const APPLICATION_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "PAYMENT_PENDING",
  "UNDER_REVIEW",
  "TEST_SCHEDULED",
  "PASSED",
  "FAILED",
  "SELECTED",
  "WAITLISTED",
  "ADMITTED",
  "REJECTED",
  "CANCELLED",
  "EXPIRED",
] as const;

export const PAYMENT_METHODS = [
  "CASH",
  "BANK",
  "BKASH",
  "NAGAD",
  "ROCKET",
  "OTHER",
] as const;

/** One class row in the cycle form (numbers as strings in RHF). */
export const cycleClassEntrySchema = z.object({
  classId: z.string().min(1, "Pick a class"),
  seats: z
    .string()
    .trim()
    .regex(/^[1-9]\d{0,3}$/, "Seats: whole number ≥ 1"),
  applicationFee: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Amount, e.g. 200")
    .optional()
    .or(z.literal("")),
});

export type CycleClassEntryValues = z.infer<typeof cycleClassEntrySchema>;

export const cycleSchema = z
  .object({
    sessionId: z.string().min(1, "Pick a session"),
    name: z.string().trim().min(3, "At least 3 characters").max(120),
    startAt: dateString,
    endAt: dateString,
    testRequired: z.boolean(),
    instructions: z.string().trim().max(5000).optional().or(z.literal("")),
    classes: z.array(cycleClassEntrySchema).min(1, "Add at least one class"),
  })
  .refine((v) => v.startAt < v.endAt, {
    message: "End date must be after start date",
    path: ["endAt"],
  })
  .refine(
    (v) => new Set(v.classes.map((c) => c.classId)).size === v.classes.length,
    { message: "The same class appears more than once", path: ["classes"] },
  );

export type CycleValues = z.infer<typeof cycleSchema>;

export const testSlotSchema = z
  .object({
    classId: z.string().min(1),
    testDate: dateString,
    venue: z.string().trim().max(200).optional().or(z.literal("")),
    totalMarks: z
      .string()
      .trim()
      .regex(/^[1-9]\d{0,3}$/, "Whole number ≥ 1"),
    passMarks: z
      .string()
      .trim()
      .regex(/^\d{1,4}$/, "Whole number ≥ 0"),
  })
  .refine((v) => Number(v.passMarks) <= Number(v.totalMarks), {
    message: "Pass marks cannot exceed total marks",
    path: ["passMarks"],
  });

export type TestSlotValues = z.infer<typeof testSlotSchema>;

export const recordPaymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(100).optional().or(z.literal("")),
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Amount, e.g. 200")
    .optional()
    .or(z.literal("")),
});

export type RecordPaymentValues = z.infer<typeof recordPaymentSchema>;

export const reviewStatusSchema = z.object({
  status: z.enum(APPLICATION_STATUSES),
  reason: z.string().trim().min(3, "Give a reason").max(500),
});

export type ReviewStatusValues = z.infer<typeof reviewStatusSchema>;

// ── public application form (multi-step) ────────────────────────────

/** Step 1 — phone verification. */
export const applyPhoneSchema = z.object({ phone: bdPhone });
export type ApplyPhoneValues = z.infer<typeof applyPhoneSchema>;

export const applyOtpSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "The code is 6 digits"),
});
export type ApplyOtpValues = z.infer<typeof applyOtpSchema>;

/** Step 2 — applicant details. */
export const applyApplicantSchema = z.object({
  cycleId: z.string().min(1, "Pick an admission cycle"),
  classId: z.string().min(1, "Pick a class"),
  firstName: z.string().trim().min(1, "Required").max(100),
  lastName: z.string().trim().min(1, "Required").max(100),
  nameBn: z.string().trim().max(200).optional().or(z.literal("")),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  dob: dateString,
  religion: z.enum(RELIGIONS),
  presentAddress: z.string().trim().max(300).optional().or(z.literal("")),
  previousSchool: z.string().trim().max(300).optional().or(z.literal("")),
  previousGpa: z
    .string()
    .trim()
    .regex(/^[0-5](\.\d{1,2})?$/, "GPA 0–5, e.g. 4.50")
    .optional()
    .or(z.literal("")),
});
export type ApplyApplicantValues = z.infer<typeof applyApplicantSchema>;

/** Step 3 — guardian snapshot. */
export const applyGuardianSchema = z.object({
  name: z.string().trim().min(1, "Required").max(200),
  nameBn: z.string().trim().max(200).optional().or(z.literal("")),
  relation: z.enum(GUARDIAN_RELATIONS),
  phone: bdPhone,
  email: z.string().trim().email("Invalid email").optional().or(z.literal("")),
  occupation: z.string().trim().max(120).optional().or(z.literal("")),
});
export type ApplyGuardianValues = z.infer<typeof applyGuardianSchema>;

export const trackSchema = z.object({
  appNo: z.string().trim().min(3, "Enter the application number").max(30),
  phone: bdPhone,
});
export type TrackValues = z.infer<typeof trackSchema>;
