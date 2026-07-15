import { describe, expect, it } from "vitest";
import {
  changePasswordSchema,
  identifierSchema,
  loginSchema,
  resetPasswordSchema,
  verifyOtpSchema,
} from "./auth";

describe("identifierSchema", () => {
  it("accepts emails and BD phones (incl. +88 prefix)", () => {
    expect(identifierSchema.safeParse("user@school.edu.bd").success).toBe(true);
    expect(identifierSchema.safeParse("01712345678").success).toBe(true);
    expect(identifierSchema.safeParse("+8801712345678").success).toBe(true);
  });

  it("rejects malformed values", () => {
    expect(identifierSchema.safeParse("not-an-email").success).toBe(false);
    expect(identifierSchema.safeParse("0123").success).toBe(false);
    expect(identifierSchema.safeParse("02123456789").success).toBe(false);
    expect(identifierSchema.safeParse("").success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("requires identifier and password", () => {
    expect(
      loginSchema.safeParse({ identifier: "01712345678", password: "x" })
        .success,
    ).toBe(true);
    expect(
      loginSchema.safeParse({ identifier: "01712345678", password: "" })
        .success,
    ).toBe(false);
  });
});

describe("verifyOtpSchema", () => {
  it("accepts exactly 6 digits", () => {
    expect(verifyOtpSchema.safeParse({ code: "123456" }).success).toBe(true);
    expect(verifyOtpSchema.safeParse({ code: "12345" }).success).toBe(false);
    expect(verifyOtpSchema.safeParse({ code: "12345a" }).success).toBe(false);
  });
});

describe("password schemas", () => {
  it("enforces the policy (8+, upper, lower, digit)", () => {
    const weak = { newPassword: "weakpass", confirmPassword: "weakpass" };
    expect(resetPasswordSchema.safeParse(weak).success).toBe(false);
    const good = { newPassword: "GoodPass1", confirmPassword: "GoodPass1" };
    expect(resetPasswordSchema.safeParse(good).success).toBe(true);
  });

  it("rejects mismatched confirmation", () => {
    expect(
      resetPasswordSchema.safeParse({
        newPassword: "GoodPass1",
        confirmPassword: "Different1",
      }).success,
    ).toBe(false);
  });

  it("change: new password must differ from current", () => {
    expect(
      changePasswordSchema.safeParse({
        currentPassword: "GoodPass1",
        newPassword: "GoodPass1",
        confirmPassword: "GoodPass1",
      }).success,
    ).toBe(false);
    expect(
      changePasswordSchema.safeParse({
        currentPassword: "OldPass12",
        newPassword: "GoodPass1",
        confirmPassword: "GoodPass1",
      }).success,
    ).toBe(true);
  });
});
