import { describe, expect, it } from "vitest";
import { buildMonthGrid, inRange, monthInfo } from "./month-grid";

describe("buildMonthGrid", () => {
  it("covers February 2026 in full Sunday-first weeks", () => {
    const weeks = buildMonthGrid(2026, 2);
    // Feb 2026: Feb 1 is a Sunday, 28 days → exactly 4 weeks.
    expect(weeks).toHaveLength(4);
    expect(weeks[0][0]).toMatchObject({
      iso: "2026-02-01",
      weekday: "SUNDAY",
      inMonth: true,
    });
    expect(weeks[3][6]).toMatchObject({ iso: "2026-02-28", inMonth: true });
  });

  it("pads leading/trailing out-of-month days", () => {
    const weeks = buildMonthGrid(2026, 7); // Jul 1 2026 is a Wednesday
    expect(weeks[0][0]).toMatchObject({ iso: "2026-06-28", inMonth: false });
    expect(weeks[0][3]).toMatchObject({ iso: "2026-07-01", inMonth: true });
    const lastWeek = weeks[weeks.length - 1];
    expect(lastWeek.some((d) => d.iso === "2026-07-31")).toBe(true);
  });

  it("every week has exactly 7 days", () => {
    for (const [y, m] of [
      [2026, 1],
      [2026, 12],
      [2028, 2],
    ]) {
      for (const week of buildMonthGrid(y, m)) {
        expect(week).toHaveLength(7);
      }
    }
  });
});

describe("inRange", () => {
  it("is inclusive of both ends and tolerates ISO datetimes", () => {
    expect(inRange("2026-03-20", "2026-03-20T00:00:00.000Z", "2026-03-22")).toBe(
      true,
    );
    expect(inRange("2026-03-22", "2026-03-20", "2026-03-22")).toBe(true);
    expect(inRange("2026-03-23", "2026-03-20", "2026-03-22")).toBe(false);
  });
});

describe("monthInfo", () => {
  it("labels and navigates across year boundaries", () => {
    expect(monthInfo("2026-01")).toEqual({
      label: "January 2026",
      prev: "2025-12",
      next: "2026-02",
    });
    expect(monthInfo("2026-12").next).toBe("2027-01");
  });
});
