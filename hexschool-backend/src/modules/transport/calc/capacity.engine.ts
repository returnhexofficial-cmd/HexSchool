/**
 * Seats (roadmap M25 §4 "capacity tracking (assigned vs vehicle
 * capacity)", §6 "over-capacity warns (hard block setting)").
 *
 * Dependency-free and golden-tested. Small arithmetic, but it carries
 * two decisions that are easy to get wrong and hard to notice:
 *
 *   1. **A route with no vehicle has no capacity — which is not the same
 *      as a capacity of zero.** Zero would report every such route as
 *      infinitely over capacity and drown the office in warnings about
 *      routes it has not finished setting up. `capacity: null` reports
 *      UNKNOWN and refuses to have an opinion.
 *   2. **The verdict and the message come from one place.** The same
 *      `capacityVerdict` answers the assignment endpoint (which may
 *      refuse), the route list's bar, and the utilization report — so a
 *      greyed button, a 409 and a red bar can never disagree, which is
 *      the M16 `deriveStatus` / M23 `canIssue` lesson applied to seats.
 */

export type CapacityState = 'UNKNOWN' | 'SPACE' | 'FULL' | 'OVER';

export interface CapacityInput {
  /** Seats on the route's vehicle; `null` when no vehicle is attached. */
  capacity: number | null;
  /** Live riders already assigned (ACTIVE + SUSPENDED — see below). */
  assigned: number;
  /** Riders about to be added; 0 for a pure read. */
  incoming?: number;
}

export interface CapacityStatus {
  state: CapacityState;
  capacity: number | null;
  assigned: number;
  /** After the incoming riders — what the office is deciding about. */
  projected: number;
  /** `null` when capacity is unknown; never negative. */
  seatsLeft: number | null;
  /** 0–∞, rounded to one decimal; `null` when capacity is unknown. */
  utilization: number | null;
  /** Human sentence for the warning banner and the 409 body. */
  message: string | null;
}

/**
 * A SUSPENDED rider still counts against the seats. That is the whole
 * point of suspending rather than ending: the child is coming back, and
 * the school is holding their place. Filling the seat in the meantime
 * would mean the office has to un-assign somebody in three weeks.
 */
export function capacityStatus(input: CapacityInput): CapacityStatus {
  const assigned = Math.max(0, Math.trunc(input.assigned));
  const incoming = Math.max(0, Math.trunc(input.incoming ?? 0));
  const projected = assigned + incoming;

  if (input.capacity === null || !Number.isFinite(input.capacity)) {
    return {
      state: 'UNKNOWN',
      capacity: null,
      assigned,
      projected,
      seatsLeft: null,
      utilization: null,
      message: 'This route has no vehicle, so its capacity is unknown.',
    };
  }

  const capacity = Math.max(0, Math.trunc(input.capacity));
  const seatsLeft = Math.max(0, capacity - projected);
  const utilization =
    capacity === 0 ? null : Math.round((projected / capacity) * 1000) / 10;

  if (projected > capacity) {
    return {
      state: 'OVER',
      capacity,
      assigned,
      projected,
      seatsLeft,
      utilization,
      message: `${projected} riders against ${capacity} seats — ${projected - capacity} over capacity.`,
    };
  }
  if (projected === capacity) {
    return {
      state: 'FULL',
      capacity,
      assigned,
      projected,
      seatsLeft,
      utilization,
      message: `${capacity} of ${capacity} seats taken — the bus is full.`,
    };
  }
  return {
    state: 'SPACE',
    capacity,
    assigned,
    projected,
    seatsLeft,
    utilization,
    message: null,
  };
}

export interface CapacityVerdict {
  allowed: boolean;
  /** True when the caller may proceed but should be told first. */
  warn: boolean;
  /** Set when `allowed` is false — the permission that would allow it. */
  overridePermission?: string;
  status: CapacityStatus;
  reason: string | null;
}

/**
 * May this rider be added?
 *
 * Roadmap §6: over-capacity **warns**, and a school that means it turns
 * on `transport.capacity_hard_block`. The refusal is then a *policy*
 * refusal, so it carries an override permission — the M13/M14/M23
 * structural-vs-policy split. There is no structural seat rule here: a
 * bus with 40 seats and 41 children is a real thing that happens in
 * Bangladesh, and a system that made it impossible to record would
 * simply be lied to.
 */
export function capacityVerdict(
  input: CapacityInput & { hardBlock: boolean; override?: boolean },
): CapacityVerdict {
  const status = capacityStatus(input);

  if (status.state !== 'OVER') {
    return { allowed: true, warn: false, status, reason: null };
  }
  if (!input.hardBlock || input.override === true) {
    return {
      allowed: true,
      warn: true,
      status,
      reason: status.message,
    };
  }
  return {
    allowed: false,
    warn: false,
    overridePermission: 'transport.assign.override',
    status,
    reason: status.message,
  };
}

export interface StopLoad {
  stopId: string;
  stopName: string;
  riders: number;
}

/**
 * Riders per stop, busiest first, then by the route order — what the
 * driver's sheet is sorted by and what tells an office that one corner
 * needs its own pickup time.
 */
export function stopLoads(
  stops: Array<{ id: string; name: string; displayOrder: number }>,
  ridersByStop: Map<string, number>,
): StopLoad[] {
  return stops
    .map((stop) => ({
      stopId: stop.id,
      stopName: stop.name,
      riders: ridersByStop.get(stop.id) ?? 0,
      order: stop.displayOrder,
    }))
    .sort((a, b) => b.riders - a.riders || a.order - b.order)
    .map(({ stopId, stopName, riders }) => ({ stopId, stopName, riders }));
}

export interface FleetUtilization {
  routes: number;
  /** Routes whose vehicle capacity is known. */
  measurable: number;
  seats: number;
  riders: number;
  /** Percentage over the MEASURABLE routes only. */
  utilization: number | null;
  overCapacity: number;
}

/**
 * The fleet-wide number. Routes with no vehicle are counted in `routes`
 * and excluded from the percentage: averaging them in as zero would make
 * a school that has drawn next year's routes look like it is running
 * half-empty buses today.
 */
export function fleetUtilization(
  routes: Array<{ capacity: number | null; assigned: number }>,
): FleetUtilization {
  let seats = 0;
  let riders = 0;
  let measurable = 0;
  let overCapacity = 0;

  for (const route of routes) {
    const status = capacityStatus(route);
    if (status.capacity !== null) {
      measurable++;
      seats += status.capacity;
      riders += status.assigned;
      if (status.state === 'OVER') overCapacity++;
    }
  }

  return {
    routes: routes.length,
    measurable,
    seats,
    riders,
    utilization: seats === 0 ? null : Math.round((riders / seats) * 1000) / 10,
    overCapacity,
  };
}
