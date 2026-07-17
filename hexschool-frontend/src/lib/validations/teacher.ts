import { z } from "zod";
import { BLOOD_GROUPS } from "./staff";

/** Mirrors backend M08 DTOs. */

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const TEACHER_DESIGNATIONS = [
  "HEAD_TEACHER",
  "ASSISTANT_HEAD",
  "SENIOR_TEACHER",
  "ASSISTANT_TEACHER",
  "SUBJECT_TEACHER",
  "PART_TIME",
] as const;

export const LEAVE_TYPES = [
  "CASUAL",
  "SICK",
  "MATERNITY",
  "UNPAID",
  "OTHER",
] as const;

export const teacherSchema = z
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
    designation: z.enum(TEACHER_DESIGNATIONS),
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
    salaryGrade: z.string().trim().max(30).optional().or(z.literal("")),
    mpoIndexNo: z.string().trim().max(30).optional().or(z.literal("")),
    specialization: z.string().trim().max(200).optional().or(z.literal("")),
  })
  .refine((v) => v.email || v.phone, {
    message: "Provide an email or a phone number",
    path: ["phone"],
  });

export type TeacherFormValues = z.infer<typeof teacherSchema>;

export const qualificationSchema = z.object({
  degree: z.string().trim().min(2, "Required").max(100),
  institution: z.string().trim().min(2, "Required").max(200),
  passingYear: z
    .string()
    .trim()
    .regex(/^(19[5-9]\d|20\d{2})$/, "Year 1950 or later")
    .refine(
      (v) => Number(v) <= new Date().getFullYear(),
      "Cannot be in the future",
    ),
  result: z.string().trim().max(50).optional().or(z.literal("")),
});

export type QualificationValues = z.infer<typeof qualificationSchema>;

export const teacherLeaveSchema = z
  .object({
    teacherId: z.string().min(1, "Pick a teacher"),
    fromDate: dateString,
    toDate: dateString,
    type: z.enum(LEAVE_TYPES),
    reason: z.string().trim().max(500).optional().or(z.literal("")),
  })
  .refine((v) => v.fromDate <= v.toDate, {
    message: "End must be on/after start",
    path: ["toDate"],
  });

export type TeacherLeaveValues = z.infer<typeof teacherLeaveSchema>;

/** Criterion scores are kept as strings in the form (RHF convention). */
export const evaluationSchema = z.object({
  evaluatedAt: dateString,
  remarks: z.string().trim().max(1000).optional().or(z.literal("")),
});

export type EvaluationValues = z.infer<typeof evaluationSchema>;
