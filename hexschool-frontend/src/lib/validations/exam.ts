import { z } from "zod";
import type {
  ExamClash,
  ExamClashKind,
  ExamStatus,
  ExamSubject,
  SeatPlanStrategy,
} from "@/lib/api/exam";

/** Mirrors backend M14 DTOs and the mark-distribution engine. */

export const EXAM_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "ONGOING",
  "MARK_ENTRY",
  "PROCESSING",
  "PUBLISHED",
  "ARCHIVED",
] as const;

export const EXAM_STATUS_LABELS: Record<ExamStatus, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  ONGOING: "Ongoing",
  MARK_ENTRY: "Mark entry",
  PROCESSING: "Processing",
  PUBLISHED: "Published",
  ARCHIVED: "Archived",
};

/** Badge tone per status — published is the only "done" state. */
export const EXAM_STATUS_VARIANT: Record<
  ExamStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  DRAFT: "secondary",
  SCHEDULED: "outline",
  ONGOING: "outline",
  MARK_ENTRY: "outline",
  PROCESSING: "outline",
  PUBLISHED: "default",
  ARCHIVED: "secondary",
};

export const SEAT_PLAN_STRATEGIES = ["SERPENTINE", "INTERLEAVE"] as const;

export const SEAT_PLAN_STRATEGY_LABELS: Record<SeatPlanStrategy, string> = {
  SERPENTINE: "Serpentine (classes together)",
  INTERLEAVE: "Interleave (mix classes)",
};

export const CLASH_KIND_LABELS: Record<ExamClashKind, string> = {
  ROOM: "Room clash",
  CLASS_OVERLAP: "Class double-booked",
  CLASS_SAME_DAY: "Two papers in a day",
  OUTSIDE_WINDOW: "Outside exam window",
  DUPLICATE_PAPER: "Duplicate paper",
};

/** Only the same-day policy may be waived — mirrors the backend tiers. */
export const WAIVABLE_CLASH_KINDS: ReadonlySet<ExamClashKind> = new Set<
  ExamClashKind
>(["CLASS_SAME_DAY"]);

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const examTypeSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  weight: z
    .number()
    .min(0, "Weight cannot be negative")
    .max(100, "Weight cannot exceed 100")
    .optional(),
});

export type ExamTypeValues = z.infer<typeof examTypeSchema>;

export const examSchema = z
  .object({
    examTypeId: z.string().uuid({ message: "Choose an exam type" }),
    name: z.string().min(1, "Name is required").max(150),
    startDate: z.string().regex(DATE_REGEX, "Use the YYYY-MM-DD format"),
    endDate: z.string().regex(DATE_REGEX, "Use the YYYY-MM-DD format"),
    gradingSystemId: z.string().uuid().optional().or(z.literal("")),
    classIds: z.array(z.string().uuid()).optional(),
    instructions: z.string().max(2000).optional(),
  })
  .refine((v) => v.startDate <= v.endDate, {
    message: "End date must be on or after the start date",
    path: ["endDate"],
  });

export type ExamValues = z.infer<typeof examSchema>;

export const shiftDaySchema = z
  .object({
    fromDate: z.string().regex(DATE_REGEX, "Use the YYYY-MM-DD format"),
    toDate: z.string().regex(DATE_REGEX, "Use the YYYY-MM-DD format"),
    extendExamWindow: z.boolean().optional(),
    reason: z.string().max(500).optional(),
  })
  .refine((v) => v.fromDate !== v.toDate, {
    message: "Pick a different date to move the sittings to",
    path: ["toDate"],
  });

export type ShiftDayValues = z.infer<typeof shiftDaySchema>;

export const seatPlanRoomSchema = z.object({
  room: z.string().min(1, "Room is required").max(20),
  capacity: z
    .number()
    .int("Capacity must be a whole number")
    .min(1, "Capacity must be at least 1")
    .max(500),
});

export const generateSeatPlanSchema = z
  .object({
    date: z.string().regex(DATE_REGEX, "Use the YYYY-MM-DD format"),
    rooms: z.array(seatPlanRoomSchema).min(1, "Add at least one room"),
    strategy: z.enum(SEAT_PLAN_STRATEGIES).optional(),
  })
  .refine(
    (v) => {
      const names = v.rooms.map((r) => r.room.trim().toLowerCase());
      return new Set(names).size === names.length;
    },
    { message: "Room names must be unique", path: ["rooms"] },
  );

export type GenerateSeatPlanValues = z.infer<typeof generateSeatPlanSchema>;

// ── mark distribution (mirrors calc/mark-distribution.ts) ────────────

export interface DistributionInput {
  fullMarks: number;
  passMarks: number;
  cqMarks?: number | null;
  mcqMarks?: number | null;
  practicalMarks?: number | null;
  caMarks?: number | null;
  cqPassMarks?: number | null;
  mcqPassMarks?: number | null;
  practicalPassMarks?: number | null;
  caPassMarks?: number | null;
}

export const COMPONENTS = ["cq", "mcq", "practical", "ca"] as const;
export type Component = (typeof COMPONENTS)[number];

export const COMPONENT_LABELS: Record<Component, string> = {
  cq: "CQ",
  mcq: "MCQ",
  practical: "Practical",
  ca: "CA",
};

const marksOf = (d: DistributionInput, c: Component): number | null => {
  const v = d[`${c}Marks` as keyof DistributionInput];
  return v === null || v === undefined ? null : Number(v);
};

const passOf = (d: DistributionInput, c: Component): number | null => {
  const v = d[`${c}PassMarks` as keyof DistributionInput];
  return v === null || v === undefined ? null : Number(v);
};

export function usedComponents(d: DistributionInput): Component[] {
  return COMPONENTS.filter((c) => marksOf(d, c) !== null);
}

export function isSplit(d: DistributionInput): boolean {
  return usedComponents(d).length > 0;
}

export function componentTotal(d: DistributionInput): number {
  return usedComponents(d).reduce((sum, c) => sum + (marksOf(d, c) ?? 0), 0);
}

/**
 * The same rules the backend enforces, run client-side so the
 * distribution grid can red-flag a row before it is submitted. The
 * backend remains the authority — this only saves a round trip.
 */
export function validateDistribution(d: DistributionInput): string[] {
  const errors: string[] = [];

  if (!Number.isInteger(d.fullMarks) || d.fullMarks <= 0) {
    errors.push("Full marks must be a whole number above 0");
  }
  if (!Number.isInteger(d.passMarks) || d.passMarks < 0) {
    errors.push("Pass marks must be a whole number of 0 or more");
  }
  if (
    Number.isInteger(d.fullMarks) &&
    Number.isInteger(d.passMarks) &&
    d.passMarks > d.fullMarks
  ) {
    errors.push(`Pass marks cannot exceed full marks (${d.fullMarks})`);
  }

  if (isSplit(d)) {
    const total = componentTotal(d);
    if (Number.isInteger(d.fullMarks) && total !== d.fullMarks) {
      errors.push(
        `Components add up to ${total}, expected ${d.fullMarks}`,
      );
    }
  }

  for (const c of COMPONENTS) {
    const marks = marksOf(d, c);
    if (marks !== null && (!Number.isInteger(marks) || marks < 0)) {
      errors.push(`${COMPONENT_LABELS[c]} marks must be 0 or more`);
    }
    const pass = passOf(d, c);
    if (pass === null) continue;
    if (marks === null) {
      errors.push(`${COMPONENT_LABELS[c]} has a pass mark but no marks`);
    } else if (pass > marks) {
      errors.push(
        `${COMPONENT_LABELS[c]} pass mark cannot exceed its ${marks} marks`,
      );
    }
  }

  return errors;
}

/** True when a paper carries a complete sitting (date + time + duration). */
export function isScheduled(
  paper: Pick<ExamSubject, "examDate" | "startTime" | "durationMin">,
): boolean {
  return (
    paper.examDate !== null &&
    paper.startTime !== null &&
    paper.durationMin !== null
  );
}

/** A sitting is all-or-nothing — mirrors `chk_exam_subjects_schedule`. */
export function scheduleError(input: {
  examDate?: string | null;
  startTime?: string | null;
  durationMin?: number | null;
}): string | null {
  const given = [input.examDate, input.startTime, input.durationMin].filter(
    (p) => p !== null && p !== undefined && p !== "",
  ).length;
  if (given === 0 || given === 3) return null;
  return "A sitting needs a date, a start time and a duration together";
}

/** "HH:mm" of a TIME column value, or "" when unscheduled. */
export function timeOf(value: string | null): string {
  return value ? value.slice(11, 16) : "";
}

/** Minutes → "HH:mm" for computed end times in the routine grid. */
export function addMinutes(startTime: string, minutes: number): string {
  const match = TIME_REGEX.exec(startTime);
  if (!match) return "";
  const total = Number(match[1]) * 60 + Number(match[2]) + minutes;
  const h = Math.floor((total % 1440) / 60)
    .toString()
    .padStart(2, "0");
  const m = (total % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

/** Clashes grouped by the paper they belong to, for per-row red flags. */
export function indexClashes(
  clashes: ExamClash[],
): Map<string, ExamClash[]> {
  const map = new Map<string, ExamClash[]>();
  for (const clash of clashes) {
    const key = clash.examSubjectId ?? `${clash.classId}|${clash.subjectId}`;
    map.set(key, [...(map.get(key) ?? []), clash]);
  }
  return map;
}

/** Split a clash list the way the backend's override policy does. */
export function splitClashes(clashes: ExamClash[]): {
  structural: ExamClash[];
  waivable: ExamClash[];
} {
  return {
    structural: clashes.filter((c) => !WAIVABLE_CLASH_KINDS.has(c.kind)),
    waivable: clashes.filter((c) => WAIVABLE_CLASH_KINDS.has(c.kind)),
  };
}
