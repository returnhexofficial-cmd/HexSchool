import { SeatPlanStrategy } from '../../../common/constants';
import {
  appendCandidate,
  Candidate,
  generateSeatPlan,
  RoomSpec,
  totalCapacity,
} from './seat-plan.engine';

/** Roadmap M14 §9: "Unit: … seat plan strategies". */
describe('seat plan engine', () => {
  const candidates = (classId: string, count: number, from = 1): Candidate[] =>
    Array.from({ length: count }, (_, i) => ({
      enrollmentId: `${classId}-e${from + i}`,
      classId,
      rollNo: from + i,
    }));

  const rooms = (...specs: Array<[string, number]>): RoomSpec[] =>
    specs.map(([room, capacity]) => ({ room, capacity }));

  const seatedIds = (result: ReturnType<typeof generateSeatPlan>): string[] =>
    result.rooms.flatMap((r) => r.seats.map((s) => s.enrollmentId));

  describe('SERPENTINE', () => {
    it('fills rooms in roll order', () => {
      const result = generateSeatPlan(
        candidates('A', 4),
        rooms(['R1', 4]),
        SeatPlanStrategy.SERPENTINE,
      );
      expect(result.rooms[0].seats).toEqual([
        { enrollmentId: 'A-e1', seatNo: 1 },
        { enrollmentId: 'A-e2', seatNo: 2 },
        { enrollmentId: 'A-e3', seatNo: 3 },
        { enrollmentId: 'A-e4', seatNo: 4 },
      ]);
      expect(result.unseated).toEqual([]);
    });

    it('snakes: the second room runs backwards so adjacent rolls are not adjacent seats', () => {
      const result = generateSeatPlan(
        candidates('A', 6),
        rooms(['R1', 3], ['R2', 3]),
        SeatPlanStrategy.SERPENTINE,
      );
      expect(result.rooms[0].seats.map((s) => s.enrollmentId)).toEqual([
        'A-e1',
        'A-e2',
        'A-e3',
      ]);
      // Room 2 holds rolls 4–6 but seated in reverse, so seat 1 is roll 6
      // rather than roll 4 sitting right next to roll 3 next door.
      expect(result.rooms[1].seats.map((s) => s.enrollmentId)).toEqual([
        'A-e6',
        'A-e5',
        'A-e4',
      ]);
    });

    it('keeps seat numbers 1..n within each room regardless of direction', () => {
      const result = generateSeatPlan(
        candidates('A', 6),
        rooms(['R1', 3], ['R2', 3]),
        SeatPlanStrategy.SERPENTINE,
      );
      for (const room of result.rooms) {
        expect(room.seats.map((s) => s.seatNo)).toEqual([1, 2, 3]);
      }
    });

    it('keeps a class contiguous when several classes sit together', () => {
      const result = generateSeatPlan(
        [...candidates('B', 2), ...candidates('A', 2)],
        rooms(['R1', 4]),
        SeatPlanStrategy.SERPENTINE,
      );
      expect(seatedIds(result)).toEqual(['A-e1', 'A-e2', 'B-e1', 'B-e2']);
    });
  });

  describe('INTERLEAVE (anti-cheating)', () => {
    it('gives every candidate a neighbour from another class', () => {
      const result = generateSeatPlan(
        [...candidates('A', 3), ...candidates('B', 3)],
        rooms(['R1', 6]),
        SeatPlanStrategy.INTERLEAVE,
      );
      const classes = seatedIds(result).map((id) => id.split('-')[0]);
      for (let i = 0; i < classes.length - 1; i += 1) {
        expect(classes[i]).not.toBe(classes[i + 1]);
      }
    });

    it('seats everyone exactly once even with uneven class sizes', () => {
      const all = [...candidates('A', 5), ...candidates('B', 2)];
      const result = generateSeatPlan(
        all,
        rooms(['R1', 7]),
        SeatPlanStrategy.INTERLEAVE,
      );
      const seated = seatedIds(result);
      expect(seated).toHaveLength(7);
      expect(new Set(seated).size).toBe(7);
      expect(result.unseated).toEqual([]);
    });

    it('spreads the largest class out instead of clumping it at the tail', () => {
      const result = generateSeatPlan(
        [...candidates('A', 4), ...candidates('B', 2)],
        rooms(['R1', 6]),
        SeatPlanStrategy.INTERLEAVE,
      );
      const classes = seatedIds(result).map((id) => id.split('-')[0]);
      // A must appear before the final two seats rather than only after B
      // is exhausted.
      expect(classes.slice(0, 4)).toContain('B');
    });

    it('degrades to plain order when only one class sits', () => {
      const result = generateSeatPlan(
        candidates('A', 3),
        rooms(['R1', 3]),
        SeatPlanStrategy.INTERLEAVE,
      );
      expect(seatedIds(result)).toEqual(['A-e1', 'A-e2', 'A-e3']);
    });
  });

  describe('capacity', () => {
    it('reports candidates no room could hold', () => {
      const result = generateSeatPlan(
        candidates('A', 5),
        rooms(['R1', 3]),
        SeatPlanStrategy.SERPENTINE,
      );
      expect(seatedIds(result)).toHaveLength(3);
      expect(result.unseated.map((c) => c.enrollmentId)).toEqual([
        'A-e4',
        'A-e5',
      ]);
    });

    it('ignores zero-capacity rooms entirely', () => {
      const result = generateSeatPlan(
        candidates('A', 2),
        rooms(['R0', 0], ['R1', 2]),
        SeatPlanStrategy.SERPENTINE,
      );
      expect(result.rooms.map((r) => r.room)).toEqual(['R1']);
    });

    it('sums usable capacity', () => {
      expect(totalCapacity(rooms(['R1', 30], ['R2', 25]))).toBe(55);
      expect(totalCapacity(rooms(['R1', 30], ['R2', -5]))).toBe(30);
    });

    it('handles no candidates without inventing seats', () => {
      const result = generateSeatPlan(
        [],
        rooms(['R1', 30]),
        SeatPlanStrategy.SERPENTINE,
      );
      expect(result.rooms[0].seats).toEqual([]);
      expect(result.unseated).toEqual([]);
    });
  });

  describe('appending a late enrollee (roadmap §8)', () => {
    it('takes the first free seat in the first room with room', () => {
      const result = generateSeatPlan(
        candidates('A', 4),
        rooms(['R1', 4], ['R2', 4]),
        SeatPlanStrategy.SERPENTINE,
      );
      expect(appendCandidate(result.rooms, 'late-1')).toEqual({
        room: 'R2',
        seatNo: 1,
      });
    });

    it('fills a gap left by a withdrawn candidate', () => {
      const allocation = [
        {
          room: 'R1',
          capacity: 3,
          seats: [
            { enrollmentId: 'a', seatNo: 1 },
            { enrollmentId: 'c', seatNo: 3 },
          ],
        },
      ];
      expect(appendCandidate(allocation, 'late-1')).toEqual({
        room: 'R1',
        seatNo: 2,
      });
    });

    it('returns null when every room is full', () => {
      const result = generateSeatPlan(
        candidates('A', 4),
        rooms(['R1', 4]),
        SeatPlanStrategy.SERPENTINE,
      );
      expect(appendCandidate(result.rooms, 'late-1')).toBeNull();
    });
  });
});
