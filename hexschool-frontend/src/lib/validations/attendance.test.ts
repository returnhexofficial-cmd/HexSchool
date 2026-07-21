import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_STATUS_CODES,
  convertHolidaySchema,
  dhakaMonth,
  dhakaToday,
  markAttendanceSchema,
  studentLeaveSchema,
} from "./attendance";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("markAttendanceSchema", () => {
  const valid = {
    sectionId: uuid,
    date: "2026-07-21",
    entries: [{ enrollmentId: uuid, status: "PRESENT" as const }],
  };

  it("accepts a well-formed sheet", () => {
    expect(markAttendanceSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a non ISO date", () => {
    const result = markAttendanceSchema.safeParse({
      ...valid,
      date: "21-07-2026",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty entry list", () => {
    expect(
      markAttendanceSchema.safeParse({ ...valid, entries: [] }).success,
    ).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(
      markAttendanceSchema.safeParse({
        ...valid,
        entries: [{ enrollmentId: uuid, status: "SICK" }],
      }).success,
    ).toBe(false);
  });
});

describe("studentLeaveSchema", () => {
  const valid = {
    studentId: uuid,
    fromDate: "2026-07-20",
    toDate: "2026-07-22",
    reason: "Fever",
  };

  it("accepts a valid range", () => {
    expect(studentLeaveSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an inverted range on the toDate field", () => {
    const result = studentLeaveSchema.safeParse({
      ...valid,
      fromDate: "2026-07-22",
      toDate: "2026-07-20",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["toDate"]);
    }
  });

  it("accepts a single-day leave", () => {
    expect(
      studentLeaveSchema.safeParse({
        ...valid,
        fromDate: "2026-07-20",
        toDate: "2026-07-20",
      }).success,
    ).toBe(true);
  });

  it("requires a meaningful reason", () => {
    expect(studentLeaveSchema.safeParse({ ...valid, reason: "x" }).success).toBe(
      false,
    );
  });
});

describe("convertHolidaySchema", () => {
  it("requires a reason for the audit trail", () => {
    expect(
      convertHolidaySchema.safeParse({ date: "2026-07-21" }).success,
    ).toBe(false);
    expect(
      convertHolidaySchema.safeParse({
        date: "2026-07-21",
        reason: "Government holiday declared late",
      }).success,
    ).toBe(true);
  });
});

describe("Dhaka date helpers", () => {
  it("rolls the day over at 18:00 UTC", () => {
    expect(dhakaToday(new Date("2026-07-20T17:59:00Z"))).toBe("2026-07-20");
    expect(dhakaToday(new Date("2026-07-20T18:00:00Z"))).toBe("2026-07-21");
  });

  it("derives the month from the local day", () => {
    expect(dhakaMonth(new Date("2026-07-31T18:00:00Z"))).toBe("2026-08");
  });
});

describe("register codes", () => {
  it("maps every status to a single printable code", () => {
    expect(ATTENDANCE_STATUS_CODES.PRESENT).toBe("P");
    expect(ATTENDANCE_STATUS_CODES.ABSENT).toBe("A");
    expect(ATTENDANCE_STATUS_CODES.HALF_DAY).toBe("H");
  });
});
