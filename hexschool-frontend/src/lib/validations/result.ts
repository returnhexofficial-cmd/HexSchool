import { z } from "zod";
import type {
  ExamPaper,
  MarkComponent,
  MarkGridRow,
  MarkStatus,
  ResultRunStatus,
  ResultStatus,
} from "@/lib/api/result";

/** Mirrors the backend M15 DTOs and the mark-entry engine. */

export const MARK_COMPONENTS = ["cq", "mcq", "practical", "ca"] as const;

export const COMPONENT_LABELS: Record<MarkComponent, string> = {
  cq: "CQ",
  mcq: "MCQ",
  practical: "Practical",
  ca: "CA",
};

export const MARK_STATUS_LABELS: Record<MarkStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  VERIFIED: "Verified",
  LOCKED: "Locked",
};

/** Badge tone per mark status — locked is the only terminal state. */
export const MARK_STATUS_VARIANT: Record<
  MarkStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  DRAFT: "secondary",
  SUBMITTED: "outline",
  VERIFIED: "outline",
  LOCKED: "default",
};

export const RESULT_STATUS_LABELS: Record<ResultStatus, string> = {
  PASSED: "Passed",
  FAILED: "Failed",
  INCOMPLETE: "Incomplete",
  WITHHELD: "Withheld",
};

export const RESULT_STATUS_VARIANT: Record<
  ResultStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  PASSED: "default",
  FAILED: "destructive",
  INCOMPLETE: "outline",
  WITHHELD: "secondary",
};

export const RUN_STATUS_LABELS: Record<ResultRunStatus, string> = {
  QUEUED: "Queued",
  RUNNING: "Running",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

/** The next lifecycle action a paper in this state allows. */
export const NEXT_MARK_ACTION: Record<
  MarkStatus,
  { action: "submit" | "verify" | "lock"; label: string; permission: string } | null
> = {
  DRAFT: { action: "submit", label: "Submit for verification", permission: "mark.submit" },
  SUBMITTED: { action: "verify", label: "Verify", permission: "mark.verify" },
  VERIFIED: { action: "lock", label: "Lock", permission: "mark.lock" },
  LOCKED: null,
};

// ── the mark-entry engine, mirrored ───────────────────────────────────
//
// The backend is authoritative (`mark-entry.engine.ts`), but a grid that
// only learns a cell is bad after a round-trip is unusable for typing
// forty students in a row. This is the same rule set, client-side.

/** Components this paper allocates marks to (empty ⇒ a flat paper). */
export function allocatedComponents(paper: ExamPaper): MarkComponent[] {
  return MARK_COMPONENTS.filter((c) => {
    const allocation = paper.componentMarks[c];
    return allocation !== null && allocation !== undefined;
  });
}

export interface DraftMark {
  cq: string;
  mcq: string;
  practical: string;
  ca: string;
  total: string;
  isAbsent: boolean;
}

export function emptyDraft(): DraftMark {
  return { cq: "", mcq: "", practical: "", ca: "", total: "", isAbsent: false };
}

export function draftFromRow(row: MarkGridRow): DraftMark {
  return {
    cq: row.cq === null ? "" : String(row.cq),
    mcq: row.mcq === null ? "" : String(row.mcq),
    practical: row.practical === null ? "" : String(row.practical),
    ca: row.ca === null ? "" : String(row.ca),
    total: row.markId === null || row.isAbsent ? "" : String(row.total),
    isAbsent: row.isAbsent,
  };
}

const numberOrNull = (value: string): number | null =>
  value.trim() === "" ? null : Number(value);

/** The running total shown in the grid's Total column. */
export function draftTotal(paper: ExamPaper, draft: DraftMark): number {
  if (draft.isAbsent) return 0;
  const allocated = allocatedComponents(paper);
  if (allocated.length === 0) return Number(draft.total) || 0;
  return allocated.reduce((sum, c) => sum + (Number(draft[c]) || 0), 0);
}

/**
 * Why this cell is red, or null. Deliberately the *same* rules as the
 * server so a save is never refused for something the grid accepted.
 */
export function draftError(paper: ExamPaper, draft: DraftMark): string | null {
  if (draft.isAbsent) {
    const stray = [...MARK_COMPONENTS, "total" as const].filter(
      (field) => (Number(draft[field]) || 0) > 0,
    );
    return stray.length > 0
      ? "Absent candidates cannot carry marks"
      : null;
  }

  const allocated = allocatedComponents(paper);

  for (const component of MARK_COMPONENTS) {
    const raw = draft[component];
    if (raw.trim() === "") continue;
    const value = Number(raw);
    const allocation = paper.componentMarks[component];

    if (!Number.isFinite(value) || value < 0) {
      return `${COMPONENT_LABELS[component]} must be 0 or more`;
    }
    if (allocation === null || allocation === undefined) {
      return `This paper allocates no ${COMPONENT_LABELS[component]} marks`;
    }
    if (value > allocation) {
      return `${COMPONENT_LABELS[component]} ${value} exceeds its ${allocation} marks`;
    }
  }

  if (allocated.length === 0) {
    if (draft.total.trim() === "") return null; // not entered yet
    const value = Number(draft.total);
    if (!Number.isFinite(value) || value < 0) return "Marks must be 0 or more";
    if (value > paper.fullMarks) {
      return `${value} exceeds the paper's ${paper.fullMarks} marks`;
    }
  }

  return null;
}

/** True once the row carries something worth sending. */
export function isDraftFilled(paper: ExamPaper, draft: DraftMark): boolean {
  if (draft.isAbsent) return true;
  const allocated = allocatedComponents(paper);
  return allocated.length === 0
    ? draft.total.trim() !== ""
    : allocated.some((c) => draft[c].trim() !== "");
}

/** The payload row for a filled draft. */
export function draftToInput(
  paper: ExamPaper,
  enrollmentId: string,
  draft: DraftMark,
) {
  if (draft.isAbsent) return { enrollmentId, isAbsent: true };

  const allocated = allocatedComponents(paper);
  if (allocated.length === 0) {
    return { enrollmentId, total: numberOrNull(draft.total) };
  }
  return {
    enrollmentId,
    ...Object.fromEntries(
      allocated.map((c) => [c, numberOrNull(draft[c])]),
    ),
  };
}

// ── forms ─────────────────────────────────────────────────────────────

export const publishSchema = z.object({
  portal: z.boolean(),
  website: z.boolean(),
  sms: z.boolean(),
  note: z.string().max(500).optional(),
});
export type PublishForm = z.infer<typeof publishSchema>;

export const withholdSchema = z.object({
  reason: z.string().min(3, "Give a reason").max(500),
});
export type WithholdForm = z.infer<typeof withholdSchema>;

export const correctionSchema = z.object({
  reason: z.string().min(3, "A correction needs a reason").max(500),
});
export type CorrectionForm = z.infer<typeof correctionSchema>;

/** Weights must sum to 100 — mirrors `combined-result.engine.ts`. */
export function weightError(weights: number[]): string | null {
  if (weights.length === 0) return "Pick at least one exam";
  if (weights.some((w) => !Number.isFinite(w) || w <= 0)) {
    return "Every weight must be a positive number";
  }
  const total = Math.round(weights.reduce((sum, w) => sum + w, 0) * 100) / 100;
  return total === 100 ? null : `Weights must sum to 100 — they sum to ${total}`;
}
