import { z } from "zod";
import type {
  ConflictKind,
  PeriodSlotType,
  RoutineCell,
  RoutineConflict,
  TimetableStatus,
  Weekday,
} from "@/lib/api/timetable";

/** Mirrors backend M13 DTOs. */

export const WEEKDAYS = [
  "SAT",
  "SUN",
  "MON",
  "TUE",
  "WED",
  "THU",
  "FRI",
] as const;

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  SAT: "Saturday",
  SUN: "Sunday",
  MON: "Monday",
  TUE: "Tuesday",
  WED: "Wednesday",
  THU: "Thursday",
  FRI: "Friday",
};

export const WEEKDAY_SHORT: Record<Weekday, string> = {
  SAT: "Sat",
  SUN: "Sun",
  MON: "Mon",
  TUE: "Tue",
  WED: "Wed",
  THU: "Thu",
  FRI: "Fri",
};

export const PERIOD_SLOT_TYPES = ["CLASS", "BREAK", "ASSEMBLY"] as const;

export const PERIOD_SLOT_TYPE_LABELS: Record<PeriodSlotType, string> = {
  CLASS: "Class",
  BREAK: "Break",
  ASSEMBLY: "Assembly",
};

export const TIMETABLE_STATUS_LABELS: Record<TimetableStatus, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  ARCHIVED: "Archived",
};

export const CONFLICT_KIND_LABELS: Record<ConflictKind, string> = {
  TEACHER: "Teacher clash",
  ROOM: "Room clash",
  DUPLICATE_CELL: "Duplicate cell",
  TEACHER_DAILY_CAP: "Daily limit",
};

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const periodSlotSchema = z
  .object({
    shiftId: z.string().uuid({ message: "Choose a shift" }),
    name: z.string().min(1, "Name is required").max(50),
    startTime: z.string().regex(TIME_REGEX, "Use HH:mm (24-hour)"),
    endTime: z.string().regex(TIME_REGEX, "Use HH:mm (24-hour)"),
    type: z.enum(PERIOD_SLOT_TYPES),
  })
  .refine((v) => minutesOf(v.startTime) < minutesOf(v.endTime), {
    message: "Start time must be before end time",
    path: ["endTime"],
  });

export type PeriodSlotValues = z.infer<typeof periodSlotSchema>;

export const createTimetableSchema = z.object({
  sectionId: z.string().uuid({ message: "Choose a section" }),
  effectiveFrom: z
    .string()
    .regex(DATE_REGEX, "Use the YYYY-MM-DD format")
    .optional()
    .or(z.literal("")),
  notes: z.string().max(500).optional(),
  copyFromPublished: z.boolean().optional(),
});

export type CreateTimetableValues = z.infer<typeof createTimetableSchema>;

/** "HH:mm" → minutes since midnight; -1 for anything malformed. */
export function minutesOf(value: string): number {
  const match = TIME_REGEX.exec(value.trim());
  if (!match) return -1;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Grid lookup key — the routine is a sparse day × period matrix. */
export function cellKey(day: Weekday, periodSlotId: string): string {
  return `${day}|${periodSlotId}`;
}

/** Index the cells the API returns so the grid renders in one pass. */
export function indexCells<T extends { day: Weekday; periodSlotId: string }>(
  cells: T[],
): Map<string, T> {
  return new Map(cells.map((cell) => [cellKey(cell.day, cell.periodSlotId), cell]));
}

/**
 * Conflicts grouped by the cell they belong to. The builder paints a red
 * border per cell and lists every reason in its tooltip, so a cell that
 * clashes on both teacher AND room shows both.
 */
export function indexConflicts(
  conflicts: RoutineConflict[],
): Map<string, RoutineConflict[]> {
  const map = new Map<string, RoutineConflict[]>();
  for (const conflict of conflicts) {
    const key = cellKey(conflict.day, conflict.slotId);
    map.set(key, [...(map.get(key) ?? []), conflict]);
  }
  return map;
}

/** Only CLASS slots can hold a lesson (roadmap M13 §6). */
export function isTeachable(type: PeriodSlotType): boolean {
  return type === "CLASS";
}

/** Coverage of a grid: filled teachable cells over the ones that exist. */
export function coverage(
  cells: Array<{ day: Weekday; periodSlotId: string }>,
  slots: Array<{ id: string; type: PeriodSlotType }>,
  days: Weekday[],
): { filled: number; capacity: number; percent: number } {
  const capacity = slots.filter((s) => isTeachable(s.type)).length * days.length;
  const filled = cells.length;
  return {
    filled,
    capacity,
    percent: capacity === 0 ? 0 : Math.round((filled / capacity) * 100),
  };
}

/** One-line cell summary for compact views and print previews. */
export function describeCell(cell: RoutineCell): string {
  const parts = [cell.subject.name, cell.teacher.name];
  if (cell.combinedWith) parts.push(`with ${cell.combinedWith.label}`);
  else if (cell.roomNo) parts.push(`Room ${cell.roomNo}`);
  return parts.join(" · ");
}
