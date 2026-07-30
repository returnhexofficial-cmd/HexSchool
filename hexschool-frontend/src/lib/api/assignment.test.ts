import { describe, expect, it } from "vitest";
import {
  ASSIGNMENT_STATUSES,
  ASSIGNMENT_STATUS_LABELS,
  dueRelative,
  formatDue,
  humanBytes,
  isoToLocal,
  LINK_MATERIAL_TYPES,
  localToIso,
  MATERIAL_TYPES,
  MATERIAL_TYPE_LABELS,
  SUBMISSION_STATUS_LABELS,
} from "./assignment";

describe("label maps", () => {
  it("labels every lifecycle status", () => {
    for (const status of ASSIGNMENT_STATUSES) {
      expect(ASSIGNMENT_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it("labels every material type", () => {
    for (const type of MATERIAL_TYPES) {
      expect(MATERIAL_TYPE_LABELS[type]).toBeTruthy();
    }
  });

  it("labels every submission status", () => {
    for (const status of [
      "SUBMITTED",
      "RESUBMITTED",
      "EVALUATED",
      "RETURNED",
    ] as const) {
      expect(SUBMISSION_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it("keeps the lifecycle in order, so the status strip cannot drift", () => {
    expect(ASSIGNMENT_STATUSES).toEqual(["DRAFT", "PUBLISHED", "CLOSED"]);
  });

  it("marks exactly the URL-bearing material types", () => {
    expect(LINK_MATERIAL_TYPES).toEqual(["VIDEO_URL", "LINK"]);
  });
});

describe("formatDue", () => {
  it("renders in Asia/Dhaka regardless of the runner's zone", () => {
    // 2026-07-30T12:00Z is 18:00 in Dhaka (UTC+6, no DST).
    const label = formatDue("2026-07-30T12:00:00.000Z");
    expect(label).toContain("30 Jul");
    expect(label).toMatch(/6:00\s*pm/i);
  });

  it("rolls the date over when Dhaka is already the next day", () => {
    // 2026-07-30T19:00Z is 01:00 on the 31st in Dhaka.
    expect(formatDue("2026-07-30T19:00:00.000Z")).toContain("31 Jul");
  });
});

describe("dueRelative", () => {
  const now = Date.UTC(2026, 6, 30, 12, 0, 0);

  it("counts forward in days", () => {
    expect(dueRelative("2026-08-02T12:00:00.000Z", now)).toMatch(/3 days/);
  });

  it("counts forward in hours inside a day", () => {
    expect(dueRelative("2026-07-30T18:00:00.000Z", now)).toMatch(/6 hours/);
  });

  it("counts forward in minutes inside an hour", () => {
    expect(dueRelative("2026-07-30T12:30:00.000Z", now)).toMatch(/30 minutes/);
  });

  it("reads as the past once overdue", () => {
    expect(dueRelative("2026-07-29T12:00:00.000Z", now)).toMatch(/ago|yesterday/i);
  });
});

describe("humanBytes", () => {
  it("scales the unit", () => {
    expect(humanBytes(512)).toBe("512 B");
    expect(humanBytes(2048)).toBe("2 KB");
    expect(humanBytes(10 * 1024 * 1024)).toBe("10 MB");
  });
});

describe("localToIso / isoToLocal", () => {
  it("round-trips a datetime-local value", () => {
    const local = "2026-07-30T18:00";
    expect(isoToLocal(localToIso(local))).toBe(local);
  });

  it("drops seconds, which a datetime-local input has no field for", () => {
    const iso = "2026-07-30T18:00:45.000Z";
    expect(isoToLocal(iso)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});
