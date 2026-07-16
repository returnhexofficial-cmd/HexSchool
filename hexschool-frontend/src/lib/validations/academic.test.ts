import { describe, expect, it } from "vitest";
import {
  calendarEventSchema,
  holidaySchema,
  sessionSchema,
} from "./academic";

describe("sessionSchema", () => {
  it("accepts a valid session and rejects end <= start", () => {
    expect(
      sessionSchema.safeParse({
        name: "2026",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
      }).success,
    ).toBe(true);
    expect(
      sessionSchema.safeParse({
        name: "2026",
        startDate: "2026-12-31",
        endDate: "2026-01-01",
      }).success,
    ).toBe(false);
  });

  it("rejects impossible calendar dates that pass the shape regex", () => {
    expect(
      sessionSchema.safeParse({
        name: "2026",
        startDate: "2026-13-01",
        endDate: "2026-12-31",
      }).success,
    ).toBe(false);
    expect(
      sessionSchema.safeParse({
        name: "2026",
        startDate: "2026-02-30",
        endDate: "2026-12-31",
      }).success,
    ).toBe(false);
  });
});

describe("holidaySchema / calendarEventSchema", () => {
  it("single-day holiday is valid (end == start)", () => {
    expect(
      holidaySchema.safeParse({
        title: "Victory Day",
        startDate: "2026-12-16",
        endDate: "2026-12-16",
        type: "GOVERNMENT",
        appliesTo: "ALL",
      }).success,
    ).toBe(true);
  });

  it("event end before start is rejected", () => {
    expect(
      calendarEventSchema.safeParse({
        title: "Sports Day",
        startDate: "2026-05-10",
        endDate: "2026-05-09",
        type: "SPORTS",
        isPublic: false,
      }).success,
    ).toBe(false);
  });
});
