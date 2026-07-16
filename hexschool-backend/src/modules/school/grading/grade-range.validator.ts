/**
 * Pure grade-band validators (dependency-free per the calculation-engine
 * convention, PROJECT_CONTEXT §4). Two levels (roadmap M04 §6):
 *  - any system: bands must not overlap (and min ≤ max);
 *  - a DEFAULT system: bands must additionally cover 0–100 with no gaps.
 */

export interface GradeBand {
  grade: string;
  minMark: number;
  maxMark: number;
}

export interface RangeIssue {
  code: 'INVERTED' | 'OUT_OF_BOUNDS' | 'OVERLAP' | 'GAP' | 'EMPTY';
  message: string;
}

/** Overlap/sanity issues — must be empty for ANY save. */
export function findOverlapIssues(bands: GradeBand[]): RangeIssue[] {
  const issues: RangeIssue[] = [];
  for (const b of bands) {
    if (b.minMark > b.maxMark) {
      issues.push({
        code: 'INVERTED',
        message: `${b.grade}: min mark ${b.minMark} exceeds max mark ${b.maxMark}`,
      });
    }
    if (b.minMark < 0 || b.maxMark > 100) {
      issues.push({
        code: 'OUT_OF_BOUNDS',
        message: `${b.grade}: marks must stay within 0–100`,
      });
    }
  }

  const sorted = [...bands].sort((a, b) => a.minMark - b.minMark);
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (curr.minMark <= prev.maxMark) {
      issues.push({
        code: 'OVERLAP',
        message: `${prev.grade} (…–${prev.maxMark}) overlaps ${curr.grade} (${curr.minMark}–…)`,
      });
    }
  }
  return issues;
}

/** Gap/coverage issues — must ALSO be empty before a system can be default. */
export function findCoverageIssues(bands: GradeBand[]): RangeIssue[] {
  if (bands.length === 0) {
    return [{ code: 'EMPTY', message: 'At least one grade band is required' }];
  }
  const issues: RangeIssue[] = [];
  const sorted = [...bands].sort((a, b) => a.minMark - b.minMark);

  if (sorted[0].minMark > 0) {
    issues.push({
      code: 'GAP',
      message: `Marks 0–${sorted[0].minMark - 1} are not covered`,
    });
  }
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (curr.minMark > prev.maxMark + 1) {
      issues.push({
        code: 'GAP',
        message: `Marks ${prev.maxMark + 1}–${curr.minMark - 1} are not covered`,
      });
    }
  }
  const last = sorted[sorted.length - 1];
  if (last.maxMark < 100) {
    issues.push({
      code: 'GAP',
      message: `Marks ${last.maxMark + 1}–100 are not covered`,
    });
  }
  return issues;
}
