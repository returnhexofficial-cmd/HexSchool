import { z } from "zod";
import type {
  NoticeAudience,
  NotificationChannel,
  NotificationStatus,
} from "@/lib/api/communication";

/** Mirrors the backend Communication DTOs (Module 17). */

export const NOTIFICATION_CHANNELS = ["SMS", "EMAIL", "IN_APP"] as const;
export const NOTIFICATION_CHANNEL_LABELS: Record<NotificationChannel, string> = {
  SMS: "SMS",
  EMAIL: "Email",
  IN_APP: "In-app",
};

export const NOTIFICATION_STATUS_LABELS: Record<NotificationStatus, string> = {
  QUEUED: "Queued",
  SENT: "Sent",
  DELIVERED: "Delivered",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export const NOTICE_AUDIENCES = [
  "ALL",
  "STUDENTS",
  "PARENTS",
  "TEACHERS",
  "STAFF",
  "CLASS",
  "SECTION",
] as const;

export const BULK_AUDIENCE_LABELS: Record<NoticeAudience | "RAW", string> = {
  ALL: "Everyone",
  STUDENTS: "Students",
  PARENTS: "Parents",
  TEACHERS: "Teachers",
  STAFF: "Staff",
  CLASS: "A class",
  SECTION: "A section",
  RAW: "Custom numbers",
};

export const templateSchema = z.object({
  code: z.string().min(1, "Pick a code"),
  channel: z.enum(NOTIFICATION_CHANNELS),
  language: z.enum(["EN", "BN"]).default("EN"),
  subject: z.string().max(200).optional(),
  body: z.string().min(1, "Body is required").max(2000),
  isActive: z.boolean().default(true),
});
export type TemplateForm = z.infer<typeof templateSchema>;

export const noticeSchema = z.object({
  title: z.string().min(2, "Title is required").max(200),
  body: z.string().min(1, "Body is required"),
  audience: z.enum(NOTICE_AUDIENCES),
  isWebsiteVisible: z.boolean().default(false),
  pinned: z.boolean().default(false),
  publishAt: z.string().optional(),
});
export type NoticeForm = z.infer<typeof noticeSchema>;

export const bulkSchema = z.object({
  channel: z.enum(NOTIFICATION_CHANNELS),
  audience: z.enum([...NOTICE_AUDIENCES, "RAW"]),
  message: z.string().min(1, "Message is required").max(2000),
  subject: z.string().max(200).optional(),
  customNumbers: z.string().optional(),
  emergency: z.boolean().default(false),
});
export type BulkForm = z.infer<typeof bulkSchema>;

export const creditSchema = z.object({
  qty: z.coerce.number().int(),
  purchase: z.boolean().default(true),
  ref: z.string().max(200).optional(),
});
export type CreditForm = z.infer<typeof creditSchema>;
