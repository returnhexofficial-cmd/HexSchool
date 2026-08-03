import { describe, expect, it } from "vitest";
import {
  ALLOCATION_STATUS_LABELS,
  ALLOCATION_STATUS_VARIANT,
  BED_STATE_CLASS,
  BED_STATE_LABELS,
  HOSTEL_STATUSES,
  HOSTEL_TYPE_LABELS,
  HOSTEL_TYPES,
  MEAL_OFF_STATUS_LABELS,
  MEAL_OFF_VARIANT,
  ROOM_TYPE_LABELS,
  ROOM_TYPES,
  formatBdt,
  type AllocationStatus,
  type BedState,
  type MealOffStatus,
} from "./hostel";

const ALLOCATION_STATUSES: AllocationStatus[] = [
  "ACTIVE",
  "SUSPENDED",
  "VACATED",
];
const MEAL_OFF_STATUSES: MealOffStatus[] = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
];
const BED_STATES: BedState[] = ["FREE", "TAKEN", "MAINTENANCE"];

describe("enum lists stay in step with the PG enums", () => {
  it("has exactly the two hostel types the gender check needs", () => {
    // Adding a third here without adding it to `hostel_type_enum` — or a
    // `MIXED` that `genderMatches` has no branch for — would make the
    // module's one structural refusal silently unreachable.
    expect(HOSTEL_TYPES).toEqual(["BOYS", "GIRLS"]);
  });

  it("mirrors the room types", () => {
    expect(ROOM_TYPES).toEqual(["STANDARD", "AC", "SHARED"]);
  });

  it("mirrors the on/off status shared by hostels and mess plans", () => {
    expect(HOSTEL_STATUSES).toEqual(["ACTIVE", "INACTIVE"]);
  });
});

describe("label maps", () => {
  it("labels every hostel type", () => {
    for (const type of HOSTEL_TYPES) {
      expect(HOSTEL_TYPE_LABELS[type]).toBeTruthy();
    }
  });

  it("labels every room type", () => {
    for (const type of ROOM_TYPES) {
      expect(ROOM_TYPE_LABELS[type]).toBeTruthy();
    }
  });

  it("labels every residency status", () => {
    for (const status of ALLOCATION_STATUSES) {
      expect(ALLOCATION_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it("labels every meal-off status", () => {
    for (const status of MEAL_OFF_STATUSES) {
      expect(MEAL_OFF_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it("labels every bed state", () => {
    for (const state of BED_STATES) {
      expect(BED_STATE_LABELS[state]).toBeTruthy();
      expect(BED_STATE_CLASS[state]).toBeTruthy();
    }
  });

  /**
   * A suspended boarder is still holding their bed, so the label has to
   * say so — "Suspended" alone reads like the bed is free, which is the
   * one thing a warden must not conclude from this screen.
   */
  it("says a suspended boarder still holds the bed", () => {
    expect(ALLOCATION_STATUS_LABELS.SUSPENDED).toMatch(/held/i);
  });
});

describe("badge colours carry the meaning", () => {
  it("makes a refused meal-off read as a problem", () => {
    expect(MEAL_OFF_VARIANT.REJECTED).toBe("destructive");
  });

  it("keeps a withdrawn request visually quiet — it is nobody's fault", () => {
    expect(MEAL_OFF_VARIANT.CANCELLED).toBe("outline");
  });

  it("keeps a vacated residency quiet rather than alarming", () => {
    expect(ALLOCATION_STATUS_VARIANT.VACATED).toBe("outline");
  });

  it("gives only free beds a hover state — the rest are not clickable", () => {
    expect(BED_STATE_CLASS.FREE).toMatch(/hover:/);
    expect(BED_STATE_CLASS.TAKEN).not.toMatch(/hover:/);
    expect(BED_STATE_CLASS.MAINTENANCE).not.toMatch(/hover:/);
  });
});

describe("formatBdt", () => {
  it("always shows two decimals", () => {
    expect(formatBdt(3100)).toBe("3,100.00");
    expect(formatBdt("2100.5")).toBe("2,100.50");
  });

  it("treats a missing amount as zero rather than printing NaN", () => {
    expect(formatBdt(null)).toBe("0.00");
    expect(formatBdt(undefined)).toBe("0.00");
    expect(formatBdt("not a number")).toBe("0.00");
  });

  it("rounds to the paisa", () => {
    expect(formatBdt(225.806)).toBe("225.81");
  });
});
