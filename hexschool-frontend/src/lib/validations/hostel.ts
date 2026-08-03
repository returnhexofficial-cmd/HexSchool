import { z } from "zod";

/** Mirrors the backend Hostel Management DTOs (Module 26). */

export const HOSTEL_TYPE_VALUES = ["BOYS", "GIRLS"] as const;
export const HOSTEL_STATUS_VALUES = ["ACTIVE", "INACTIVE"] as const;
export const ROOM_TYPE_VALUES = ["STANDARD", "AC", "SHARED"] as const;
export const ROOM_STATUS_VALUES = ["ACTIVE", "MAINTENANCE"] as const;
export const BED_STATUS_VALUES = [
  "VACANT",
  "OCCUPIED",
  "MAINTENANCE",
] as const;

/** PROJECT_CONTEXT §12's BD mobile shape, mirrored from the DTO. */
export const BD_PHONE = /^01[3-9]\d{8}$/;

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

const optionalDate = z
  .string()
  .optional()
  .refine(
    (value) => !value || DATE_SHAPE.test(value),
    "Use the date picker (YYYY-MM-DD)",
  );

const requiredDate = z
  .string()
  .regex(DATE_SHAPE, "Use the date picker (YYYY-MM-DD)");

/** Money: two decimals, mirroring the NUMERIC(12,2) contract. */
const money = (label: string) =>
  z.coerce
    .number()
    .min(0, `${label} cannot be negative`)
    .refine(
      (value) => Math.round(value * 100) === value * 100,
      "At most two decimal places",
    );

export const hostelSchema = z.object({
  name: z.string().min(2, "At least 2 characters").max(160),
  nameBn: z.string().max(160).optional(),
  type: z.enum(HOSTEL_TYPE_VALUES, {
    message: "Say whether this is the boys' or the girls' hostel",
  }),
  wardenStaffId: z.string().uuid().optional().or(z.literal("")),
  address: z.string().max(500).optional(),
  phone: z
    .string()
    .regex(BD_PHONE, "Use a BD mobile number (01XXXXXXXXX)")
    .optional()
    .or(z.literal("")),
  /**
   * The DECLARED capacity, which the occupancy report prints beside the
   * real bed count. Zero means "not declared" — it is never used in an
   * allocation decision, so leaving it blank costs nothing.
   */
  capacity: z.coerce.number().int().min(0).max(5000).optional(),
  status: z.enum(HOSTEL_STATUS_VALUES).optional(),
  notes: z.string().max(1000).optional(),
});

export const roomSchema = z.object({
  roomNo: z.string().min(1, "A room needs a number").max(40),
  floor: z.coerce.number().int().min(-5).max(200).optional(),
  type: z.enum(ROOM_TYPE_VALUES).optional(),
  /** Roadmap §7: the beds generated have to match this. */
  bedCount: z.coerce
    .number()
    .int("Whole beds only")
    .min(1, "A room has at least one bed")
    .max(50, "That is more beds than a room holds — check the number"),
  monthlyFee: money("The seat rent"),
  status: z.enum(ROOM_STATUS_VALUES).optional(),
  notes: z.string().max(1000).optional(),
  generateBeds: z.boolean().optional(),
});

export const generateBedsSchema = z.object({
  count: z.coerce.number().int().min(1).max(50),
  prefix: z.string().max(10).optional(),
});

export const bedSchema = z.object({
  bedNo: z.string().min(1, "A bed needs a number").max(20),
  status: z.enum(BED_STATUS_VALUES).optional(),
  notes: z.string().max(500).optional(),
});

export const allocationSchema = z.object({
  enrollmentId: z.string().uuid("Pick a student"),
  bedId: z.string().uuid("Pick a bed"),
  startDate: optionalDate,
  securityDeposit: money("The deposit").optional(),
  messPlanId: z.string().uuid().optional().or(z.literal("")),
  remarks: z.string().max(1000).optional(),
  override: z.boolean().optional(),
});

export const transferSchema = z.object({
  bedId: z.string().uuid("Pick the bed they are moving to"),
  reason: z.string().min(3, "Say why they are moving").max(500),
  override: z.boolean().optional(),
});

export const suspendSchema = z.object({
  reason: z.string().min(3, "Say why the residency is pausing").max(500),
  effectiveDate: optionalDate,
});

export const vacateSchema = z.object({
  reason: z.string().min(3, "Say why they are leaving").max(500),
  endDate: optionalDate,
  override: z.boolean().optional(),
});

/**
 * Every deduction carries a reason, because the family is being told they
 * are getting less back than they paid and "administrative" is not
 * something anybody can argue with. The server refuses it too — this is
 * the mirror, not the guarantee.
 */
export const deductionSchema = z.object({
  amount: money("A deduction"),
  reason: z.string().min(3, "Say what is being deducted for").max(300),
});

export const refundSchema = z.object({
  deductions: z.array(deductionSchema).max(20).optional(),
  refundedAt: optionalDate,
  note: z.string().max(1000).optional(),
});

export const messPlanSchema = z.object({
  hostelId: z.string().uuid("Pick a hostel"),
  name: z.string().min(2, "At least 2 characters").max(160),
  description: z.string().max(1000).optional(),
  monthlyCharge: money("The mess charge"),
  status: z.enum(HOSTEL_STATUS_VALUES).optional(),
});

export const messEnrollmentSchema = z.object({
  allocationId: z.string().uuid("Pick a boarder"),
  planId: z.string().uuid("Pick a plan"),
  startDate: optionalDate,
});

/**
 * The date order is checked here as well as by
 * `chk_meal_offs_window` — the client message can say which field is
 * wrong, which a constraint name cannot. The **minimum duration** is
 * deliberately NOT checked here: it is a per-school setting the form does
 * not know, and duplicating it would mean a school that lowered it still
 * saw the old refusal.
 */
export const mealOffSchema = z
  .object({
    allocationId: z.string().uuid("Pick a boarder"),
    fromDate: requiredDate,
    toDate: requiredDate,
    reason: z.string().min(3, "Say why they are away").max(500),
  })
  .refine((value) => value.toDate >= value.fromDate, {
    message: "The last day cannot be before the first",
    path: ["toDate"],
  });

export const decideMealOffSchema = z.object({
  approve: z.boolean(),
  note: z.string().max(500).optional(),
});

export type HostelFormValues = z.infer<typeof hostelSchema>;
export type RoomFormValues = z.infer<typeof roomSchema>;
export type BedFormValues = z.infer<typeof bedSchema>;
export type AllocationFormValues = z.infer<typeof allocationSchema>;
export type TransferFormValues = z.infer<typeof transferSchema>;
export type SuspendFormValues = z.infer<typeof suspendSchema>;
export type VacateFormValues = z.infer<typeof vacateSchema>;
export type RefundFormValues = z.infer<typeof refundSchema>;
export type MessPlanFormValues = z.infer<typeof messPlanSchema>;
export type MessEnrollmentFormValues = z.infer<typeof messEnrollmentSchema>;
export type MealOffFormValues = z.infer<typeof mealOffSchema>;
