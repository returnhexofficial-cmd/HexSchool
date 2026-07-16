import { describe, expect, it } from "vitest";
import {
  classSchema,
  departmentSchema,
  groupSchema,
  sectionSchema,
  shiftSchema,
  subjectSchema,
} from "./structure";

describe("structure schemas", () => {
  it("shift end must be after start; HH:MM enforced", () => {
    expect(
      shiftSchema.safeParse({ name: "Morning", startTime: "07:30", endTime: "12:00" })
        .success,
    ).toBe(true);
    expect(
      shiftSchema.safeParse({ name: "Bad", startTime: "13:00", endTime: "08:00" })
        .success,
    ).toBe(false);
    expect(
      shiftSchema.safeParse({ name: "Bad", startTime: "25:00", endTime: "26:00" })
        .success,
    ).toBe(false);
  });

  it("subject code must be uppercase alphanumeric", () => {
    expect(
      subjectSchema.safeParse({ name: "Physics", code: "PHY", type: "THEORY" })
        .success,
    ).toBe(true);
    for (const code of ["phy", "P", "PHY-1"]) {
      expect(
        subjectSchema.safeParse({ name: "Physics", code, type: "THEORY" })
          .success,
      ).toBe(false);
    }
  });

  it("class level is 0–20 (string form)", () => {
    expect(
      classSchema.safeParse({ name: "Class 6", numericLevel: "6" }).success,
    ).toBe(true);
    expect(
      classSchema.safeParse({ name: "Class X", numericLevel: "21" }).success,
    ).toBe(false);
    expect(
      classSchema.safeParse({ name: "Class X", numericLevel: "six" }).success,
    ).toBe(false);
  });

  it("section name is at most 5 chars", () => {
    expect(sectionSchema.safeParse({ name: "A" }).success).toBe(true);
    expect(sectionSchema.safeParse({ name: "ABCDEF" }).success).toBe(false);
    expect(sectionSchema.safeParse({ name: "A B" }).success).toBe(false);
  });

  it("department code allows hyphens; group level bounded", () => {
    expect(
      departmentSchema.safeParse({ name: "Science", code: "SCI-1" }).success,
    ).toBe(true);
    expect(
      groupSchema.safeParse({ name: "Science", applicableFromLevel: "9" })
        .success,
    ).toBe(true);
    expect(
      groupSchema.safeParse({ name: "Science", applicableFromLevel: "99" })
        .success,
    ).toBe(false);
  });
});
