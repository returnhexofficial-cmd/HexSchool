/**
 * The shape of a route: its plate, its stop sequence and the times on it
 * (roadmap M25 §5 "route detail with draggable stops", §7 "BD reg no
 * format free-text but uq; times HH:MM").
 *
 * Dependency-free and golden-tested. Two things live here rather than in
 * a service:
 *
 *   - **Reordering is a plan, not an UPDATE loop.** `uq_route_stops_order`
 *     is a live-rows unique over `(route_id, display_order)`, so writing
 *     0…N straight over the top of the current order collides mid-way
 *     through — the M11 roll-number lesson exactly. `reorderPlan` returns
 *     the two passes (park everything at a negative position, then write
 *     the real one) so the collision is impossible rather than unlikely.
 *   - **A route's times are checked for SENSE, not for validity.** A
 *     pickup sequence that goes 07:10, 06:50, 07:30 is a route somebody
 *     mis-typed; refusing it would be wrong (a route can genuinely cross
 *     midnight or double back) so it comes back as a warning the builder
 *     shows beside the stop.
 */

/** BD plates are written many ways; compare them one way. */
export function normalizeRegNo(regNo: string): string {
  return regNo.trim().replace(/\s+/g, ' ').toUpperCase();
}

/** `HH:MM` (24-hour) → minutes since midnight, or `null`. */
export function parseClock(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Minutes since midnight → `HH:MM`, the format the sheet prints. */
export function formatClock(minutes: number | null): string | null {
  if (minutes === null || !Number.isFinite(minutes)) return null;
  const normalized = ((Math.trunc(minutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  return `${String(hours).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

export interface PlannedStop {
  id: string;
  name: string;
  displayOrder: number;
  /** `HH:MM` or null. */
  pickupTime?: string | null;
  dropTime?: string | null;
}

export interface ReorderStep {
  stopId: string;
  displayOrder: number;
}

export interface ReorderPlan {
  /** Pass 1: park every touched row at a position nothing else holds. */
  park: ReorderStep[];
  /** Pass 2: the order the office actually asked for, compacted to 0…N. */
  apply: ReorderStep[];
}

/**
 * Turn "these ids, in this order" into two collision-free passes.
 *
 * Negative positions are used for the parking pass because
 * `chk_route_stops_shape` requires `display_order >= 0` — so parking has
 * to happen somewhere the CHECK allows. Offsetting by the number of
 * stops puts the parked block above anything the route can currently
 * hold, which is the same trick as M11's negative rolls with the sign
 * flipped to satisfy the constraint.
 */
export function reorderPlan(
  orderedStopIds: string[],
  existing: PlannedStop[],
): ReorderPlan {
  const known = new Set(existing.map((stop) => stop.id));
  const ids = orderedStopIds.filter((id) => known.has(id));

  // Anything the caller did not mention keeps its relative order and
  // follows the reordered block — a partial reorder must not silently
  // drop the stops that were not dragged.
  const rest = existing
    .filter((stop) => !ids.includes(stop.id))
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((stop) => stop.id);

  const finalOrder = [...ids, ...rest];
  const offset = existing.length + finalOrder.length + 1;

  return {
    park: finalOrder.map((stopId, index) => ({
      stopId,
      displayOrder: offset + index,
    })),
    apply: finalOrder.map((stopId, index) => ({ stopId, displayOrder: index })),
  };
}

/** The next free position when a stop is appended. */
export function nextDisplayOrder(existing: PlannedStop[]): number {
  return existing.reduce(
    (max, stop) => Math.max(max, stop.displayOrder + 1),
    0,
  );
}

export interface StopSequenceIssue {
  stopId: string;
  stopName: string;
  message: string;
}

/**
 * Warnings, never errors.
 *
 * A morning route picks children up in sequence, so pickup times should
 * ascend with the stop order; the afternoon run drives the same road
 * backwards, so drop times should *descend*. Both are true of nearly
 * every route and neither is a rule — which is exactly the shape of a
 * warning.
 */
export function stopSequenceIssues(stops: PlannedStop[]): StopSequenceIssue[] {
  const ordered = [...stops].sort((a, b) => a.displayOrder - b.displayOrder);
  const issues: StopSequenceIssue[] = [];

  let lastPickup: number | null = null;
  let lastDrop: number | null = null;

  for (const stop of ordered) {
    const pickup = parseClock(stop.pickupTime ?? null);
    const drop = parseClock(stop.dropTime ?? null);

    if (pickup !== null && lastPickup !== null && pickup < lastPickup) {
      issues.push({
        stopId: stop.id,
        stopName: stop.name,
        message: `Pickup ${formatClock(pickup)} is earlier than the previous stop's ${formatClock(lastPickup)} — check the stop order.`,
      });
    }
    if (drop !== null && lastDrop !== null && drop > lastDrop) {
      issues.push({
        stopId: stop.id,
        stopName: stop.name,
        message: `Drop ${formatClock(drop)} is later than the previous stop's ${formatClock(lastDrop)} — the afternoon run usually reverses the morning order.`,
      });
    }
    if (pickup !== null && drop !== null && drop <= pickup) {
      issues.push({
        stopId: stop.id,
        stopName: stop.name,
        message: `Drop ${formatClock(drop)} is not after pickup ${formatClock(pickup)} — one of the two is probably the wrong run.`,
      });
    }

    if (pickup !== null) lastPickup = pickup;
    if (drop !== null) lastDrop = drop;
  }

  return issues;
}

/**
 * The window a route runs over — first pickup to last drop — printed at
 * the head of the driver's sheet. `null` when no stop carries a time,
 * because "00:00 to 00:00" reads like a route that runs at midnight.
 */
export function routeWindow(stops: PlannedStop[]): {
  firstPickup: string | null;
  lastDrop: string | null;
} {
  const pickups = stops
    .map((stop) => parseClock(stop.pickupTime ?? null))
    .filter((value): value is number => value !== null);
  const drops = stops
    .map((stop) => parseClock(stop.dropTime ?? null))
    .filter((value): value is number => value !== null);

  return {
    firstPickup: pickups.length ? formatClock(Math.min(...pickups)) : null,
    lastDrop: drops.length ? formatClock(Math.max(...drops)) : null,
  };
}
