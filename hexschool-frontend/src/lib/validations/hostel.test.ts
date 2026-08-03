import { describe, expect, it } from "vitest";
import {
  allocationSchema,
  bedSchema,
  deductionSchema,
  hostelSchema,
  mealOffSchema,
  messPlanSchema,
  refundSchema,
  roomSchema,
  transferSchema,
  vacateSchema,
} from "./hostel";

const uuid = "11111111-1111-4111-8111-111111111111";
const uuid2 = "22222222-2222-4222-8222-222222222222";

describe("hostelSchema", () => {
  it("accepts a minimal hostel", () => {
    expect(
      hostelSchema.safeParse({ name: "Shapla Hostel", type: "BOYS" }).success,
    ).toBe(true);
  });

  it("insists on a type — the gender check has no meaning without one", () => {
    expect(hostelSchema.safeParse({ name: "Shapla Hostel" }).success).toBe(
      false,
    );
  });

  it("refuses a type that is neither building", () => {
    expect(
      hostelSchema.safeParse({ name: "Staff quarters", type: "MIXED" }).success,
    ).toBe(false);
  });

  it("refuses a name too short to pick out of a list", () => {
    expect(hostelSchema.safeParse({ name: "S", type: "BOYS" }).success).toBe(
      false,
    );
  });

  it("refuses a phone that is not a BD mobile", () => {
    expect(
      hostelSchema.safeParse({
        name: "Shapla",
        type: "BOYS",
        phone: "12345",
      }).success,
    ).toBe(false);
  });

  it("treats an empty phone as absent rather than invalid", () => {
    expect(
      hostelSchema.safeParse({ name: "Shapla", type: "BOYS", phone: "" })
        .success,
    ).toBe(true);
  });
});

describe("roomSchema", () => {
  const base = { roomNo: "A-101", bedCount: 4, monthlyFee: 3100 };

  it("accepts a room", () => {
    expect(roomSchema.safeParse(base).success).toBe(true);
  });

  it("refuses a room with no beds", () => {
    expect(roomSchema.safeParse({ ...base, bedCount: 0 }).success).toBe(false);
  });

  it("refuses a bed count that is obviously a typo", () => {
    expect(roomSchema.safeParse({ ...base, bedCount: 500 }).success).toBe(
      false,
    );
  });

  it("refuses a negative rent — that would pay a family to live here", () => {
    expect(roomSchema.safeParse({ ...base, monthlyFee: -1 }).success).toBe(
      false,
    );
  });

  it("refuses a rent with more than two decimals", () => {
    expect(roomSchema.safeParse({ ...base, monthlyFee: 3100.555 }).success).toBe(
      false,
    );
  });

  it("allows a basement floor", () => {
    expect(roomSchema.safeParse({ ...base, floor: -1 }).success).toBe(true);
  });
});

describe("bedSchema", () => {
  it("needs a bed number", () => {
    expect(bedSchema.safeParse({ bedNo: "" }).success).toBe(false);
    expect(bedSchema.safeParse({ bedNo: "B3" }).success).toBe(true);
  });
});

describe("allocationSchema", () => {
  it("accepts an allocation", () => {
    expect(
      allocationSchema.safeParse({ enrollmentId: uuid, bedId: uuid2 }).success,
    ).toBe(true);
  });

  it("refuses a student id that is not an id", () => {
    expect(
      allocationSchema.safeParse({ enrollmentId: "abc", bedId: uuid2 }).success,
    ).toBe(false);
  });

  it("refuses a malformed start date rather than sending it on", () => {
    expect(
      allocationSchema.safeParse({
        enrollmentId: uuid,
        bedId: uuid2,
        startDate: "01/03/2026",
      }).success,
    ).toBe(false);
  });
});

describe("transferSchema and vacateSchema", () => {
  it("both insist on a reason — these are decisions with names on them", () => {
    expect(transferSchema.safeParse({ bedId: uuid, reason: "" }).success).toBe(
      false,
    );
    expect(vacateSchema.safeParse({ reason: "ok" }).success).toBe(false);
    expect(
      vacateSchema.safeParse({ reason: "Family moved to Chittagong" }).success,
    ).toBe(true);
  });
});

describe("deductionSchema and refundSchema", () => {
  it("insists a deduction says what it is for", () => {
    expect(deductionSchema.safeParse({ amount: 500, reason: "" }).success).toBe(
      false,
    );
    expect(
      deductionSchema.safeParse({ amount: 500, reason: "Broken window pane" })
        .success,
    ).toBe(true);
  });

  it("refuses a negative deduction — that would be a top-up", () => {
    expect(
      deductionSchema.safeParse({ amount: -100, reason: "Goodwill" }).success,
    ).toBe(false);
  });

  it("accepts a refund with no deductions at all", () => {
    expect(refundSchema.safeParse({}).success).toBe(true);
  });

  it("caps the number of deduction lines", () => {
    expect(
      refundSchema.safeParse({
        deductions: Array.from({ length: 21 }, () => ({
          amount: 1,
          reason: "Wear and tear",
        })),
      }).success,
    ).toBe(false);
  });
});

describe("messPlanSchema", () => {
  it("needs a hostel — a plan belongs to one building", () => {
    expect(
      messPlanSchema.safeParse({ name: "Full board", monthlyCharge: 3100 })
        .success,
    ).toBe(false);
    expect(
      messPlanSchema.safeParse({
        hostelId: uuid,
        name: "Full board",
        monthlyCharge: 3100,
      }).success,
    ).toBe(true);
  });

  it("allows a zero charge — a school may include food in the rent", () => {
    expect(
      messPlanSchema.safeParse({
        hostelId: uuid,
        name: "Included",
        monthlyCharge: 0,
      }).success,
    ).toBe(true);
  });
});

describe("mealOffSchema", () => {
  const base = {
    allocationId: uuid,
    fromDate: "2026-03-10",
    toDate: "2026-03-14",
    reason: "Going home for Eid",
  };

  it("accepts a well-formed request", () => {
    expect(mealOffSchema.safeParse(base).success).toBe(true);
  });

  it("refuses a range that runs backwards, and says which field", () => {
    const result = mealOffSchema.safeParse({
      ...base,
      fromDate: "2026-03-14",
      toDate: "2026-03-10",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["toDate"]);
    }
  });

  it("accepts a single day — the MINIMUM is a school setting, not a form rule", () => {
    // Duplicating `hostel.meal_off_min_days` here would mean a school
    // that lowered it still saw the old refusal in the browser.
    expect(
      mealOffSchema.safeParse({
        ...base,
        fromDate: "2026-03-10",
        toDate: "2026-03-10",
      }).success,
    ).toBe(true);
  });

  it("insists on a reason", () => {
    expect(mealOffSchema.safeParse({ ...base, reason: "x" }).success).toBe(
      false,
    );
  });

  it("refuses dates that are not dates", () => {
    expect(
      mealOffSchema.safeParse({ ...base, fromDate: "10-03-2026" }).success,
    ).toBe(false);
  });
});
