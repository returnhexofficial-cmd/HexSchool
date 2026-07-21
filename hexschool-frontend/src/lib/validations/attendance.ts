import { z } from "zod";

/** Mirrors backend M12 DTOs. */

export const ATTENDANCE_STATUSES = [
  "PRESENT",
  "ABSENT",
  "LATE",
  "LEAVE",
  "HALF_DAY",
  "HOLIDAY",
] as const;

export type AttendanceStatusValue = (typeof ATTENDANCE_STATUSES)[number];

/** HOLIDAY is engine-owned (set by the convert-to-holiday tool). */
export const MARKABLE_STATUSES = [
  "PRESENT",
  "ABSENT",
  "LATE",
  "LEAVE",
  "HALF_DAY",
] as const;

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatusValue, string> = {
  PRESENT: "Present",
  ABSENT: "Absent",
  LATE: "Late",
  LEAVE: "Leave",
  HALF_DAY: "Half day",
  HOLIDAY: "Holiday",
};

/** Single-letter codes used in the register matrix (print convention). */
export const ATTENDANCE_STATUS_CODES: Record<AttendanceStatusValue, string> = {
  PRESENT: "P",
  ABSENT: "A",
  LATE: "L",
  LEAVE: "V",
  HALF_DAY: "H",
  HOLIDAY: "—",
};

export const LEAVE_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_REGEX = /^\d{4}-\d{2}$/;

export const attendanceDateSchema = z
  .string()
  .regex(DATE_REGEX, "Use the YYYY-MM-DD format");

export const attendanceMonthSchema = z
  .string()
  .regex(MONTH_REGEX, "Use the YYYY-MM format");

export const markAttendanceSchema = z.object({
  sectionId: z.string().uuid({ message: "Choose a section" }),
  date: attendanceDateSchema,
  entries: z
    .array(
      z.object({
        enrollmentId: z.string().uuid(),
        status: z.enum(ATTENDANCE_STATUSES),
        remarks: z.string().max(300).optional(),
      }),
    )
    .min(1, "Mark at least one student"),
  overrideHoliday: z.boolean().optional(),
});

export type MarkAttendanceValues = z.infer<typeof markAttendanceSchema>;

export const studentLeaveSchema = z
  .object({
    studentId: z.string().uuid({ message: "Choose a student" }),
    fromDate: attendanceDateSchema,
    toDate: attendanceDateSchema,
    reason: z
      .string()
      .min(3, "Give a reason (at least 3 characters)")
      .max(500, "Reason must be 500 characters or fewer"),
  })
  .refine((v) => v.fromDate <= v.toDate, {
    message: "The end date cannot be before the start date",
    path: ["toDate"],
  });

export type StudentLeaveValues = z.infer<typeof studentLeaveSchema>;

export const convertHolidaySchema = z.object({
  date: attendanceDateSchema,
  sectionId: z.string().uuid().optional(),
  reason: z
    .string()
    .min(3, "Give a reason (at least 3 characters)")
    .max(300, "Reason must be 300 characters or fewer"),
});

export type ConvertHolidayValues = z.infer<typeof convertHolidaySchema>;

/** Today in Asia/Dhaka — the default marking date (backend rejects the
 *  future, so a browser in another timezone must not overshoot). */
export function dhakaToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 6 * 3_600_000).toISOString().slice(0, 10);
}

export function dhakaMonth(now: Date = new Date()): string {
  return dhakaToday(now).slice(0, 7);
}
