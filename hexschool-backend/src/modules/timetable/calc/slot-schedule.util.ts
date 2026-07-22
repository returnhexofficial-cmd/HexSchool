/**
 * Bell-schedule arithmetic (roadmap M13 §7), kept dependency-free so the
 * validation matrix is unit-testable. All inputs are minutes-of-day; the
 * service converts the `TIME(0)` columns with `timeColumnMinutes`.
 */

export interface SlotWindow {
  id: string;
  name: string;
  startMinutes: number;
  endMinutes: number;
}

export interface ShiftBounds {
  startMinutes: number;
  endMinutes: number;
}

/** Half-open, matching the conflict engine: 08:45 may start where 08:45 ends. */
export function windowsOverlap(a: SlotWindow, b: SlotWindow): boolean {
  return a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes;
}

/**
 * The first slot `candidate` collides with, or null. `siblings` should
 * already exclude the slot being edited so an update never conflicts
 * with its own previous times.
 */
export function findOverlap(
  candidate: SlotWindow,
  siblings: SlotWindow[],
): SlotWindow | null {
  return siblings.find((s) => windowsOverlap(candidate, s)) ?? null;
}

/**
 * A slot must sit inside its shift's working window. Shifts that wrap
 * past midnight are not a thing in BD schools, so a plain containment
 * check is correct here.
 */
export function withinShift(
  candidate: SlotWindow,
  shift: ShiftBounds,
): boolean {
  return (
    candidate.startMinutes >= shift.startMinutes &&
    candidate.endMinutes <= shift.endMinutes
  );
}

/**
 * The slot covering `atMinutes`, backing `getCurrentPeriod()` (roadmap
 * M13 §4). Slots are half-open, so the boundary minute belongs to the
 * period that is starting — the same rule the conflict engine uses, so
 * "which period is it now" and "do these clash" can never disagree.
 */
export function slotAt(
  slots: SlotWindow[],
  atMinutes: number,
): SlotWindow | null {
  return (
    slots.find(
      (s) => atMinutes >= s.startMinutes && atMinutes < s.endMinutes,
    ) ?? null
  );
}

/** Minutes-of-day → "HH:mm" for grid headers and PDF cells. */
export function minutesLabel(minutes: number): string {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
