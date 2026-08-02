import { describe, expect, it } from "vitest";
import {
  ASSET_CONDITIONS,
  ASSET_STATUS_LABELS,
  ASSET_STATUS_VARIANT,
  formatBdt,
  formatQty,
  HOLDER_TYPE_LABELS,
  HOLDER_TYPES,
  ISSUE_STATUS_LABELS,
  ITEM_TYPE_LABELS,
  ITEM_TYPES,
  ITEM_UNITS,
  PURCHASE_STATUS_LABELS,
  PURCHASE_STATUS_VARIANT,
  SUPPLIER_STATUS_LABELS,
  SUPPLIER_STATUSES,
  TXN_LABELS,
  WARRANTY_VARIANT,
  type AssetStatus,
  type IssueStatus,
  type PurchaseStatus,
  type StockTxn,
  type WarrantyState,
} from "./inventory";

describe("label maps", () => {
  it("labels every item type", () => {
    for (const type of ITEM_TYPES) {
      expect(ITEM_TYPE_LABELS[type]).toBeTruthy();
    }
  });

  it("labels every supplier status", () => {
    for (const status of SUPPLIER_STATUSES) {
      expect(SUPPLIER_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it("labels every purchase status", () => {
    for (const status of ["DRAFT", "RECEIVED", "CANCELLED"] as PurchaseStatus[]) {
      expect(PURCHASE_STATUS_LABELS[status]).toBeTruthy();
      expect(PURCHASE_STATUS_VARIANT[status]).toBeTruthy();
    }
  });

  it("labels every asset status", () => {
    for (const status of [
      "IN_STORE",
      "ASSIGNED",
      "UNDER_REPAIR",
      "DISPOSED",
      "LOST",
    ] as AssetStatus[]) {
      expect(ASSET_STATUS_LABELS[status]).toBeTruthy();
      expect(ASSET_STATUS_VARIANT[status]).toBeTruthy();
    }
  });

  it("labels every issue status", () => {
    for (const status of [
      "ISSUED",
      "PARTIAL_RETURN",
      "RETURNED",
    ] as IssueStatus[]) {
      expect(ISSUE_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it("labels every stock movement", () => {
    for (const txn of [
      "PURCHASE",
      "ISSUE",
      "RETURN",
      "ADJUST",
      "DISPOSE",
    ] as StockTxn[]) {
      expect(TXN_LABELS[txn]).toBeTruthy();
    }
  });

  it("labels every holder kind", () => {
    for (const type of HOLDER_TYPES) {
      expect(HOLDER_TYPE_LABELS[type]).toBeTruthy();
    }
  });

  it("carries the full unit and condition lists the backend enums declare", () => {
    expect(ITEM_UNITS).toHaveLength(7);
    expect(ASSET_CONDITIONS).toHaveLength(5);
  });
});

describe("warranty badge colours", () => {
  it("**does not treat a missing date as fine**", () => {
    // The projector whose warranty nobody recorded is the one most likely
    // to be out of cover — it shares the warning colour with one that is
    // about to lapse, and is deliberately NOT the same as ACTIVE.
    expect(WARRANTY_VARIANT.UNKNOWN).not.toBe(WARRANTY_VARIANT.ACTIVE);
    expect(WARRANTY_VARIANT.UNKNOWN).toBe(WARRANTY_VARIANT.EXPIRING);
  });

  it("gives an expired warranty the loudest variant", () => {
    expect(WARRANTY_VARIANT.EXPIRED).toBe("destructive");
  });

  it("covers every state", () => {
    for (const state of [
      "UNKNOWN",
      "ACTIVE",
      "EXPIRING",
      "EXPIRED",
    ] as WarrantyState[]) {
      expect(WARRANTY_VARIANT[state]).toBeTruthy();
    }
  });
});

describe("formatQty", () => {
  it("drops the column padding a store register never had", () => {
    // NUMERIC(14,3) comes back as "12.000" and nobody writes that on a
    // gate pass.
    expect(formatQty(12)).toBe("12");
    expect(formatQty("12.000")).toBe("12");
    expect(formatQty(12.5)).toBe("12.5");
    expect(formatQty("0.250")).toBe("0.25");
  });

  it("appends the unit when one is given", () => {
    expect(formatQty(3, "REAM")).toBe("3 REAM");
    expect(formatQty("48.000", "PCS")).toBe("48 PCS");
  });

  it("falls back to zero rather than printing NaN", () => {
    expect(formatQty(null)).toBe("0");
    expect(formatQty(undefined)).toBe("0");
    expect(formatQty("not a number")).toBe("0");
    expect(formatQty("nonsense", "KG")).toBe("0 KG");
  });

  it("rounds to the column's three decimals", () => {
    expect(formatQty(1.23456)).toBe("1.235");
  });
});

describe("formatBdt", () => {
  it("always shows two decimals", () => {
    expect(formatBdt(1560)).toBe("1,560.00");
    expect(formatBdt("240.5")).toBe("240.50");
  });

  it("treats a missing value as zero", () => {
    expect(formatBdt(null)).toBe("0.00");
    expect(formatBdt(undefined)).toBe("0.00");
  });
});
