import { z } from "zod";

/** Mirrors backend UpdateSchoolDto (roadmap M04 §7). */
export const schoolProfileSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(200),
  nameBn: z.string().trim().max(200).optional().or(z.literal("")),
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{2,10}$/, "2–10 uppercase letters/digits (e.g. HEX)"),
  eiinNumber: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "EIIN is exactly 6 digits")
    .optional()
    .or(z.literal("")),
  type: z.enum([
    "PRIMARY",
    "HIGH_SCHOOL",
    "KINDERGARTEN",
    "ENGLISH_VERSION",
    "ENGLISH_MEDIUM",
    "MADRASA",
    "VOCATIONAL",
    "COLLEGE",
  ]),
  address: z.string().trim().max(500).optional().or(z.literal("")),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  email: z.email("Enter a valid email").optional().or(z.literal("")),
  website: z
    .url("Include the protocol, e.g. https://school.edu.bd")
    .max(200)
    .optional()
    .or(z.literal("")),
  // Kept as a string in the form; converted to number at the API call.
  establishedYear: z
    .string()
    .trim()
    .regex(/^\d{4}$/, "4-digit year")
    .refine(
      (v) => Number(v) >= 1800 && Number(v) <= new Date().getFullYear(),
      `Between 1800 and ${new Date().getFullYear()}`,
    )
    .optional()
    .or(z.literal("")),
  principalName: z.string().trim().max(120).optional().or(z.literal("")),
});

export type SchoolProfileValues = z.infer<typeof schoolProfileSchema>;
