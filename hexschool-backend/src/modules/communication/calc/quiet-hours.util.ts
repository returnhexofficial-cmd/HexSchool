/**
 * Quiet-hours arithmetic (roadmap M17 §4 "respects quiet hours … no SMS
 * 21:00–08:00 except EMERGENCY"). Dependency-free; works in minutes-of-day
 * so it composes with `clock.util`'s `dhakaMinutesOfDay`.
 *
 * The window wraps midnight (21:00 → 08:00), which the naive `start ≤ t <
 * end` test gets wrong — so the wrap case is handled explicitly.
 */

/**
 * Is `minuteOfDay` inside the quiet window [start, end)? Handles a window
 * that wraps past midnight (start > end), which is the usual case.
 */
export function inQuietHours(
  minuteOfDay: number,
  startMin: number,
  endMin: number,
): boolean {
  if (startMin === endMin) return false; // empty window
  if (startMin < endMin) {
    // Same-day window, e.g. 01:00–05:00.
    return minuteOfDay >= startMin && minuteOfDay < endMin;
  }
  // Wrapping window, e.g. 21:00–08:00: quiet late tonight OR early tomorrow.
  return minuteOfDay >= startMin || minuteOfDay < endMin;
}

/**
 * How many minutes to hold a message queued so it lands at the end of
 * quiet hours. 0 when the current minute is not quiet (send now). Never
 * negative.
 */
export function delayUntilSendable(
  minuteOfDay: number,
  startMin: number,
  endMin: number,
): number {
  if (!inQuietHours(minuteOfDay, startMin, endMin)) return 0;
  // The window always ends at `endMin`; compute the forward distance,
  // wrapping across midnight if we are in the late-night half.
  const MINUTES_PER_DAY = 24 * 60;
  const delta = (endMin - minuteOfDay + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return delta;
}
