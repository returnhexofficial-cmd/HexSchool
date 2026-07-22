import { SeatPlanStrategy } from '../../../common/constants';

/**
 * Seat-plan allocation strategies (roadmap M14 §4).
 *
 * Pure: candidates in, room layouts out. Nothing here knows about
 * enrollments, exams or Prisma — which is what makes the anti-cheating
 * property of INTERLEAVE something a unit test can actually assert.
 */

export interface Candidate {
  enrollmentId: string;
  classId: string;
  /** Sort key inside a class — the M11 roll number. */
  rollNo: number;
}

export interface RoomSpec {
  room: string;
  capacity: number;
}

export interface SeatAssignment {
  enrollmentId: string;
  seatNo: number;
}

export interface RoomAllocation {
  room: string;
  capacity: number;
  seats: SeatAssignment[];
}

export interface SeatPlanResult {
  rooms: RoomAllocation[];
  /** Candidates no room could hold — the caller turns this into a 409. */
  unseated: Candidate[];
  strategy: SeatPlanStrategy;
}

const byRoll = (a: Candidate, b: Candidate): number =>
  a.classId === b.classId
    ? a.rollNo - b.rollNo
    : a.classId.localeCompare(b.classId);

/**
 * Round-robin the classes so consecutive seats hold different papers.
 * With classes [A,A,A] and [B,B] the order is A,B,A,B,A — a candidate's
 * neighbour is sitting a different subject wherever the counts allow.
 */
function interleave(candidates: Candidate[]): Candidate[] {
  const queues = new Map<string, Candidate[]>();
  for (const c of [...candidates].sort(byRoll)) {
    const queue = queues.get(c.classId) ?? [];
    queue.push(c);
    queues.set(c.classId, queue);
  }

  // Largest class first each round, so the biggest group is spread the
  // widest instead of clumping at the tail.
  const out: Candidate[] = [];
  while (out.length < candidates.length) {
    const active = [...queues.values()]
      .filter((q) => q.length > 0)
      .sort((a, b) => b.length - a.length);
    for (const queue of active) {
      const next = queue.shift();
      if (next) out.push(next);
    }
  }
  return out;
}

/**
 * Chunk an ordered candidate list into rooms, reversing every other room
 * so roll order snakes rather than restarting — the "serpentine" of the
 * roadmap. Reversal matters when rooms are adjacent: the last seat of
 * room 1 and the first of room 2 are no longer consecutive rolls.
 */
function chunkIntoRooms(
  ordered: Candidate[],
  rooms: RoomSpec[],
  serpentine: boolean,
): { rooms: RoomAllocation[]; unseated: Candidate[] } {
  const allocations: RoomAllocation[] = [];
  let cursor = 0;

  rooms.forEach((spec, index) => {
    const slice = ordered.slice(cursor, cursor + spec.capacity);
    cursor += slice.length;
    const ordering =
      serpentine && index % 2 === 1 ? [...slice].reverse() : slice;
    allocations.push({
      room: spec.room,
      capacity: spec.capacity,
      seats: ordering.map((c, i) => ({
        enrollmentId: c.enrollmentId,
        seatNo: i + 1,
      })),
    });
  });

  return { rooms: allocations, unseated: ordered.slice(cursor) };
}

/**
 * Lay candidates into rooms.
 *
 * SERPENTINE keeps each class together in roll order (the layout an
 * invigilator can call a register from); INTERLEAVE mixes the classes so
 * no two neighbours sit the same paper.
 */
export function generateSeatPlan(
  candidates: Candidate[],
  rooms: RoomSpec[],
  strategy: SeatPlanStrategy,
): SeatPlanResult {
  const usable = rooms.filter((r) => r.capacity > 0);
  const ordered =
    strategy === SeatPlanStrategy.INTERLEAVE
      ? interleave(candidates)
      : [...candidates].sort(byRoll);

  const { rooms: allocated, unseated } = chunkIntoRooms(
    ordered,
    usable,
    strategy === SeatPlanStrategy.SERPENTINE,
  );

  return { rooms: allocated, unseated, strategy };
}

/** Total seats the given rooms provide — the capacity pre-flight check. */
export function totalCapacity(rooms: RoomSpec[]): number {
  return rooms.reduce((sum, r) => sum + Math.max(0, r.capacity), 0);
}

/**
 * Append one late candidate to the room with a free seat (roadmap M14 §8:
 * a student enrolled after the plan was generated). Returns the room and
 * seat number taken, or null when every room is full.
 */
export function appendCandidate(
  rooms: RoomAllocation[],
  enrollmentId: string,
): { room: string; seatNo: number } | null {
  for (const room of rooms) {
    if (room.seats.length >= room.capacity) continue;
    const taken = new Set(room.seats.map((s) => s.seatNo));
    let seatNo = 1;
    while (taken.has(seatNo)) seatNo += 1;
    if (seatNo > room.capacity) continue;
    room.seats.push({ enrollmentId, seatNo });
    return { room: room.room, seatNo };
  }
  return null;
}
