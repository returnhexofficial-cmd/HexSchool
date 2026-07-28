import { z } from "zod";
import type {
  CareerApplicationStatus,
  ContactMessageStatus,
  NewsCategory,
  WebContentStatus,
} from "@/lib/api/website";
import { bdPhoneSchema } from "./index";

/** Mirrors the backend Website CMS DTOs (Module 19). */

export const WEB_CONTENT_STATUSES = ["DRAFT", "PUBLISHED"] as const;
export const WEB_CONTENT_STATUS_LABELS: Record<WebContentStatus, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
};

export const CMS_TEMPLATES = ["DEFAULT", "LANDING", "CONTACT"] as const;
export const NEWS_CATEGORIES = ["NEWS", "BLOG", "ACHIEVEMENT"] as const;
export const NEWS_CATEGORY_LABELS: Record<NewsCategory, string> = {
  NEWS: "News",
  BLOG: "Blog",
  ACHIEVEMENT: "Achievement",
};

export const CONTACT_STATUS_LABELS: Record<ContactMessageStatus, string> = {
  NEW: "New",
  READ: "Read",
  REPLIED: "Replied",
};

export const APPLICATION_STATUS_LABELS: Record<
  CareerApplicationStatus,
  string
> = {
  RECEIVED: "Received",
  SHORTLISTED: "Shortlisted",
  REJECTED: "Rejected",
};

/**
 * Segments the application owns — a CMS page may not shadow one. Mirrors
 * `RESERVED_SLUGS` in the backend's `calc/slug.util.ts`, so the editor
 * refuses the slug before the request is sent (the M14/M15 "mirror the
 * engine client-side" convention).
 */
export const RESERVED_SLUGS = [
  "admin",
  "api",
  "portal",
  "login",
  "logout",
  "register",
  "account",
  "auth",
  "forgot-password",
  "reset-password",
  "verify",
  "admission",
  "admissions",
  "news",
  "notices",
  "events",
  "gallery",
  "downloads",
  "career",
  "careers",
  "faq",
  "contact",
  "committee",
  "teachers",
  "results",
  "achievements",
  "sitemap",
  "sitemap.xml",
  "robots.txt",
  "rss",
  "rss.xml",
  "static",
  "_next",
  "public",
  "maintenance",
] as const;

export const slugSchema = z
  .string()
  .trim()
  .max(120, "At most 120 characters")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Use kebab-case: lowercase letters, digits and single hyphens (e.g. "principal-message")',
  )
  .refine(
    (slug) => !RESERVED_SLUGS.includes(slug as (typeof RESERVED_SLUGS)[number]),
    { message: "That address is reserved by the application" },
  );

/** Derives a kebab-case slug from a title (mirrors `slugify`). */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/g, "");
}

export const cmsPageSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  titleBn: z.string().trim().max(200).optional().or(z.literal("")),
  slug: slugSchema.optional().or(z.literal("")),
  content: z.string().min(1, "Write some content"),
  contentBn: z.string().optional().or(z.literal("")),
  excerpt: z.string().max(500).optional().or(z.literal("")),
  metaTitle: z.string().max(200).optional().or(z.literal("")),
  metaDescription: z.string().max(320).optional().or(z.literal("")),
  ogImageUrl: z.string().max(500).optional().or(z.literal("")),
  template: z.enum(CMS_TEMPLATES).default("DEFAULT"),
  showInMenu: z.boolean().default(false),
  displayOrder: z.coerce.number().int().min(0).default(0),
  status: z.enum(WEB_CONTENT_STATUSES).default("DRAFT"),
});
export type CmsPageForm = z.input<typeof cmsPageSchema>;

export const newsPostSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  titleBn: z.string().trim().max(200).optional().or(z.literal("")),
  slug: slugSchema.optional().or(z.literal("")),
  excerpt: z.string().max(500).optional().or(z.literal("")),
  content: z.string().min(1, "Write the post"),
  contentBn: z.string().optional().or(z.literal("")),
  coverUrl: z.string().max(500).optional().or(z.literal("")),
  category: z.enum(NEWS_CATEGORIES).default("NEWS"),
  metaTitle: z.string().max(200).optional().or(z.literal("")),
  metaDescription: z.string().max(320).optional().or(z.literal("")),
  status: z.enum(WEB_CONTENT_STATUSES).default("DRAFT"),
});
export type NewsPostForm = z.input<typeof newsPostSchema>;

export const galleryItemSchema = z.object({
  type: z.enum(["IMAGE", "VIDEO_URL"]).default("IMAGE"),
  url: z.string().trim().min(1, "A URL is required").max(500),
  caption: z.string().max(300).optional().or(z.literal("")),
});

export const gallerySchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  titleBn: z.string().trim().max(200).optional().or(z.literal("")),
  description: z.string().max(1000).optional().or(z.literal("")),
  eventDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .optional()
    .or(z.literal("")),
  coverUrl: z.string().max(500).optional().or(z.literal("")),
  status: z.enum(WEB_CONTENT_STATUSES).default("DRAFT"),
  displayOrder: z.coerce.number().int().min(0).default(0),
  items: z.array(galleryItemSchema).default([]),
});
export type GalleryForm = z.input<typeof gallerySchema>;

export const downloadSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  titleBn: z.string().trim().max(200).optional().or(z.literal("")),
  category: z.string().max(80).optional().or(z.literal("")),
  fileUrl: z.string().trim().min(1, "Upload a file or paste a link").max(500),
  fileKey: z.string().max(500).optional().or(z.literal("")),
  sizeBytes: z.coerce.number().int().min(0).optional(),
  status: z.enum(WEB_CONTENT_STATUSES).default("DRAFT"),
  displayOrder: z.coerce.number().int().min(0).default(0),
});
export type DownloadForm = z.input<typeof downloadSchema>;

export const careerSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().min(1, "Describe the role"),
  location: z.string().max(200).optional().or(z.literal("")),
  vacancies: z.coerce.number().int().min(1).max(999).optional(),
  deadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .optional()
    .or(z.literal("")),
  status: z.enum(WEB_CONTENT_STATUSES).default("DRAFT"),
  displayOrder: z.coerce.number().int().min(0).default(0),
});
export type CareerForm = z.input<typeof careerSchema>;

export const faqSchema = z.object({
  question: z.string().trim().min(1, "Ask the question").max(300),
  questionBn: z.string().trim().max(300).optional().or(z.literal("")),
  answer: z.string().min(1, "Answer it"),
  answerBn: z.string().optional().or(z.literal("")),
  category: z.string().max(80).optional().or(z.literal("")),
  status: z.enum(WEB_CONTENT_STATUSES).default("PUBLISHED"),
  displayOrder: z.coerce.number().int().min(0).default(0),
});
export type FaqForm = z.input<typeof faqSchema>;

export const committeeMemberSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(150),
  nameBn: z.string().trim().max(150).optional().or(z.literal("")),
  designation: z.string().trim().min(1, "Designation is required").max(150),
  photoUrl: z.string().max(500).optional().or(z.literal("")),
  message: z.string().max(50_000).optional().or(z.literal("")),
  status: z.enum(WEB_CONTENT_STATUSES).default("PUBLISHED"),
  displayOrder: z.coerce.number().int().min(0).default(0),
});
export type CommitteeMemberForm = z.input<typeof committeeMemberSchema>;

/**
 * The public contact form. The backend refuses a message with neither a
 * phone nor an email (and a CHECK constraint backs that up), so the form
 * says so before the visitor submits.
 */
export const contactSchema = z
  .object({
    name: z.string().trim().min(2, "Your name, please").max(150),
    phone: z.union([bdPhoneSchema, z.literal("")]).optional(),
    email: z
      .union([z.string().email("Enter a valid email"), z.literal("")])
      .optional(),
    subject: z.string().max(200).optional().or(z.literal("")),
    body: z.string().trim().min(5, "Write your message").max(5000),
  })
  .refine((value) => Boolean(value.phone) || Boolean(value.email), {
    message: "Leave a phone number or an email so the school can reply",
    path: ["phone"],
  });
export type ContactForm = z.input<typeof contactSchema>;

export const careerApplySchema = z.object({
  name: z.string().trim().min(2, "Your name, please").max(150),
  phone: bdPhoneSchema,
  email: z
    .union([z.string().email("Enter a valid email"), z.literal("")])
    .optional(),
  note: z.string().max(1000).optional().or(z.literal("")),
});
export type CareerApplyForm = z.input<typeof careerApplySchema>;

export const verifyStudentSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(4, "Enter the student ID or scan the card")
    .max(64),
});
export type VerifyStudentForm = z.input<typeof verifyStudentSchema>;
