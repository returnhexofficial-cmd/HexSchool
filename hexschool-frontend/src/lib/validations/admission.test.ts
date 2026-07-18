import { describe, expect, it } from "vitest";
import {
  applyApplicantSchema,
  applyGuardianSchema,
  applyOtpSchema,
  applyPhoneSchema,
  cycleSchema,
  recordPaymentSchema,
  testSlotSchema,
  trackSchema,
  type CycleValues,
} from "./admission";

const validCycle = (): CycleValues => ({
  sessionId: "session-1",
  name: "Admission 2027",
  startAt: "2026-10-01",
  endAt: "2026-11-30",
  testRequired: true,
  instructions: "",
  classes: [{ classId: "class-6", seats: "120", applicationFee: "200" }],
});

describe("cycleSchema", () => {
  it("accepts a valid cycle", () => {
    expect(cycleSchema.safeParse(validCycle()).success).toBe(true);
  });

  it("rejects end date before start date", () => {
    const result = cycleSchema.safeParse({
      ...validCycle(),
      startAt: "2026-12-01",
      endAt: "2026-11-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate classes", () => {
    const result = cycleSchema.safeParse({
      ...validCycle(),
      classes: [
        { classId: "class-6", seats: "60", applicationFee: "" },
        { classId: "class-6", seats: "40", applicationFee: "" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects zero seats and requires at least one class", () => {
    expect(
      cycleSchema.safeParse({
        ...validCycle(),
        classes: [{ classId: "class-6", seats: "0", applicationFee: "" }],
      }).success,
    ).toBe(false);
    expect(
      cycleSchema.safeParse({ ...validCycle(), classes: [] }).success,
    ).toBe(false);
  });
});

describe("testSlotSchema", () => {
  it("rejects pass marks above total marks", () => {
    expect(
      testSlotSchema.safeParse({
        classId: "class-6",
        testDate: "2026-12-05",
        venue: "",
        totalMarks: "100",
        passMarks: "120",
      }).success,
    ).toBe(false);
  });

  it("accepts a valid slot", () => {
    expect(
      testSlotSchema.safeParse({
        classId: "class-6",
        testDate: "2026-12-05",
        venue: "Main Hall",
        totalMarks: "100",
        passMarks: "33",
      }).success,
    ).toBe(true);
  });
});

describe("recordPaymentSchema", () => {
  it("accepts method-only (amount defaults to the class fee)", () => {
    expect(
      recordPaymentSchema.safeParse({
        method: "CASH",
        reference: "",
        amount: "",
      }).success,
    ).toBe(true);
  });

  it("rejects a malformed amount", () => {
    expect(
      recordPaymentSchema.safeParse({
        method: "BKASH",
        reference: "TX1",
        amount: "12.345",
      }).success,
    ).toBe(false);
  });
});

describe("public apply schemas", () => {
  it("validates BD phone numbers", () => {
    expect(applyPhoneSchema.safeParse({ phone: "01712345678" }).success).toBe(
      true,
    );
    expect(applyPhoneSchema.safeParse({ phone: "01212345678" }).success).toBe(
      false,
    );
  });

  it("requires a 6-digit OTP", () => {
    expect(applyOtpSchema.safeParse({ code: "123456" }).success).toBe(true);
    expect(applyOtpSchema.safeParse({ code: "12345" }).success).toBe(false);
  });

  it("validates the applicant step (GPA bounds)", () => {
    const base = {
      cycleId: "cycle-1",
      classId: "class-6",
      firstName: "Rahim",
      lastName: "Uddin",
      nameBn: "",
      gender: "MALE" as const,
      dob: "2015-04-01",
      religion: "ISLAM" as const,
      presentAddress: "",
      previousSchool: "",
      previousGpa: "4.50",
    };
    expect(applyApplicantSchema.safeParse(base).success).toBe(true);
    expect(
      applyApplicantSchema.safeParse({ ...base, previousGpa: "6.0" }).success,
    ).toBe(false);
    expect(
      applyApplicantSchema.safeParse({ ...base, dob: "01-04-2015" }).success,
    ).toBe(false);
  });

  it("requires guardian name + BD phone", () => {
    expect(
      applyGuardianSchema.safeParse({
        name: "Karim",
        nameBn: "",
        relation: "FATHER",
        phone: "01898765432",
        email: "",
        occupation: "",
      }).success,
    ).toBe(true);
    expect(
      applyGuardianSchema.safeParse({
        name: "",
        nameBn: "",
        relation: "FATHER",
        phone: "01898765432",
        email: "",
        occupation: "",
      }).success,
    ).toBe(false);
  });
});

describe("trackSchema", () => {
  it("requires the application number and phone", () => {
    expect(
      trackSchema.safeParse({ appNo: "ADM-27-000123", phone: "01712345678" })
        .success,
    ).toBe(true);
    expect(
      trackSchema.safeParse({ appNo: "", phone: "01712345678" }).success,
    ).toBe(false);
  });
});
