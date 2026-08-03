/**
 * Beds: how many there are, how many are taken, and **the single verdict
 * every "can this student have this bed" question funnels through**.
 *
 * Dependency-free and golden-tested. Two decisions carry the file:
 *
 *   1. **One verdict, three renderings.** `canAllocate` answers the
 *      occupancy grid's greyed-out chip, the allocation endpoint's 409
 *      and the transfer wizard's blocked-reason line. They are the same
 *      object rendered three ways, so they cannot disagree — the M16
 *      `deriveStatus` / M23 `canIssue` / M25 `capacityVerdict` rule,
 *      fourth use.
 *   2. **Structural and policy refusals are different things** (the
 *      M13/M14/M23/M25 two-tier split). A bed somebody else is sleeping
 *      in, and a boy in the girls' hostel, are *structural*: no
 *      permission reaches them, because no school means to do either. A
 *      room under maintenance, a hostel switched off, and a student whose
 *      record says `OTHER` are *policy*: a real warden puts a child
 *      somewhere on the night the roof leaks, and a system that made that
 *      unrecordable would simply be lied to (the M25 over-capacity
 *      reasoning).
 *
 * The `OTHER` case is worth its own sentence. A hostel is BOYS or GIRLS
 * because a BD boarding house is, and a student whose gender is recorded
 * as `OTHER` matches neither. Refusing outright would make the system
 * decide something that is the school's to decide, and silently allowing
 * it would defeat the check for everybody. So it warns, and needs the
 * override — which puts a name against the decision.
 */

import type { BedState, HostelKind, RoomState, StudentGender } from './types';

export type BedAvailability = 'FREE' | 'TAKEN' | 'MAINTENANCE';

export interface AllocationCandidate {
  /** The bed being asked about. */
  bedStatus: BedState;
  /** True when a live allocation already points at this bed. */
  bedHeld: boolean;
  roomStatus: RoomState;
  hostelActive: boolean;
  hostelType: HostelKind;
  studentGender: StudentGender;
  /** True when the student already has a live allocation elsewhere. */
  alreadyResident: boolean;
  /** Whether the caller holds `hostel.allocate.override`. */
  override: boolean;
}

export interface AllocationVerdict {
  allowed: boolean;
  /** True when the refusal is one no permission can reach. */
  structural: boolean;
  /** Set when the move is allowed but somebody should know. */
  warn: boolean;
  /** A sentence for the 409 body, the tooltip and the banner. */
  reason: string | null;
  /** Set when an override would change the answer — the UI offers it. */
  overridable: boolean;
}

const OK: AllocationVerdict = {
  allowed: true,
  structural: false,
  warn: false,
  reason: null,
  overridable: false,
};

function refuse(
  reason: string,
  structural: boolean,
  overridable: boolean,
): AllocationVerdict {
  return { allowed: false, structural, warn: false, reason, overridable };
}

function warn(reason: string): AllocationVerdict {
  return {
    allowed: true,
    structural: false,
    warn: true,
    reason,
    overridable: false,
  };
}

/** Does this student's gender match what the building is for? */
export function genderMatches(
  hostelType: HostelKind,
  gender: StudentGender,
): boolean {
  return (
    (hostelType === 'BOYS' && gender === 'MALE') ||
    (hostelType === 'GIRLS' && gender === 'FEMALE')
  );
}

/**
 * The verdict. Ordered so the *most* fundamental refusal is the one
 * reported: telling a clerk "that room is under maintenance" about a bed
 * somebody is already sleeping in would send them to fix the wrong thing.
 */
export function canAllocate(input: AllocationCandidate): AllocationVerdict {
  // ── structural: no permission reaches these ────────────────────────
  if (input.bedHeld || input.bedStatus === 'OCCUPIED') {
    return refuse(
      'That bed already has a boarder in it. Vacate or transfer them first.',
      true,
      false,
    );
  }
  if (input.alreadyResident) {
    return refuse(
      'That student already has a bed. Transfer them rather than allocating a second.',
      true,
      false,
    );
  }
  if (
    input.studentGender !== 'OTHER' &&
    !genderMatches(input.hostelType, input.studentGender)
  ) {
    return refuse(
      `That is the ${input.hostelType === 'BOYS' ? "boys'" : "girls'"} hostel, and this student is recorded as ${input.studentGender}.`,
      true,
      false,
    );
  }

  // ── policy: an override with a name on it may pass ─────────────────
  if (!input.hostelActive) {
    return input.override
      ? warn('That hostel is inactive — allocated under override.')
      : refuse(
          'That hostel is inactive. Reactivate it, or use hostel.allocate.override.',
          false,
          true,
        );
  }
  if (input.bedStatus === 'MAINTENANCE') {
    return input.override
      ? warn('That bed is marked for maintenance — allocated under override.')
      : refuse(
          'That bed is marked for maintenance. Clear it, or use hostel.allocate.override.',
          false,
          true,
        );
  }
  if (input.roomStatus === 'MAINTENANCE') {
    return input.override
      ? warn('That room is under maintenance — allocated under override.')
      : refuse(
          'That room is under maintenance. Finish the work, or use hostel.allocate.override.',
          false,
          true,
        );
  }
  if (input.studentGender === 'OTHER') {
    return input.override
      ? warn(
          "This student's gender is recorded as OTHER, which matches neither hostel — allocated under override.",
        )
      : refuse(
          "This student's gender is recorded as OTHER, which matches neither hostel type. Someone with hostel.allocate.override has to make that call.",
          false,
          true,
        );
  }

  return OK;
}

// ── occupancy arithmetic ─────────────────────────────────────────────

export interface BedCount {
  total: number;
  occupied: number;
  vacant: number;
  maintenance: number;
}

export interface OccupancyStats extends BedCount {
  /** Occupied ÷ (total − maintenance), 0–100 to one decimal. A bed out
   *  of service is not a vacancy the school failed to fill, so it comes
   *  out of the denominator — the M25 "a route with no vehicle has no
   *  capacity, which is not a capacity of zero" reasoning. */
  utilization: number;
  /** Beds a boarder could actually be put in tonight. */
  available: number;
}

export function bedAvailability(
  status: BedState,
  held: boolean,
): BedAvailability {
  if (status === 'MAINTENANCE') return 'MAINTENANCE';
  return held || status === 'OCCUPIED' ? 'TAKEN' : 'FREE';
}

/**
 * Roll a list of beds up into the numbers the occupancy grid, the room
 * card, the hostel header and the report all print. One function, so the
 * four cannot disagree about what "full" means.
 */
export function summarize(
  beds: ReadonlyArray<{ status: BedState; held: boolean }>,
): OccupancyStats {
  let occupied = 0;
  let maintenance = 0;
  let vacant = 0;

  for (const bed of beds) {
    switch (bedAvailability(bed.status, bed.held)) {
      case 'TAKEN':
        occupied++;
        break;
      case 'MAINTENANCE':
        maintenance++;
        break;
      default:
        vacant++;
    }
  }

  const total = beds.length;
  const serviceable = total - maintenance;
  return {
    total,
    occupied,
    vacant,
    maintenance,
    available: vacant,
    utilization:
      serviceable <= 0 ? 0 : Math.round((occupied / serviceable) * 1000) / 10,
  };
}

/**
 * Roadmap §7: "bed_count = generated beds". A room whose declared count
 * and actual bed rows disagree is not an error the database can catch —
 * `bed_count` is intent and the beds are facts — so it is reported, and
 * the occupancy report prints it. A warden who has quietly squeezed a
 * fourth bed into a three-bed room is precisely what the head wants to
 * see, and deleting the extra bed is not the system's call.
 */
export function bedCountMismatch(
  declared: number,
  actual: number,
): string | null {
  if (declared === actual) return null;
  return actual > declared
    ? `${actual} beds are recorded in a room declared for ${declared}`
    : `${actual} of ${declared} declared beds have been created`;
}
