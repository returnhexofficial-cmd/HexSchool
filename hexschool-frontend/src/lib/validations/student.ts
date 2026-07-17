import { z } from "zod";
import { BLOOD_GROUPS } from "./staff";

/** Mirrors backend M09 DTOs. */

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const bdPhone = z
  .string()
  .trim()
  .regex(/^01[3-9]\d{8}$/, "BD mobile: 01XXXXXXXXX");

export const RELIGIONS = [
  "ISLAM",
  "HINDUISM",
  "BUDDHISM",
  "CHRISTIANITY",
  "OTHER",
] as const;

export const STUDENT_STATUSES = [
  "ACTIVE",
  "INACTIVE",
  "TRANSFERRED",
  "GRADUATED",
  "DROPPED",
  "SUSPENDED",
] as const;

export const GUARDIAN_RELATIONS = [
  "FATHER",
  "MOTHER",
  "BROTHER",
  "SISTER",
  "UNCLE",
  "AUNT",
  "GRANDPARENT",
  "LEGAL_GUARDIAN",
  "OTHER",
] as const;

export const STUDENT_DOCUMENT_TYPES = [
  "BIRTH_CERTIFICATE",
  "PHOTO",
  "TRANSFER_CERTIFICATE",
  "PREVIOUS_MARKSHEET",
  "OTHER",
] as const;

/** Wizard step 1 — personal details. */
export const studentPersonalSchema = z.object({
  firstName: z.string().trim().min(1, "Required").max(100),
  lastName: z.string().trim().min(1, "Required").max(100),
  nameBn: z.string().trim().max(200).optional().or(z.literal("")),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  dob: dateString,
  bloodGroup: z.enum(BLOOD_GROUPS).optional().or(z.literal("")),
  religion: z.enum(RELIGIONS),
  birthCertificateNo: z
    .string()
    .trim()
    .regex(/^\d{17}$/, "Birth certificate is 17 digits")
    .optional()
    .or(z.literal("")),
  admissionDate: dateString,
  admissionClassId: z.string().min(1, "Pick a class"),
  previousSchool: z.string().trim().max(300).optional().or(z.literal("")),
});

export type StudentPersonalValues = z.infer<typeof studentPersonalSchema>;

/** Wizard step 2 — one guardian row (existing pick OR inline create). */
export const guardianEntrySchema = z
  .object({
    guardianId: z.string().optional().or(z.literal("")),
    name: z.string().trim().max(200).optional().or(z.literal("")),
    phone: bdPhone.optional().or(z.literal("")),
    email: z
      .string()
      .trim()
      .email("Invalid email")
      .optional()
      .or(z.literal("")),
    nid: z
      .string()
      .trim()
      .regex(/^(\d{10}|\d{13}|\d{17})$/, "NID is 10, 13 or 17 digits")
      .optional()
      .or(z.literal("")),
    occupation: z.string().trim().max(120).optional().or(z.literal("")),
    relation: z.enum(GUARDIAN_RELATIONS),
    isPrimary: z.boolean(),
    isEmergencyContact: z.boolean(),
  })
  .refine((v) => v.guardianId || (v.name && v.phone), {
    message: "Pick an existing guardian or enter a name + phone",
    path: ["name"],
  });

export type GuardianEntryValues = z.infer<typeof guardianEntrySchema>;

/** Wizard step 3 — addresses. */
export const studentAddressSchema = z.object({
  presentAddress: z.string().trim().max(300).optional().or(z.literal("")),
  permanentAddress: z.string().trim().max(300).optional().or(z.literal("")),
});

export type StudentAddressValues = z.infer<typeof studentAddressSchema>;

/** Wizard step 4 — medical (all optional; numbers kept as strings in RHF). */
export const studentMedicalSchema = z.object({
  heightCm: z
    .string()
    .trim()
    .regex(/^\d{1,3}(\.\d{1,2})?$/, "Number, e.g. 140.5")
    .optional()
    .or(z.literal("")),
  weightKg: z
    .string()
    .trim()
    .regex(/^\d{1,3}(\.\d{1,2})?$/, "Number, e.g. 38.2")
    .optional()
    .or(z.literal("")),
  allergies: z.string().trim().max(2000).optional().or(z.literal("")),
  chronicConditions: z.string().trim().max(2000).optional().or(z.literal("")),
  disabilities: z.string().trim().max(2000).optional().or(z.literal("")),
  emergencyNotes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export type StudentMedicalValues = z.infer<typeof studentMedicalSchema>;

export const studentStatusSchema = z.object({
  status: z.enum(STUDENT_STATUSES),
  reason: z.string().trim().min(3, "Give a reason").max(500),
});

export type StudentStatusValues = z.infer<typeof studentStatusSchema>;

/** Standalone guardian create/edit form. */
export const guardianSchema = z.object({
  name: z.string().trim().min(1, "Required").max(200),
  nameBn: z.string().trim().max(200).optional().or(z.literal("")),
  relation: z.enum(GUARDIAN_RELATIONS),
  phone: bdPhone,
  email: z.string().trim().email("Invalid email").optional().or(z.literal("")),
  nid: z
    .string()
    .trim()
    .regex(/^(\d{10}|\d{13}|\d{17})$/, "NID is 10, 13 or 17 digits")
    .optional()
    .or(z.literal("")),
  occupation: z.string().trim().max(120).optional().or(z.literal("")),
  monthlyIncome: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Number")
    .optional()
    .or(z.literal("")),
  presentAddress: z.string().trim().max(300).optional().or(z.literal("")),
});

export type GuardianValues = z.infer<typeof guardianSchema>;

export const portalAccountSchema = z
  .object({
    phone: bdPhone.optional().or(z.literal("")),
    email: z
      .string()
      .trim()
      .email("Invalid email")
      .optional()
      .or(z.literal("")),
  })
  .refine((v) => v.phone || v.email, {
    message: "Provide a phone or an email",
    path: ["phone"],
  });

export type PortalAccountValues = z.infer<typeof portalAccountSchema>;

/** Guardian entries must resolve to exactly one primary (M09 §6). */
export function validateGuardianEntries(
  entries: GuardianEntryValues[],
): string | null {
  if (entries.length === 0) return "Add at least one guardian";
  const primaries = entries.filter((e) => e.isPrimary).length;
  if (primaries === 0 && entries.length > 1)
    return "Mark exactly one guardian as primary";
  if (primaries > 1) return "Only one guardian can be primary";
  const phones = entries.map((e) => e.phone).filter(Boolean);
  if (new Set(phones).size !== phones.length)
    return "The same guardian phone appears more than once";
  return null;
}
