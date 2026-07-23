import { describe, expect, it } from "vitest";
import { formatBDT } from "@/lib/api/fee";
import {
  collectPaymentSchema,
  feeHeadSchema,
  feeOverrideSchema,
  refundSchema,
} from "./fee";

describe("fee validations (mirror of the M16 backend DTOs)", () => {
  describe("feeHeadSchema", () => {
    it("accepts a valid head", () => {
      expect(
        feeHeadSchema.safeParse({
          name: "Tuition",
          type: "RECURRING_MONTHLY",
          isRefundable: true,
        }).success,
      ).toBe(true);
    });

    it("rejects a too-short name", () => {
      expect(
        feeHeadSchema.safeParse({
          name: "T",
          type: "ONE_TIME",
          isRefundable: false,
        }).success,
      ).toBe(false);
    });
  });

  describe("feeOverrideSchema", () => {
    it("caps a percentage discount at 100", () => {
      const bad = feeOverrideSchema.safeParse({
        feeHeadId: "11111111-1111-4111-8111-111111111111",
        type: "DISCOUNT_PERCENT",
        value: 150,
        reason: "too generous",
      });
      expect(bad.success).toBe(false);
    });

    it("allows a flat discount above 100", () => {
      const ok = feeOverrideSchema.safeParse({
        feeHeadId: "11111111-1111-4111-8111-111111111111",
        type: "DISCOUNT_FLAT",
        value: 500,
        reason: "sibling discount",
      });
      expect(ok.success).toBe(true);
    });

    it("requires a reason", () => {
      const bad = feeOverrideSchema.safeParse({
        feeHeadId: "11111111-1111-4111-8111-111111111111",
        type: "WAIVER",
        value: 0,
        reason: "",
      });
      expect(bad.success).toBe(false);
    });
  });

  describe("collectPaymentSchema", () => {
    it("rejects a zero amount", () => {
      expect(
        collectPaymentSchema.safeParse({ amount: 0, method: "CASH" }).success,
      ).toBe(false);
    });

    it("rejects an online method at the desk", () => {
      expect(
        collectPaymentSchema.safeParse({ amount: 100, method: "BKASH" })
          .success,
      ).toBe(false);
    });

    it("accepts cash", () => {
      expect(
        collectPaymentSchema.safeParse({ amount: 100, method: "CASH" }).success,
      ).toBe(true);
    });
  });

  describe("refundSchema", () => {
    it("needs a reason and a positive amount", () => {
      expect(refundSchema.safeParse({ amount: 50, reason: "err" }).success).toBe(
        true,
      );
      expect(
        refundSchema.safeParse({ amount: 0, reason: "err" }).success,
      ).toBe(false);
    });
  });

  describe("formatBDT", () => {
    it("renders two decimals with a BDT prefix", () => {
      expect(formatBDT(1234.5)).toBe("BDT 1,234.50");
      expect(formatBDT("0")).toBe("BDT 0.00");
    });
  });
});
