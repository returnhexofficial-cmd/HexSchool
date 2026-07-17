import { z } from "zod";

/** Mirrors backend M07 DTOs. */

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const DESIGNATIONS = [
  "PRINCIPAL",
  "VICE_PRINCIPAL",
  "ACCOUNTANT",
  "ADMISSION_OFFICER",
  "LIBRARIAN",
  "OFFICE_STAFF",
  "LAB_ASSISTANT",
  "SECURITY",
  "CLEANER",
  "OTHER",
] as const;

export const BLOOD_GROUPS = [
  "A+",
  "A-",
  "B+",
  "B-",
  "AB+",
  "AB-",
  "O+",
  "O-",
] as const;

export const staffSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email("Invalid email")
      .optional()
      .or(z.literal("")),
    phone: z
      .string()
      .trim()
      .regex(/^01[3-9]\d{8}$/, "BD mobile: 01XXXXXXXXX")
      .optional()
      .or(z.literal("")),
    firstName: z.string().trim().min(1, "Required").max(100),
    lastName: z.string().trim().min(1, "Required").max(100),
    nameBn: z.string().trim().max(200).optional().or(z.literal("")),
    designation: z.enum(DESIGNATIONS),
    departmentId: z.string().optional().or(z.literal("")),
    gender: z.enum(["MALE", "FEMALE", "OTHER"]),
    dob: dateString,
    bloodGroup: z.enum(BLOOD_GROUPS).optional().or(z.literal("")),
    nidNumber: z
      .string()
      .trim()
      .regex(/^(\d{10}|\d{13}|\d{17})$/, "NID is 10, 13 or 17 digits")
      .optional()
      .or(z.literal("")),
    presentAddress: z.string().trim().max(300).optional().or(z.literal("")),
    permanentAddress: z.string().trim().max(300).optional().or(z.literal("")),
    joiningDate: dateString,
    employmentType: z.enum(["PERMANENT", "CONTRACT", "PART_TIME"]),
  })
  .refine((v) => v.email || v.phone, {
    message: "Provide an email or a phone number",
    path: ["phone"],
  });

export type StaffFormValues = z.infer<typeof staffSchema>;

export const staffStatusSchema = z.object({
  status: z.enum(["ACTIVE", "ON_LEAVE", "RESIGNED", "TERMINATED", "RETIRED"]),
  reason: z.string().trim().min(3, "Give a short reason").max(500),
});

export type StaffStatusValues = z.infer<typeof staffStatusSchema>;

export const staffDocumentSchema = z.object({
  title: z.string().trim().min(1, "Required").max(200),
  type: z.enum(["NID", "CERTIFICATE", "CV", "PHOTO", "CONTRACT", "OTHER"]),
});

export type StaffDocumentValues = z.infer<typeof staffDocumentSchema>;
