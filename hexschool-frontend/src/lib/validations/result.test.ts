import { describe, expect, it } from "vitest";
import type { ExamPaper, MarkGridRow } from "@/lib/api/result";
import {
  allocatedComponents,
  draftError,
  draftFromRow,
  draftToInput,
  draftTotal,
  emptyDraft,
  isDraftFilled,
  weightError,
} from "./result";

const flat: ExamPaper = {
  examSubjectId: "es-1",
  examId: "exam-1",
  classId: "cls-1",
  className: "Class 7",
  subjectId: "sub-1",
  subjectName: "Bangla",
  subjectNameBn: null,
  subjectCode: "BAN",
  fullMarks: 100,
  passMarks: 33,
  componentMarks: {},
  componentPassMarks: {},
  isOptional: false,
  displayOrder: 0,
};

const split: ExamPaper = {
  ...flat,
  examSubjectId: "es-2",
  subjectName: "Physics",
  componentMarks: { cq: 75, practical: 25 },
  componentPassMarks: { practical: 10 },
};

const draft = (over: Partial<ReturnType<typeof emptyDraft>> = {}) => ({
  ...emptyDraft(),
  ...over,
});

describe("mark-entry rules (mirrored from the backend engine)", () => {
  it("knows which components a paper allocates", () => {
    expect(allocatedComponents(flat)).toEqual([]);
    expect(allocatedComponents(split)).toEqual(["cq", "practical"]);
  });

  describe("draftTotal", () => {
    it("uses the typed number on a flat paper", () => {
      expect(draftTotal(flat, draft({ total: "67" }))).toBe(67);
    });

    it("derives the total from the components on a split paper", () => {
      expect(draftTotal(split, draft({ cq: "60", practical: "20" }))).toBe(80);
    });

    it("is zero for an absent candidate", () => {
      expect(draftTotal(flat, draft({ total: "90", isAbsent: true }))).toBe(0);
    });
  });

  describe("draftError", () => {
    it("accepts a valid entry", () => {
      expect(draftError(flat, draft({ total: "67" }))).toBeNull();
      expect(
        draftError(split, draft({ cq: "70", practical: "20" })),
      ).toBeNull();
    });

    it("stays quiet on an untouched row", () => {
      // A blank cell is "not entered yet", not an error — the grid must
      // not be red before anyone has typed.
      expect(draftError(flat, draft())).toBeNull();
    });

    it("refuses a mark above the paper total", () => {
      expect(draftError(flat, draft({ total: "101" }))).toMatch(
        /exceeds the paper's 100 marks/,
      );
    });

    it("refuses a component above its own allocation", () => {
      // The bound the DB cannot see: 26 is under the paper's 100 but over
      // the practical's 25.
      expect(draftError(split, draft({ practical: "26" }))).toMatch(
        /exceeds its 25 marks/,
      );
    });

    it("refuses a component the paper does not allocate", () => {
      expect(draftError(split, draft({ mcq: "5" }))).toMatch(
        /allocates no MCQ marks/,
      );
    });

    it("refuses negative marks", () => {
      expect(draftError(flat, draft({ total: "-1" }))).toMatch(/0 or more/);
    });

    it("refuses marks alongside the absent flag", () => {
      expect(
        draftError(flat, draft({ total: "40", isAbsent: true })),
      ).toMatch(/cannot carry marks/);
    });

    it("accepts a clean absence", () => {
      expect(draftError(split, draft({ isAbsent: true }))).toBeNull();
    });
  });

  describe("isDraftFilled", () => {
    it("is false for an untouched row", () => {
      expect(isDraftFilled(flat, draft())).toBe(false);
      expect(isDraftFilled(split, draft())).toBe(false);
    });

    it("is true once any allocated component carries a value", () => {
      expect(isDraftFilled(split, draft({ cq: "10" }))).toBe(true);
    });

    it("is true for an absence", () => {
      expect(isDraftFilled(flat, draft({ isAbsent: true }))).toBe(true);
    });
  });

  describe("draftToInput", () => {
    it("sends only the flag for an absence", () => {
      expect(draftToInput(flat, "en-1", draft({ isAbsent: true }))).toEqual({
        enrollmentId: "en-1",
        isAbsent: true,
      });
    });

    it("sends the total for a flat paper", () => {
      expect(draftToInput(flat, "en-1", draft({ total: "67" }))).toEqual({
        enrollmentId: "en-1",
        total: 67,
      });
    });

    it("sends components — never a derived total — for a split paper", () => {
      expect(
        draftToInput(split, "en-1", draft({ cq: "60", practical: "20" })),
      ).toEqual({ enrollmentId: "en-1", cq: 60, practical: 20 });
    });

    it("sends null for a component left blank", () => {
      expect(draftToInput(split, "en-1", draft({ cq: "60" }))).toEqual({
        enrollmentId: "en-1",
        cq: 60,
        practical: null,
      });
    });
  });

  describe("draftFromRow", () => {
    const row = (over: Partial<MarkGridRow> = {}): MarkGridRow => ({
      enrollmentId: "en-1",
      studentId: "st-1",
      studentUid: "HXS-1",
      studentName: "Rahim Uddin",
      rollNo: 1,
      sectionId: "sec-1",
      sectionName: "A",
      markId: "mark-1",
      cq: null,
      mcq: null,
      practical: null,
      ca: null,
      total: 67,
      isAbsent: false,
      grade: "A-",
      gradePoint: 3.5,
      status: "DRAFT",
      remarks: null,
      ...over,
    });

    it("loads a stored mark", () => {
      expect(draftFromRow(row())).toMatchObject({
        total: "67",
        isAbsent: false,
      });
    });

    it("leaves an unmarked candidate blank rather than showing 0", () => {
      expect(draftFromRow(row({ markId: null, total: 0 })).total).toBe("");
    });

    it("shows no total for an absence", () => {
      expect(draftFromRow(row({ isAbsent: true, total: 0 })).total).toBe("");
    });
  });
});

describe("combined-result weights", () => {
  it("accepts a set summing to 100", () => {
    expect(weightError([30, 70])).toBeNull();
    expect(weightError([33.33, 33.33, 33.34])).toBeNull();
  });

  it("reports the deviation so the dialog can show it", () => {
    expect(weightError([30, 60])).toMatch(/sum to 90/);
    expect(weightError([])).toMatch(/at least one/i);
    expect(weightError([50, -50])).toMatch(/positive/i);
  });
});
