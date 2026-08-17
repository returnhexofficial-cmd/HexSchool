import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatDateLong } from "./date";

/**
 * Regression tests for QA finding F9 — the students list printed
 * `2014-01-01T00:00:00.000Z` in the Date of Birth column.
 */

const RAW_ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

describe("formatDate", () => {
  it("never returns a raw ISO timestamp", () => {
    expect(formatDate("2014-01-01T00:00:00.000Z")).not.toMatch(RAW_ISO);
  });

  it("formats a @db.Date value as DD/MM/YYYY", () => {
    expect(formatDate("2014-01-01T00:00:00.000Z")).toBe("01/01/2014");
  });

  it("keeps the calendar day when converting UTC midnight to Asia/Dhaka", () => {
    // Dhaka is UTC+6, so UTC midnight is 06:00 the *same* day. A date-only
    // field must not drift a day in either direction.
    expect(formatDate("2026-08-12T00:00:00.000Z")).toBe("12/08/2026");
  });

  it("uses Asia/Dhaka rather than the machine timezone for late-evening UTC", () => {
    // 20:00 UTC on the 11th is 02:00 on the 12th in Dhaka.
    expect(formatDate("2026-08-11T20:00:00.000Z")).toBe("12/08/2026");
  });

  it("renders an em dash for nullish and empty values", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("")).toBe("—");
  });

  it("renders the fallback rather than 'Invalid Date' for junk", () => {
    expect(formatDate("not-a-date")).toBe("—");
  });

  it("honours a caller-supplied fallback", () => {
    expect(formatDate(null, "Not set")).toBe("Not set");
  });

  it("accepts a Date instance as well as an ISO string", () => {
    expect(formatDate(new Date("2014-01-01T00:00:00.000Z"))).toBe("01/01/2014");
  });
});

describe("formatDateTime", () => {
  it("includes a time and no raw ISO", () => {
    const out = formatDateTime("2026-08-11T20:00:00.000Z");
    expect(out).not.toMatch(RAW_ISO);
    // 20:00 UTC → 02:00 Dhaka on the following day.
    expect(out).toContain("12/08/2026");
    expect(out).toMatch(/02:00/);
  });

  it("renders an em dash for nullish values", () => {
    expect(formatDateTime(null)).toBe("—");
  });
});

describe("formatDateLong", () => {
  it("renders a readable form", () => {
    expect(formatDateLong("2014-01-01T00:00:00.000Z")).toBe("1 Jan 2014");
  });

  it("renders an em dash for nullish values", () => {
    expect(formatDateLong(undefined)).toBe("—");
  });
});
