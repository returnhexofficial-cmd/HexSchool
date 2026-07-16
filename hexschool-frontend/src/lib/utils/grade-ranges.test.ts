import { describe, expect, it } from "vitest";
import { findCoverageIssues, findOverlapIssues } from "./grade-ranges";

const NCTB = [
  { grade: "A+", minMark: 80, maxMark: 100 },
  { grade: "A", minMark: 70, maxMark: 79 },
  { grade: "A-", minMark: 60, maxMark: 69 },
  { grade: "B", minMark: 50, maxMark: 59 },
  { grade: "C", minMark: 40, maxMark: 49 },
  { grade: "D", minMark: 33, maxMark: 39 },
  { grade: "F", minMark: 0, maxMark: 32 },
];

describe("grade range validators (frontend mirror)", () => {
  it("accepts the NCTB scale for both save and default", () => {
    expect(findOverlapIssues(NCTB)).toEqual([]);
    expect(findCoverageIssues(NCTB)).toEqual([]);
  });

  it("flags overlaps, inversions, out-of-bounds, and duplicates", () => {
    expect(
      findOverlapIssues([
        { grade: "A", minMark: 60, maxMark: 80 },
        { grade: "B", minMark: 75, maxMark: 100 },
      ]).map((i) => i.code),
    ).toContain("OVERLAP");
    expect(
      findOverlapIssues([{ grade: "X", minMark: 50, maxMark: 40 }]).map(
        (i) => i.code,
      ),
    ).toContain("INVERTED");
    expect(
      findOverlapIssues([{ grade: "X", minMark: 0, maxMark: 101 }]).map(
        (i) => i.code,
      ),
    ).toContain("OUT_OF_BOUNDS");
    expect(
      findOverlapIssues([
        { grade: "A", minMark: 50, maxMark: 100 },
        { grade: "A", minMark: 0, maxMark: 49 },
      ]).map((i) => i.code),
    ).toContain("DUPLICATE");
  });

  it("reports gaps at start, middle, and end for default coverage", () => {
    const messages = findCoverageIssues([
      { grade: "A", minMark: 50, maxMark: 79 },
      { grade: "B", minMark: 10, maxMark: 40 },
    ])
      .map((i) => i.message)
      .join(" | ");
    expect(messages).toContain("0–9");
    expect(messages).toContain("41–49");
    expect(messages).toContain("80–100");
  });

  it("touching bands (79|80) are not a gap or overlap", () => {
    const bands = [
      { grade: "P", minMark: 33, maxMark: 100 },
      { grade: "F", minMark: 0, maxMark: 32 },
    ];
    expect(findOverlapIssues(bands)).toEqual([]);
    expect(findCoverageIssues(bands)).toEqual([]);
  });
});
