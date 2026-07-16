import { z } from "zod";

/** Mirrors backend M05 DTOs. Dates are YYYY-MM-DD strings. */

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker (YYYY-MM-DD)")
  .refine((v) => {
    const d = new Date(v);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Not a valid calendar date");

export const sessionSchema = z
  .object({
    name: z.string().trim().min(2, "Name is required").max(50),
    startDate: dateString,
    endDate: dateString,
  })
  .refine((v) => v.startDate < v.endDate, {
    message: "End date must be after the start date",
    path: ["endDate"],
  });

export const holidaySchema = z
  .object({
    title: z.string().trim().min(2, "Title is required").max(200),
    startDate: dateString,
    endDate: dateString,
    type: z.enum(["GOVERNMENT", "RELIGIOUS", "SCHOOL", "WEEKLY"]),
    appliesTo: z.enum(["ALL", "STUDENTS", "STAFF"]),
  })
  .refine((v) => v.startDate <= v.endDate, {
    message: "End date must not be before the start date",
    path: ["endDate"],
  });

export const calendarEventSchema = z
  .object({
    title: z.string().trim().min(2, "Title is required").max(200),
    description: z.string().trim().max(2000).optional().or(z.literal("")),
    startDate: dateString,
    endDate: dateString,
    type: z.enum(["EXAM", "EVENT", "MEETING", "SPORTS", "CULTURAL", "OTHER"]),
    isPublic: z.boolean(),
  })
  .refine((v) => v.startDate <= v.endDate, {
    message: "End date must not be before the start date",
    path: ["endDate"],
  });

export type SessionValues = z.infer<typeof sessionSchema>;
export type HolidayValues = z.infer<typeof holidaySchema>;
export type CalendarEventValues = z.infer<typeof calendarEventSchema>;
