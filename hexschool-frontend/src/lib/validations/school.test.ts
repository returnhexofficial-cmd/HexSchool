import { describe, expect, it } from "vitest";
import { schoolProfileSchema } from "./school";

const valid = {
  name: "HexSchool Model High School",
  code: "HEX",
  type: "HIGH_SCHOOL" as const,
};

describe("schoolProfileSchema", () => {
  it("accepts a minimal valid profile", () => {
    expect(schoolProfileSchema.safeParse(valid).success).toBe(true);
  });

  it("enforces the 6-digit EIIN when provided (empty allowed)", () => {
    expect(
      schoolProfileSchema.safeParse({ ...valid, eiinNumber: "123456" }).success,
    ).toBe(true);
    expect(
      schoolProfileSchema.safeParse({ ...valid, eiinNumber: "" }).success,
    ).toBe(true);
    for (const bad of ["12345", "1234567", "12345a"]) {
      expect(
        schoolProfileSchema.safeParse({ ...valid, eiinNumber: bad }).success,
      ).toBe(false);
    }
  });

  it("rejects lowercase/too-long short codes", () => {
    for (const bad of ["hex", "H", "TOOLONGCODE1"]) {
      expect(
        schoolProfileSchema.safeParse({ ...valid, code: bad }).success,
      ).toBe(false);
    }
  });

  it("website requires a protocol; established year is bounded", () => {
    expect(
      schoolProfileSchema.safeParse({ ...valid, website: "school.edu.bd" })
        .success,
    ).toBe(false);
    expect(
      schoolProfileSchema.safeParse({
        ...valid,
        website: "https://school.edu.bd",
      }).success,
    ).toBe(true);
    expect(
      schoolProfileSchema.safeParse({ ...valid, establishedYear: 1700 })
        .success,
    ).toBe(false);
  });
});
