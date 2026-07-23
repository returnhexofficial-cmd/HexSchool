import { describe, expect, it } from "vitest";
import { smsParts } from "@/lib/api/communication";
import { bulkSchema, noticeSchema, templateSchema } from "./communication";

describe("communication validations + helpers (mirror of the M17 backend)", () => {
  describe("smsParts", () => {
    it("counts a short GSM-7 body as one part", () => {
      expect(smsParts("Your child was absent today.")).toEqual({
        parts: 1,
        unicode: false,
      });
    });

    it("rolls a long GSM-7 body to two parts at 161 chars", () => {
      expect(smsParts("a".repeat(161)).parts).toBe(2);
    });

    it("treats Bangla as unicode with a 70-char single part", () => {
      expect(smsParts("ক".repeat(70))).toEqual({ parts: 1, unicode: true });
      expect(smsParts("ক".repeat(71)).parts).toBe(2);
    });

    it("bills the empty string as one part", () => {
      expect(smsParts("").parts).toBe(1);
    });
  });

  describe("templateSchema", () => {
    it("accepts a valid template", () => {
      expect(
        templateSchema.safeParse({
          code: "ABSENT_ALERT",
          channel: "SMS",
          body: "{{student_name}} was absent",
        }).success,
      ).toBe(true);
    });

    it("rejects an empty body", () => {
      expect(
        templateSchema.safeParse({
          code: "ABSENT_ALERT",
          channel: "SMS",
          body: "",
        }).success,
      ).toBe(false);
    });
  });

  describe("noticeSchema", () => {
    it("rejects a too-short title", () => {
      expect(
        noticeSchema.safeParse({ title: "x", body: "b", audience: "ALL" }).success,
      ).toBe(false);
    });
  });

  describe("bulkSchema", () => {
    it("accepts a RAW custom-numbers blast", () => {
      expect(
        bulkSchema.safeParse({
          channel: "SMS",
          audience: "RAW",
          message: "hi",
        }).success,
      ).toBe(true);
    });

    it("rejects an unknown audience", () => {
      expect(
        bulkSchema.safeParse({
          channel: "SMS",
          audience: "NOBODY",
          message: "hi",
        }).success,
      ).toBe(false);
    });
  });
});
