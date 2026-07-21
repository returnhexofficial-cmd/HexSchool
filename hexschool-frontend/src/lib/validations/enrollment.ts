import { z } from "zod";

/** Mirrors backend M11 DTOs. */

export const ENROLLMENT_TYPES = [
  "NEW",
  "PROMOTED",
  "READMITTED",
  "TRANSFERRED_IN",
] as const;

export const ENROLLMENT_STATUSES = [
  "ACTIVE",
  "TRANSFERRED_OUT",
  "PROMOTED",
  "RETAINED",
  "COMPLETED",
  "CANCELLED",
] as const;

export const PROMOTION_DECISIONS = [
  "PROMOTE",
  "RETAIN",
  "GRADUATE",
  "EXCLUDE",
] as const;

export const PROMOTION_DECISION_LABELS: Record<
  (typeof PROMOTION_DECISIONS)[number],
  string
> = {
  PROMOTE: "Promote",
  RETAIN: "Retain",
  GRADUATE: "Graduate",
  EXCLUDE: "Exclude",
};

const ROLL_MIN = 1;
const ROLL_MAX = 9999;

export const rollSchema = z
  .number({ message: "Roll must be a number" })
  .int("Roll must be a whole number")
  .min(ROLL_MIN, `Roll must be ≥ ${ROLL_MIN}`)
  .max(ROLL_MAX, `Roll must be ≤ ${ROLL_MAX}`);

export const enrollSchema = z.object({
  studentId: z.string().uuid(),
  sessionId: z.string().uuid(),
  sectionId: z.string().uuid(),
  rollNo: rollSchema.optional(),
  optionalSubjectId: z.string().uuid().optional(),
  overrideCapacity: z.boolean().optional(),
});

export type EnrollFormValues = z.infer<typeof enrollSchema>;

export const transferSchema = z.object({
  toSectionId: z.string().uuid({ message: "Choose a target section" }),
  keepRoll: z.boolean().optional(),
  reason: z.string().max(500).optional(),
  overrideCapacity: z.boolean().optional(),
});

export type TransferFormValues = z.infer<typeof transferSchema>;

export const rollEditSchema = z.object({
  rollNo: rollSchema,
});

export type RollEditFormValues = z.infer<typeof rollEditSchema>;

export const createPromotionSchema = z
  .object({
    fromSessionId: z.string().uuid({ message: "Choose the source session" }),
    toSessionId: z.string().uuid({ message: "Choose the target session" }),
  })
  .refine((v) => v.fromSessionId !== v.toSessionId, {
    message: "Source and target sessions must differ",
    path: ["toSessionId"],
  });

export type CreatePromotionFormValues = z.infer<typeof createPromotionSchema>;
