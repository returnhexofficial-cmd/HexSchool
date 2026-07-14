import { z } from "zod";

/**
 * Shared validation primitives. Zod schemas mirror backend DTOs — each
 * module adds its schemas in this folder (e.g. `student.ts`, `auth.ts`).
 */

/** BD mobile format, normalized to `01XXXXXXXXX`. */
export const bdPhoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/^\+?88/, ""))
  .pipe(z.string().regex(/^01[3-9]\d{8}$/, "Enter a valid BD phone number"));

/** Password policy: min 8 chars with upper, lower, and digit. */
export const passwordSchema = z
  .string()
  .min(8, "At least 8 characters")
  .regex(/[A-Z]/, "Include an uppercase letter")
  .regex(/[a-z]/, "Include a lowercase letter")
  .regex(/\d/, "Include a digit");
