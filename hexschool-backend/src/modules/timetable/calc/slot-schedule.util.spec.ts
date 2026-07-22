import {
  findOverlap,
  minutesLabel,
  slotAt,
  windowsOverlap,
  withinShift,
} from './slot-schedule.util';

const slot = (name: string, start: number, end: number) => ({
  id: name,
  name,
  startMinutes: start,
  endMinutes: end,
});

describe('slot-schedule util', () => {
  describe('windowsOverlap', () => {
    it('treats windows as half-open — back-to-back periods do not clash', () => {
      expect(windowsOverlap(slot('p1', 480, 525), slot('p2', 525, 570))).toBe(
        false,
      );
    });

    it('detects a partial overlap in either direction', () => {
      expect(windowsOverlap(slot('p1', 480, 525), slot('p2', 500, 570))).toBe(
        true,
      );
      expect(windowsOverlap(slot('p2', 500, 570), slot('p1', 480, 525))).toBe(
        true,
      );
    });

    it('detects containment (a long lab swallowing a short period)', () => {
      expect(windowsOverlap(slot('lab', 480, 600), slot('p2', 500, 520))).toBe(
        true,
      );
    });
  });

  it('findOverlap returns the offending sibling, not just a boolean', () => {
    const clash = findOverlap(slot('new', 500, 540), [
      slot('p1', 420, 480),
      slot('p2', 480, 525),
    ]);
    expect(clash?.name).toBe('p2');
  });

  it('findOverlap is null when the slot fits in a gap', () => {
    expect(
      findOverlap(slot('new', 525, 570), [
        slot('p1', 480, 525),
        slot('p2', 570, 615),
      ]),
    ).toBeNull();
  });

  describe('withinShift', () => {
    const shift = { startMinutes: 480, endMinutes: 780 }; // 08:00–13:00

    it('accepts a slot flush with both shift boundaries', () => {
      expect(withinShift(slot('all-day', 480, 780), shift)).toBe(true);
    });

    it('rejects a slot starting before the shift', () => {
      expect(withinShift(slot('early', 470, 520), shift)).toBe(false);
    });

    it('rejects a slot running past the shift', () => {
      expect(withinShift(slot('late', 740, 800), shift)).toBe(false);
    });
  });

  describe('slotAt', () => {
    const day = [
      slot('p1', 480, 525),
      slot('tiffin', 525, 545),
      slot('p2', 545, 590),
    ];

    it('finds the period covering a moment', () => {
      expect(slotAt(day, 500)?.name).toBe('p1');
    });

    it('gives a boundary minute to the period that is STARTING', () => {
      // 08:45 ends p1 and starts tiffin — the same half-open rule the
      // conflict engine uses, so the two can never disagree.
      expect(slotAt(day, 525)?.name).toBe('tiffin');
    });

    it('returns null before the first and after the last period', () => {
      expect(slotAt(day, 400)).toBeNull();
      expect(slotAt(day, 590)).toBeNull();
    });
  });

  it('minutesLabel zero-pads to HH:mm', () => {
    expect(minutesLabel(480)).toBe('08:00');
    expect(minutesLabel(545)).toBe('09:05');
    expect(minutesLabel(0)).toBe('00:00');
  });
});
