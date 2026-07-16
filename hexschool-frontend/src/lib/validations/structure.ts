import { z } from "zod";

/** Mirrors backend M06 DTOs. */

const timeString = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24h)");

export const departmentSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(100),
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9-]{2,20}$/, "2–20 uppercase letters/digits/hyphens"),
});

export const shiftSchema = z
  .object({
    name: z.string().trim().min(2, "Name is required").max(50),
    startTime: timeString,
    endTime: timeString,
  })
  .refine((v) => v.startTime < v.endTime, {
    message: "End must be after start",
    path: ["endTime"],
  });

/** Numeric inputs are kept as strings in forms (RHF-friendly) and
 *  converted at the API call — same convention as M04/M05. */
const levelString = z
  .string()
  .trim()
  .regex(/^\d{1,2}$/, "0–20")
  .refine((v) => Number(v) <= 20, "0–20");

export const classSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  nameBn: z.string().trim().max(100).optional().or(z.literal("")),
  numericLevel: levelString,
  displayOrder: z
    .string()
    .trim()
    .regex(/^\d*$/, "Whole number")
    .optional()
    .or(z.literal("")),
});

export const groupSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(50),
  applicableFromLevel: levelString,
});

export const subjectSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(100),
  nameBn: z.string().trim().max(100).optional().or(z.literal("")),
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{2,20}$/, "2–20 uppercase letters/digits"),
  departmentId: z.string().optional().or(z.literal("")),
  type: z.enum(["THEORY", "PRACTICAL", "BOTH"]),
});

export const sectionSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(5, "Max 5 characters")
    .regex(/^[A-Za-z0-9-]+$/, "Letters/digits/hyphen only"),
  shiftId: z.string().optional().or(z.literal("")),
  groupId: z.string().optional().or(z.literal("")),
  capacity: z
    .string()
    .trim()
    .regex(/^\d*$/, "Whole number")
    .optional()
    .or(z.literal("")),
  roomNo: z.string().trim().max(20).optional().or(z.literal("")),
});

export type DepartmentValues = z.infer<typeof departmentSchema>;
export type ShiftValues = z.infer<typeof shiftSchema>;
export type ClassValues = z.infer<typeof classSchema>;
export type GroupValues = z.infer<typeof groupSchema>;
export type SubjectValues = z.infer<typeof subjectSchema>;
export type SectionValues = z.infer<typeof sectionSchema>;
