import { z } from "zod";

/** Mirrors the backend Document Management & Certificates DTOs (Module 27). */

export const CERTIFICATE_TYPE_VALUES = [
  "TRANSFER",
  "CHARACTER",
  "TESTIMONIAL",
  "PRIZE",
  "PARTICIPATION",
  "CUSTOM",
] as const;

export const CERTIFICATE_STATUS_VALUES = [
  "DRAFT",
  "ISSUED",
  "REVOKED",
] as const;

export const ISSUE_KIND_VALUES = ["DUPLICATE", "CORRECTION"] as const;

export const ARCHIVE_LINK_VALUES = [
  "STUDENT",
  "TEACHER",
  "STAFF",
  "CERTIFICATE",
] as const;

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

const requiredDate = z
  .string()
  .regex(DATE_SHAPE, "Use the date picker (YYYY-MM-DD)");

const optionalDate = z
  .string()
  .optional()
  .refine(
    (value) => !value || DATE_SHAPE.test(value),
    "Use the date picker (YYYY-MM-DD)",
  );

export const signatorySchema = z.object({
  name: z.string().min(1, "A signatory needs a name").max(120),
  designation: z.string().max(120).optional(),
  imageUrl: z.string().max(500).optional(),
});

export const templateSchema = z.object({
  type: z.enum(CERTIFICATE_TYPE_VALUES, {
    message: "Pick what kind of certificate this layout prints",
  }),
  name: z.string().min(2, "At least 2 characters").max(160),
  bodyHtml: z
    .string()
    .min(1, "A template needs a body")
    .max(50_000, "That layout is too long"),
  backgroundUrl: z.string().max(500).optional(),
  signatories: z.array(signatorySchema).max(6).optional(),
  isActive: z.boolean().optional(),
});

/**
 * The override reason mirrors the DTO's `@MinLength(10)`, and the message
 * says why: it is the audit trail's only record of *why* a certificate went
 * out over unpaid fees, unreturned books or a bed still held.
 */
const overrideReason = z
  .string()
  .min(10, "Say why in a sentence — this is the only record of the decision")
  .max(500)
  .optional()
  .or(z.literal(""));

export const issueSchema = z.object({
  studentId: z.string().uuid("Pick a student"),
  type: z.enum(CERTIFICATE_TYPE_VALUES),
  templateId: z.string().uuid().optional().or(z.literal("")),
  enrollmentId: z.string().uuid().optional().or(z.literal("")),
  conduct: z.string().max(120).optional(),
  examId: z.string().uuid().optional().or(z.literal("")),
  remarks: z.string().max(1000).optional(),
  issue: z.boolean().optional(),
  clearanceOverrideReason: overrideReason,
  notify: z.boolean().optional(),
  confirmTransfer: z.boolean().optional(),
});

export const legacySchema = z.object({
  studentId: z.string().uuid("Pick a student"),
  type: z.enum(CERTIFICATE_TYPE_VALUES),
  certificateNo: z
    .string()
    .min(1, "Enter the number the school wrote on the original")
    .max(60),
  issueDate: requiredDate,
  sessionId: z.string().uuid().optional().or(z.literal("")),
  remarks: z.string().max(1000).optional(),
});

export const reissueSchema = z.object({
  kind: z.enum(ISSUE_KIND_VALUES),
  remarks: z.string().max(1000).optional(),
  notify: z.boolean().optional(),
  clearanceOverrideReason: overrideReason,
});

export const revokeSchema = z.object({
  reason: z
    .string()
    .min(10, "Say why in a sentence — this is printed on the public page")
    .max(500),
  notify: z.boolean().optional(),
});

export const bulkPrizeSchema = z.object({
  examId: z.string().uuid("Pick an exam"),
  topN: z.coerce
    .number()
    .int("Whole positions only")
    .min(1, "At least the top 1")
    .max(20, "At most the top 20"),
  templateId: z.string().uuid().optional().or(z.literal("")),
  classIds: z.array(z.string().uuid()).max(50).optional(),
  dryRun: z.boolean().optional(),
  issue: z.boolean().optional(),
});

export const folderSchema = z.object({
  name: z.string().min(1, "A folder needs a name").max(160),
  parentId: z.string().uuid().optional().or(z.literal("")),
  description: z.string().max(1000).optional(),
});

export const archiveFileSchema = z.object({
  folderId: z.string().uuid("Pick a folder"),
  title: z.string().min(1, "Give the document a title").max(250),
  fileUrl: z.string().min(1, "Upload or paste a file reference").max(500),
  mimeType: z.string().max(120),
  sizeBytes: z.coerce.number().int().min(1, "An empty file is not a document"),
  tags: z.array(z.string().max(40)).max(20).optional(),
  linkedType: z.enum(ARCHIVE_LINK_VALUES).optional(),
  linkedId: z.string().uuid().optional().or(z.literal("")),
  notes: z.string().max(1000).optional(),
});

/**
 * Both link columns are set, or neither — mirroring
 * `chk_archive_files_link`. A file recorded against a `linkedType` with no
 * id is invisible to every "documents of this student" query while still
 * claiming to belong to one.
 */
export const archiveFileFormSchema = archiveFileSchema.refine(
  (value) => Boolean(value.linkedType) === Boolean(value.linkedId),
  {
    message: "Pick what this document is about, or leave both blank",
    path: ["linkedId"],
  },
);

export const registerWindowSchema = z.object({
  from: optionalDate,
  to: optionalDate,
  type: z.enum(CERTIFICATE_TYPE_VALUES).optional(),
});

/** The public verification form — one field, typed off a printed page. */
export const verifyCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Enter the code printed on the certificate")
    .max(24, "That is longer than a verification code"),
});

export type TemplateFormValues = z.infer<typeof templateSchema>;
export type IssueFormValues = z.infer<typeof issueSchema>;
export type LegacyFormValues = z.infer<typeof legacySchema>;
export type ReissueFormValues = z.infer<typeof reissueSchema>;
export type RevokeFormValues = z.infer<typeof revokeSchema>;
export type BulkPrizeFormValues = z.infer<typeof bulkPrizeSchema>;
export type FolderFormValues = z.infer<typeof folderSchema>;
export type ArchiveFileFormValues = z.infer<typeof archiveFileSchema>;
export type VerifyCodeFormValues = z.infer<typeof verifyCodeSchema>;
