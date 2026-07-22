import { describe, expect, it } from "vitest";
import type { ExamClash } from "@/lib/api/exam";
import {
  addMinutes,
  componentTotal,
  DistributionInput,
  examSchema,
  examTypeSchema,
  generateSeatPlanSchema,
  indexClashes,
  isScheduled,
  isSplit,
  scheduleError,
  shiftDaySchema,
  splitClashes,
  timeOf,
  usedComponents,
  validateDistribution,
} from "./exam";

describe("exam validations (mirror of the M14 backend DTOs)", () => {
  describe("examTypeSchema", () => {
    it("accepts a name with no weight", () => {
      expect(examTypeSchema.safeParse({ name: "Half Yearly" }).success).toBe(
        true,
      );
    });

    it("rejects an empty name", () => {
      expect(examTypeSchema.safeParse({ name: "" }).success).toBe(false);
    });

    it("rejects a weight outside 0–100", () => {
      expect(
        examTypeSchema.safeParse({ name: "Annual", weight: 120 }).success,
      ).toBe(false);
      expect(
        examTypeSchema.safeParse({ name: "Annual", weight: -1 }).success,
      ).toBe(false);
    });
  });

  describe("examSchema", () => {
    const base = {
      examTypeId: "11111111-1111-4111-8111-111111111111",
      name: "Half Yearly 2026",
      startDate: "2026-06-01",
      endDate: "2026-06-15",
    };

    it("accepts a valid window", () => {
      expect(examSchema.safeParse(base).success).toBe(true);
    });

    it("accepts a single-day exam", () => {
      expect(
        examSchema.safeParse({ ...base, endDate: "2026-06-01" }).success,
      ).toBe(true);
    });

    it("rejects an inverted window on the endDate field", () => {
      const result = examSchema.safeParse({
        ...base,
        startDate: "2026-06-15",
        endDate: "2026-06-01",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(["endDate"]);
      }
    });

    it("rejects a malformed date", () => {
      expect(
        examSchema.safeParse({ ...base, startDate: "01/06/2026" }).success,
      ).toBe(false);
    });
  });

  describe("shiftDaySchema", () => {
    it("rejects moving a day onto itself", () => {
      const result = shiftDaySchema.safeParse({
        fromDate: "2026-06-02",
        toDate: "2026-06-02",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(["toDate"]);
      }
    });

    it("accepts a real postponement", () => {
      expect(
        shiftDaySchema.safeParse({
          fromDate: "2026-06-02",
          toDate: "2026-06-09",
          extendExamWindow: true,
        }).success,
      ).toBe(true);
    });
  });

  describe("generateSeatPlanSchema", () => {
    it("requires at least one room", () => {
      expect(
        generateSeatPlanSchema.safeParse({ date: "2026-06-02", rooms: [] })
          .success,
      ).toBe(false);
    });

    it("rejects duplicate room names case-insensitively", () => {
      const result = generateSeatPlanSchema.safeParse({
        date: "2026-06-02",
        rooms: [
          { room: "H1", capacity: 30 },
          { room: " h1 ", capacity: 30 },
        ],
      });
      expect(result.success).toBe(false);
    });

    it("rejects a zero capacity", () => {
      expect(
        generateSeatPlanSchema.safeParse({
          date: "2026-06-02",
          rooms: [{ room: "H1", capacity: 0 }],
        }).success,
      ).toBe(false);
    });

    it("accepts a valid multi-room plan", () => {
      expect(
        generateSeatPlanSchema.safeParse({
          date: "2026-06-02",
          rooms: [
            { room: "H1", capacity: 30 },
            { room: "H2", capacity: 25 },
          ],
          strategy: "INTERLEAVE",
        }).success,
      ).toBe(true);
    });
  });

  describe("mark distribution", () => {
    const flat = (over: Partial<DistributionInput> = {}): DistributionInput => ({
      fullMarks: 100,
      passMarks: 33,
      ...over,
    });

    it("accepts a flat paper", () => {
      expect(validateDistribution(flat())).toEqual([]);
      expect(isSplit(flat())).toBe(false);
    });

    it("rejects pass marks above full marks", () => {
      expect(validateDistribution(flat({ passMarks: 120 }))).toHaveLength(1);
    });

    it("accepts components that add up", () => {
      const d = flat({ cqMarks: 70, mcqMarks: 30 });
      expect(validateDistribution(d)).toEqual([]);
      expect(componentTotal(d)).toBe(100);
      expect(usedComponents(d)).toEqual(["cq", "mcq"]);
    });

    it("rejects components that do not add up, naming both totals", () => {
      const errors = validateDistribution(flat({ cqMarks: 60, mcqMarks: 30 }));
      expect(errors[0]).toContain("90");
      expect(errors[0]).toContain("100");
    });

    it("treats a zero-mark component as present", () => {
      expect(isSplit(flat({ cqMarks: 100, mcqMarks: 0 }))).toBe(true);
      expect(validateDistribution(flat({ cqMarks: 100, mcqMarks: 0 }))).toEqual(
        [],
      );
    });

    it("rejects a component pass mark with no component", () => {
      expect(
        validateDistribution(flat({ practicalPassMarks: 10 })),
      ).toHaveLength(1);
    });

    it("rejects a component pass mark above its component", () => {
      const errors = validateDistribution(
        flat({ cqMarks: 75, practicalMarks: 25, practicalPassMarks: 30 }),
      );
      expect(errors[0]).toContain("cannot exceed its 25 marks");
    });

    it("accepts a practical that must be passed separately", () => {
      expect(
        validateDistribution(
          flat({ cqMarks: 75, practicalMarks: 25, practicalPassMarks: 10 }),
        ),
      ).toEqual([]);
    });
  });

  describe("sitting schedule is all-or-nothing", () => {
    it("accepts nothing at all", () => {
      expect(scheduleError({})).toBeNull();
    });

    it("accepts all three together", () => {
      expect(
        scheduleError({
          examDate: "2026-06-02",
          startTime: "10:00",
          durationMin: 180,
        }),
      ).toBeNull();
    });

    it("rejects a partial schedule", () => {
      expect(scheduleError({ examDate: "2026-06-02" })).toContain("together");
      expect(
        scheduleError({ examDate: "2026-06-02", startTime: "10:00" }),
      ).toContain("together");
    });

    it("reads a paper's scheduled-ness", () => {
      expect(
        isScheduled({
          examDate: "2026-06-02",
          startTime: "1970-01-01T10:00:00.000Z",
          durationMin: 180,
        }),
      ).toBe(true);
      expect(
        isScheduled({ examDate: null, startTime: null, durationMin: null }),
      ).toBe(false);
    });
  });

  describe("time helpers", () => {
    it("extracts HH:mm from a TIME column value", () => {
      expect(timeOf("1970-01-01T10:30:00.000Z")).toBe("10:30");
      expect(timeOf(null)).toBe("");
    });

    it("adds a duration to a start time", () => {
      expect(addMinutes("10:00", 180)).toBe("13:00");
      expect(addMinutes("22:30", 120)).toBe("00:30");
      expect(addMinutes("bad", 30)).toBe("");
    });
  });

  describe("clash grouping and override tiers", () => {
    const clash = (over: Partial<ExamClash> = {}): ExamClash => ({
      kind: "ROOM",
      examSubjectId: "es-1",
      date: "2026-06-02",
      classId: "cls-9",
      subjectId: "bangla",
      message: "clash",
      ...over,
    });

    it("groups clashes by the paper they belong to", () => {
      const map = indexClashes([
        clash(),
        clash({ kind: "CLASS_SAME_DAY" }),
        clash({ examSubjectId: "es-2" }),
      ]);
      expect(map.get("es-1")).toHaveLength(2);
      expect(map.get("es-2")).toHaveLength(1);
    });

    it("keys an unsaved paper by class+subject", () => {
      const map = indexClashes([clash({ examSubjectId: null })]);
      expect(map.get("cls-9|bangla")).toHaveLength(1);
    });

    it("marks only the same-day policy as waivable", () => {
      const { structural, waivable } = splitClashes([
        clash({ kind: "ROOM" }),
        clash({ kind: "CLASS_OVERLAP" }),
        clash({ kind: "OUTSIDE_WINDOW" }),
        clash({ kind: "CLASS_SAME_DAY" }),
      ]);
      expect(waivable.map((c) => c.kind)).toEqual(["CLASS_SAME_DAY"]);
      expect(structural).toHaveLength(3);
    });
  });
});
