import { describe, expect, it } from "vitest";
import type { RoutineCell, RoutineConflict } from "@/lib/api/timetable";
import {
  cellKey,
  coverage,
  createTimetableSchema,
  describeCell,
  indexCells,
  indexConflicts,
  isTeachable,
  minutesOf,
  periodSlotSchema,
} from "./timetable";

const uuid = "11111111-1111-4111-8111-111111111111";
const otherUuid = "22222222-2222-4222-8222-222222222222";

describe("periodSlotSchema", () => {
  const valid = {
    shiftId: uuid,
    name: "Period 1",
    startTime: "08:00",
    endTime: "08:45",
    type: "CLASS" as const,
  };

  it("accepts a well-formed slot", () => {
    expect(periodSlotSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a 12-hour or malformed time", () => {
    expect(
      periodSlotSchema.safeParse({ ...valid, startTime: "8:00 AM" }).success,
    ).toBe(false);
    expect(
      periodSlotSchema.safeParse({ ...valid, endTime: "24:00" }).success,
    ).toBe(false);
  });

  it("rejects an inverted range on the endTime field", () => {
    const result = periodSlotSchema.safeParse({
      ...valid,
      startTime: "10:00",
      endTime: "09:00",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["endTime"]);
    }
  });

  it("rejects a zero-length slot", () => {
    expect(
      periodSlotSchema.safeParse({ ...valid, endTime: "08:00" }).success,
    ).toBe(false);
  });

  it("rejects an unknown slot type", () => {
    expect(
      periodSlotSchema.safeParse({ ...valid, type: "LUNCH" }).success,
    ).toBe(false);
  });
});

describe("createTimetableSchema", () => {
  it("accepts just a section", () => {
    expect(createTimetableSchema.safeParse({ sectionId: uuid }).success).toBe(
      true,
    );
  });

  it("rejects a non-ISO effective date", () => {
    expect(
      createTimetableSchema.safeParse({
        sectionId: uuid,
        effectiveFrom: "01-03-2026",
      }).success,
    ).toBe(false);
  });
});

describe("minutesOf", () => {
  it("converts HH:mm to minutes since midnight", () => {
    expect(minutesOf("00:00")).toBe(0);
    expect(minutesOf("08:45")).toBe(525);
    expect(minutesOf("23:59")).toBe(1439);
  });

  it("returns -1 for anything malformed", () => {
    expect(minutesOf("nonsense")).toBe(-1);
    expect(minutesOf("25:00")).toBe(-1);
  });
});

describe("grid indexing", () => {
  it("keys cells by day and period so the grid renders in one pass", () => {
    const cells = [
      { day: "SAT" as const, periodSlotId: "p1", label: "a" },
      { day: "SUN" as const, periodSlotId: "p1", label: "b" },
    ];
    const index = indexCells(cells);
    expect(index.get(cellKey("SAT", "p1"))?.label).toBe("a");
    expect(index.get(cellKey("SUN", "p1"))?.label).toBe("b");
    expect(index.get(cellKey("MON", "p1"))).toBeUndefined();
  });

  it("groups EVERY conflict of a cell, not just the first", () => {
    const conflicts = [
      { kind: "TEACHER", day: "SAT", slotId: "p1", sectionId: uuid, message: "busy" },
      { kind: "ROOM", day: "SAT", slotId: "p1", sectionId: uuid, message: "taken" },
      { kind: "TEACHER", day: "SUN", slotId: "p1", sectionId: uuid, message: "busy" },
    ] as RoutineConflict[];
    const index = indexConflicts(conflicts);
    expect(index.get(cellKey("SAT", "p1"))).toHaveLength(2);
    expect(index.get(cellKey("SUN", "p1"))).toHaveLength(1);
  });
});

describe("isTeachable", () => {
  it("only allows lessons in CLASS slots", () => {
    expect(isTeachable("CLASS")).toBe(true);
    expect(isTeachable("BREAK")).toBe(false);
    expect(isTeachable("ASSEMBLY")).toBe(false);
  });
});

describe("coverage", () => {
  const slots = [
    { id: "p1", type: "CLASS" as const },
    { id: "tiffin", type: "BREAK" as const },
    { id: "p2", type: "CLASS" as const },
  ];

  it("counts capacity from CLASS slots only", () => {
    const result = coverage([], slots, ["SAT", "SUN"]);
    expect(result.capacity).toBe(4);
    expect(result.percent).toBe(0);
  });

  it("reports a filled grid as 100%", () => {
    const cells = [
      { day: "SAT" as const, periodSlotId: "p1" },
      { day: "SAT" as const, periodSlotId: "p2" },
      { day: "SUN" as const, periodSlotId: "p1" },
      { day: "SUN" as const, periodSlotId: "p2" },
    ];
    expect(coverage(cells, slots, ["SAT", "SUN"]).percent).toBe(100);
  });

  it("does not divide by zero when no class slots exist", () => {
    const result = coverage([], [{ id: "b", type: "BREAK" }], ["SAT"]);
    expect(result.capacity).toBe(0);
    expect(result.percent).toBe(0);
  });
});

describe("describeCell", () => {
  const base: RoutineCell = {
    entryId: "e1",
    day: "SAT",
    periodSlotId: "p1",
    subject: { id: uuid, name: "Mathematics", code: "MATH" },
    teacher: { id: otherUuid, name: "Mr X", employeeId: "T-01" },
    roomNo: null,
    combinedWith: null,
  };

  it("summarises subject and teacher", () => {
    expect(describeCell(base)).toBe("Mathematics · Mr X");
  });

  it("appends the room when there is one", () => {
    expect(describeCell({ ...base, roomNo: "101" })).toContain("Room 101");
  });

  it("prefers the combined-class label over the room", () => {
    const combined = describeCell({
      ...base,
      roomNo: "101",
      combinedWith: { id: otherUuid, label: "Class 7 — B" },
    });
    expect(combined).toContain("with Class 7 — B");
    expect(combined).not.toContain("Room");
  });
});
