import { describe, expect, it } from "vitest";
import {
  ASSIGNMENT_STATUS_LABELS,
  CAPACITY_VARIANT,
  DRIVER_STATUS_LABELS,
  DRIVER_STATUSES,
  EXPENSE_TYPE_LABELS,
  EXPENSE_TYPES,
  EXPIRY_LABELS,
  EXPIRY_VARIANT,
  formatBdt,
  VEHICLE_STATUS_LABELS,
  VEHICLE_STATUSES,
  VEHICLE_TYPES,
} from "./transport";

describe("label maps", () => {
  it("labels every vehicle status", () => {
    for (const status of VEHICLE_STATUSES) {
      expect(VEHICLE_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it("labels every driver status", () => {
    for (const status of DRIVER_STATUSES) {
      expect(DRIVER_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it("labels every expense type", () => {
    for (const type of EXPENSE_TYPES) {
      expect(EXPENSE_TYPE_LABELS[type]).toBeTruthy();
    }
  });

  it("labels every rider status", () => {
    for (const status of ["ACTIVE", "SUSPENDED", "ENDED"] as const) {
      expect(ASSIGNMENT_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it("keeps the vehicle types in step with the PG enum", () => {
    expect(VEHICLE_TYPES).toEqual(["BUS", "MICROBUS", "VAN", "OTHER"]);
  });

  /**
   * The badge colours carry the same meaning the engines do: a lapsed
   * paper and a bus over capacity are the two states that must read as
   * problems at a glance.
   */
  it("paints an expired document and an over-capacity route as destructive", () => {
    expect(EXPIRY_VARIANT.EXPIRED).toBe("destructive");
    expect(CAPACITY_VARIANT.OVER).toBe("destructive");
  });

  it("does not paint a missing date as if it were fine", () => {
    expect(EXPIRY_VARIANT.UNKNOWN).not.toBe("default");
    expect(EXPIRY_LABELS.UNKNOWN).toMatch(/not recorded/i);
  });
});

describe("formatBdt", () => {
  it("always prints two decimals with thousands separators", () => {
    expect(formatBdt(1500)).toBe("1,500.00");
    expect(formatBdt("1064.5")).toBe("1,064.50");
    expect(formatBdt(0)).toBe("0.00");
  });

  it("treats a missing amount as zero rather than printing NaN", () => {
    expect(formatBdt(null)).toBe("0.00");
    expect(formatBdt(undefined)).toBe("0.00");
    expect(formatBdt("not a number")).toBe("0.00");
  });
});
