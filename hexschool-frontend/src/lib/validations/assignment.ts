import { z } from "zod";
import {
  LINK_MATERIAL_TYPES,
  type AssignmentStatus,
  type MaterialType,
  type SubmissionStatus,
} from "@/lib/api/assignment";

/** Mirrors the backend Assignments & Homework DTOs (Module 22). */

export const ASSIGNMENT_TYPE_VALUES = ["ASSIGNMENT", "HOMEWORK"] as const;
export const MATERIAL_TYPE_VALUES = [
  "NOTE",
  "SLIDE",
  "VIDEO_URL",
  "LINK",
  "OTHER",
] as const;

export const ASSIGNMENT_STATUS_VARIANT: Record<
  AssignmentStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  DRAFT: "outline",
  PUBLISHED: "default",
  CLOSED: "secondary",
};

export const SUBMISSION_STATUS_VARIANT: Record<
  SubmissionStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  SUBMITTED: "outline",
  RESUBMITTED: "outline",
  EVALUATED: "default",
  RETURNED: "destructive",
};

const attachmentSchema = z.object({
  key: z.string().min(1).max(500),
  name: z.string().min(1).max(255),
  size: z.number().min(0),
  contentType: z.string().min(1).max(150),
});

export const assignmentSchema = z
  .object({
    sessionId: z.string().uuid("Pick an academic session"),
    sectionId: z.string().uuid("Pick a section"),
    subjectId: z.string().uuid("Pick a subject"),
    type: z.enum(ASSIGNMENT_TYPE_VALUES),
    title: z.string().trim().min(2, "Give it a title").max(200),
    instructions: z.string().max(20000).optional().or(z.literal("")),
    /** `datetime-local` values; converted to ISO by the API client. */
    assignedAt: z.string().min(1, "When is the work set?"),
    dueAt: z.string().min(1, "When is it due?"),
    /**
     * Kept as a STRING, not a coerced number: empty means "not graded"
     * (feedback only), and a coercing union would make the schema's input
     * and output types diverge — which RHF's resolver typing rejects. The
     * caller parses it once, at submit.
     */
    fullMarks: z
      .string()
      .trim()
      .refine((v) => v === "" || Number(v) > 0, {
        message: "Full marks must be above zero",
      }),
    allowLate: z.boolean(),
    attachments: z.array(attachmentSchema).max(20).optional(),
  })
  // The DB CHECK `chk_assignments_window` says the same thing; catching it
  // here means the teacher sees it against the field rather than as a 400.
  .refine(
    (v) => new Date(v.dueAt).getTime() > new Date(v.assignedAt).getTime(),
    { message: "The due date must be after the date the work is set", path: ["dueAt"] },
  );

export type AssignmentFormValues = z.infer<typeof assignmentSchema>;

/**
 * One evaluation cell. `marks` is deliberately validated against the
 * assignment's `fullMarks` by the caller rather than baked in here — the
 * ceiling is a property of the assignment, and the backend engine
 * (`evaluation.engine.ts`) is the authority either way.
 */
export function marksIssue(
  value: number | null | undefined,
  fullMarks: number | null,
): string | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (value < 0) return "Marks cannot be negative";
  if (fullMarks === null) return "This assignment is not graded";
  if (Math.round(value * 100) / 100 > fullMarks) {
    return `Cannot exceed the full marks (${fullMarks})`;
  }
  return null;
}

export const returnSchema = z.object({
  feedback: z
    .string()
    .trim()
    .min(2, "Say what needs revising — feedback is required to return work")
    .max(4000),
});

export type ReturnFormValues = z.infer<typeof returnSchema>;

export const submitSchema = z
  .object({
    textAnswer: z.string().max(20000).optional().or(z.literal("")),
    attachments: z.array(attachmentSchema).max(20).optional(),
  })
  // `chk_assignment_submissions_content` refuses an empty row; saying so
  // before the upload spinner runs is kinder on a phone.
  .refine(
    (v) => (v.textAnswer?.trim().length ?? 0) > 0 || (v.attachments?.length ?? 0) > 0,
    { message: "Write an answer or attach a file", path: ["textAnswer"] },
  );

export type SubmitFormValues = z.infer<typeof submitSchema>;

export const materialSchema = z
  .object({
    sessionId: z.string().uuid("Pick an academic session"),
    classId: z.string().uuid("Pick a class"),
    /** Empty string = class-wide (`section_id` NULL on the row). */
    sectionId: z.string().uuid().optional().or(z.literal("")),
    subjectId: z.string().uuid("Pick a subject"),
    type: z.enum(MATERIAL_TYPE_VALUES),
    title: z.string().trim().min(2, "Give it a title").max(200),
    description: z.string().max(5000).optional().or(z.literal("")),
    linkUrl: z.string().max(500).optional().or(z.literal("")),
    files: z.array(attachmentSchema).max(20).optional(),
  })
  .superRefine((v, ctx) => {
    const needsLink = LINK_MATERIAL_TYPES.includes(v.type as MaterialType);
    const link = v.linkUrl?.trim() ?? "";

    if (needsLink && link.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A video or web link needs its URL",
        path: ["linkUrl"],
      });
    }
    // https only, always — the DB CHECK `chk_learning_materials_link_scheme`
    // enforces it too, because this column is rendered as an anchor in a
    // student's browser.
    if (link.length > 0 && !/^https:\/\//i.test(link)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Links must start with https://",
        path: ["linkUrl"],
      });
    }
    if (!needsLink && link.length === 0 && (v.files?.length ?? 0) === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Attach at least one file, or give a link",
        path: ["files"],
      });
    }
  });

export type MaterialFormValues = z.infer<typeof materialSchema>;

/**
 * The host allow-list mirror. The **backend setting is authoritative** —
 * this is a client-side courtesy so a teacher pasting a Facebook link
 * learns before saving, and it deliberately matches the backend's
 * label-boundary rule rather than a substring test.
 */
export function linkHostIssue(
  url: string,
  allowedHosts: readonly string[],
): string | null {
  if (allowedHosts.length === 0) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "Enter a valid URL";
  }
  const ok = allowedHosts.some((raw) => {
    const entry = raw.trim().toLowerCase().replace(/^\*\./, "");
    return entry.length > 0 && (host === entry || host.endsWith(`.${entry}`));
  });
  return ok ? null : `${host} is not on the school's allowed link hosts`;
}

/**
 * Client-side mirror of `attachment.util.ts` so a 12 MB photo is refused
 * before it is uploaded over a phone connection.
 */
export function fileIssue(
  file: { name: string; size: number },
  limits: { maxBytes: number; allowedTypes: readonly string[] },
): string | null {
  const dot = file.name.lastIndexOf(".");
  const ext =
    dot < 0 || dot === file.name.length - 1
      ? ""
      : file.name.slice(dot + 1).toLowerCase();

  if (!ext) return `"${file.name}" has no file extension`;
  if (!limits.allowedTypes.includes(ext)) {
    return `.${ext} files are not allowed (${limits.allowedTypes.join(", ")})`;
  }
  if (file.size <= 0) return `"${file.name}" is empty`;
  if (file.size > limits.maxBytes) {
    const mb = Math.round((limits.maxBytes / (1024 * 1024)) * 10) / 10;
    return `"${file.name}" is larger than ${mb} MB`;
  }
  return null;
}
