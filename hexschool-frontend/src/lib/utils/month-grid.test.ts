import { describe, expect, it } from "vitest";
import {
  buildMonthGrid,
  currentMonth,
  inRange,
  monthInfo,
  monthWithinSession,
} from "./month-grid";

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

/**
 * Regression tests for QA finding F11 — the calendar opened on today's month
 * whatever session was selected, so choosing a past session showed "Nothing
 * scheduled this month" for a month that session could not cover.
 */
describe("monthWithinSession", () => {
  const session = (startDate: string, endDate: string) => ({
    startDate,
    endDate,
  });
  const on = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

  it("uses today's month when today falls inside the session", () => {
    expect(
      monthWithinSession(session("2026-01-01", "2026-12-31"), on("2026-08-12")),
    ).toBe("2026-08");
  });

  it("falls back to the session's first month for a past session", () => {
    // The actual bug: session 2025, today in 2026 → used to return "2026-08".
    expect(
      monthWithinSession(session("2025-01-01", "2025-12-31"), on("2026-08-12")),
    ).toBe("2025-01");
  });

  it("falls back to the session's first month for a future session", () => {
    expect(
      monthWithinSession(session("2027-01-01", "2027-12-31"), on("2026-08-12")),
    ).toBe("2027-01");
  });

  it("is inclusive of the session's first and last months", () => {
    const s = session("2026-01-01", "2026-12-31");
    expect(monthWithinSession(s, on("2026-01-15"))).toBe("2026-01");
    expect(monthWithinSession(s, on("2026-12-31"))).toBe("2026-12");
  });

  it("tolerates ISO datetimes on the session bounds", () => {
    expect(
      monthWithinSession(
        session("2025-01-01T00:00:00.000Z", "2025-12-31T00:00:00.000Z"),
        on("2026-08-12"),
      ),
    ).toBe("2025-01");
  });

  it("falls back to today's month when no session is selected yet", () => {
    // The session arrives asynchronously; the calendar must render meanwhile.
    expect(monthWithinSession(null, on("2026-08-12"))).toBe("2026-08");
    expect(monthWithinSession(undefined, on("2026-08-12"))).toBe("2026-08");
  });
});

describe("currentMonth", () => {
  it("formats as YYYY-MM in UTC", () => {
    expect(currentMonth(new Date("2026-08-12T23:30:00.000Z"))).toBe("2026-08");
  });
});
