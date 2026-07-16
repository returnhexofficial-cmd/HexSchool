/**
 * Client-side mirror of the backend grade-range validators (Module 04) —
 * powers the LIVE overlap/gap warnings in the grading editor. The API
 * re-validates authoritatively on save.
 */

export interface GradeBandInput {
  grade: string;
  minMark: number;
  maxMark: number;
}

export interface GradeRangeIssue {
  code: "INVERTED" | "OUT_OF_BOUNDS" | "OVERLAP" | "GAP" | "EMPTY" | "DUPLICATE";
  message: string;
}

/** Issues that block ANY save (plus duplicate labels). */
export function findOverlapIssues(bands: GradeBandInput[]): GradeRangeIssue[] {
  const issues: GradeRangeIssue[] = [];

  const labels = bands.map((b) => b.grade.trim()).filter(Boolean);
  if (new Set(labels).size !== labels.length) {
    issues.push({ code: "DUPLICATE", message: "Grade labels must be unique" });
  }

  for (const b of bands) {
    if (b.minMark > b.maxMark) {
      issues.push({
        code: "INVERTED",
        message: `${b.grade || "?"}: min ${b.minMark} exceeds max ${b.maxMark}`,
      });
    }
    if (b.minMark < 0 || b.maxMark > 100) {
      issues.push({
        code: "OUT_OF_BOUNDS",
        message: `${b.grade || "?"}: marks must stay within 0–100`,
      });
    }
  }

  const sorted = [...bands].sort((a, b) => a.minMark - b.minMark);
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (curr.minMark <= prev.maxMark) {
      issues.push({
        code: "OVERLAP",
        message: `${prev.grade || "?"} (…–${prev.maxMark}) overlaps ${curr.grade || "?"} (${curr.minMark}–…)`,
      });
    }
  }
  return issues;
}

/** Additional issues that block becoming the DEFAULT system. */
export function findCoverageIssues(bands: GradeBandInput[]): GradeRangeIssue[] {
  if (bands.length === 0) {
    return [{ code: "EMPTY", message: "At least one grade band is required" }];
  }
  const issues: GradeRangeIssue[] = [];
  const sorted = [...bands].sort((a, b) => a.minMark - b.minMark);

  if (sorted[0].minMark > 0) {
    issues.push({
      code: "GAP",
      message: `Marks 0–${sorted[0].minMark - 1} are not covered`,
    });
  }
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (curr.minMark > prev.maxMark + 1) {
      issues.push({
        code: "GAP",
        message: `Marks ${prev.maxMark + 1}–${curr.minMark - 1} are not covered`,
      });
    }
  }
  const last = sorted[sorted.length - 1];
  if (last.maxMark < 100) {
    issues.push({
      code: "GAP",
      message: `Marks ${last.maxMark + 1}–100 are not covered`,
    });
  }
  return issues;
}
