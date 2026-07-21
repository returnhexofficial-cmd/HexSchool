import { describe, expect, it } from "vitest";
import {
  createPromotionSchema,
  enrollSchema,
  rollSchema,
  transferSchema,
} from "./enrollment";

const uuid = "11111111-1111-4111-8111-111111111111";
const uuid2 = "22222222-2222-4222-9222-222222222222";

describe("enrollment validations", () => {
  it("accepts a minimal valid enrollment", () => {
    const res = enrollSchema.safeParse({
      studentId: uuid,
      sessionId: uuid,
      sectionId: uuid2,
    });
    expect(res.success).toBe(true);
  });

  it("rejects a non-uuid student id", () => {
    const res = enrollSchema.safeParse({
      studentId: "nope",
      sessionId: uuid,
      sectionId: uuid2,
    });
    expect(res.success).toBe(false);
  });

  it("bounds the roll number to 1..9999", () => {
    expect(rollSchema.safeParse(0).success).toBe(false);
    expect(rollSchema.safeParse(10000).success).toBe(false);
    expect(rollSchema.safeParse(1).success).toBe(true);
    expect(rollSchema.safeParse(4.5).success).toBe(false);
  });

  it("requires a target section for a transfer", () => {
    expect(transferSchema.safeParse({}).success).toBe(false);
    expect(
      transferSchema.safeParse({ toSectionId: uuid, keepRoll: true }).success,
    ).toBe(true);
  });

  it("rejects a promotion with equal from/to sessions", () => {
    const res = createPromotionSchema.safeParse({
      fromSessionId: uuid,
      toSessionId: uuid,
    });
    expect(res.success).toBe(false);
  });

  it("accepts a promotion with distinct sessions", () => {
    const res = createPromotionSchema.safeParse({
      fromSessionId: uuid,
      toSessionId: uuid2,
    });
    expect(res.success).toBe(true);
  });
});
