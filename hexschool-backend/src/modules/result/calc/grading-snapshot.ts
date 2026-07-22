/**
 * The frozen grade scale a result was computed through (roadmap M15 §3,
 * §8) and the two lookups every other engine needs.
 *
 * Dependency-free on purpose: the same code reads a snapshot taken
 * seconds ago during processing and one frozen three years ago on an
 * archived exam, without a database, a Nest container, or the live
 * `grading_systems` table in sight. That last part is the whole point —
 * **a published result is never re-read through the current scale**,
 * because editing a band would otherwise silently restate a report card
 * that has already gone home with a student.
 *
 * The blob's shape is written by Module 14 (`exams.grading_snapshot`)
 * and copied verbatim onto every `results` row.
 */

export interface GradeBand {
  grade: string;
  /** Grade point (NCTB: 5.00 down to 0.00). */
  point: number;
  minMark: number;
  maxMark: number;
}

export interface GradingSnapshot {
  gradingSystemId: string;
  name: string;
  frozenAt: string;
  /** Ascending by `minMark`; guaranteed to cover 0–100 without overlap. */
  gradePoints: GradeBand[];
}

/**
 * Read a snapshot out of a JSONB column, refusing anything that could
 * not grade a mark. Malformed input has to fail loudly here — the
 * alternative is a run that quietly gives 2,000 students an F.
 */
export function parseGradingSnapshot(raw: unknown): GradingSnapshot {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('Grading snapshot is missing or not an object');
  }
  const blob = raw as Record<string, unknown>;
  const bands = Array.isArray(blob.gradePoints) ? blob.gradePoints : [];

  const gradePoints: GradeBand[] = bands.map((entry, index) => {
    const band = entry as Record<string, unknown>;
    const grade = text(band.grade).trim();
    const point = Number(band.point);
    const minMark = Number(band.minMark);
    const maxMark = Number(band.maxMark);

    if (
      grade === '' ||
      !Number.isFinite(point) ||
      !Number.isFinite(minMark) ||
      !Number.isFinite(maxMark)
    ) {
      throw new Error(`Grading snapshot band #${index + 1} is incomplete`);
    }
    return { grade, point, minMark, maxMark };
  });

  if (gradePoints.length === 0) {
    throw new Error('Grading snapshot has no grade bands');
  }

  return {
    gradingSystemId: text(blob.gradingSystemId),
    name: text(blob.name) || 'Grading system',
    frozenAt: text(blob.frozenAt),
    gradePoints: [...gradePoints].sort((a, b) => a.minMark - b.minMark),
  };
}

/**
 * A JSONB field read as a string. Anything non-primitive becomes '' —
 * `String(someObject)` would quietly produce "[object Object]" and hide
 * a malformed snapshot behind a plausible-looking value.
 */
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

/** The band a mark percentage falls in. */
export function gradeForPercentage(
  snapshot: GradingSnapshot,
  percentage: number,
): GradeBand {
  const bands = snapshot.gradePoints;
  const clamped = Number.isFinite(percentage) ? percentage : 0;

  // The LAST band whose floor the percentage reaches. Deliberately
  // ignores `maxMark`: M04 validates the bands to cover 0–100 with no
  // gap and no overlap, so this lookup is total — whereas a
  // `min <= p && p <= max` test would fall through the crack at 32.5
  // and return nothing. It also means a fractional percentage never
  // rounds a fail up into a pass.
  let match = bands[0];
  for (const band of bands) {
    if (clamped >= band.minMark) match = band;
  }
  return match;
}

/**
 * The band a GPA maps to — the greatest band whose grade point the GPA
 * reaches. Reusing the school's own scale rather than a second GPA→letter
 * table means a school that renames A- to A(-) changes one thing.
 */
export function gradeForGpa(snapshot: GradingSnapshot, gpa: number): GradeBand {
  const byPoint = [...snapshot.gradePoints].sort((a, b) => a.point - b.point);
  let match = byPoint[0];
  for (const band of byPoint) {
    if (gpa >= band.point) match = band;
  }
  return match;
}

/**
 * The failing band — the lowest grade point in the scale. Everything
 * that forces a fail (absence, a missed component threshold, a failed
 * compulsory subject) resolves to this rather than to a hard-coded "F",
 * because the label is the school's to choose.
 */
export function failBand(snapshot: GradingSnapshot): GradeBand {
  return snapshot.gradePoints.reduce((lowest, band) =>
    band.point < lowest.point ? band : lowest,
  );
}

/** The scale's ceiling — the GPA cap, rather than a hard-coded 5.00. */
export function maxGradePoint(snapshot: GradingSnapshot): number {
  return snapshot.gradePoints.reduce(
    (highest, band) => Math.max(highest, band.point),
    0,
  );
}

/** Two decimals, the precision every mark/GPA column stores. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
