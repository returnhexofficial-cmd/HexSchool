import { describe, expect, it } from "vitest";
import {
  staffDocumentSchema,
  staffSchema,
  staffStatusSchema,
  type StaffFormValues,
} from "./staff";

const valid = (): StaffFormValues => ({
  email: "",
  phone: "01712345678",
  firstName: "Rahim",
  lastName: "Uddin",
  nameBn: "",
  designation: "ACCOUNTANT",
  departmentId: "",
  gender: "MALE",
  dob: "1990-04-10",
  bloodGroup: "",
  nidNumber: "",
  presentAddress: "",
  permanentAddress: "",
  joiningDate: "2020-01-15",
  employmentType: "PERMANENT",
});

describe("staffSchema", () => {
  it("accepts a valid phone-only staff member", () => {
    expect(staffSchema.safeParse(valid()).success).toBe(true);
  });

  it("requires an email OR a phone", () => {
    const values = { ...valid(), phone: "" };
    expect(staffSchema.safeParse(values).success).toBe(false);
    expect(
      staffSchema.safeParse({ ...values, email: "a@b.com" }).success,
    ).toBe(true);
  });

  it("enforces the BD phone format", () => {
    for (const phone of ["0171234567", "02123456789", "+8801712345678"]) {
      expect(staffSchema.safeParse({ ...valid(), phone }).success).toBe(false);
    }
  });

  it("NID must be 10, 13 or 17 digits when present", () => {
    expect(
      staffSchema.safeParse({ ...valid(), nidNumber: "1234567890" }).success,
    ).toBe(true);
    for (const nid of ["12345", "123456789012", "abcdefghij"]) {
      expect(
        staffSchema.safeParse({ ...valid(), nidNumber: nid }).success,
      ).toBe(false);
    }
  });

  it("dates must be YYYY-MM-DD", () => {
    expect(
      staffSchema.safeParse({ ...valid(), dob: "10-04-1990" }).success,
    ).toBe(false);
  });
});

describe("staffStatusSchema", () => {
  it("requires a reason of at least 3 characters", () => {
    expect(
      staffStatusSchema.safeParse({ status: "RESIGNED", reason: "ok" }).success,
    ).toBe(false);
    expect(
      staffStatusSchema.safeParse({ status: "RESIGNED", reason: "moved away" })
        .success,
    ).toBe(true);
  });
});

describe("staffDocumentSchema", () => {
  it("requires a title and a known type", () => {
    expect(
      staffDocumentSchema.safeParse({ title: "NID copy", type: "NID" }).success,
    ).toBe(true);
    expect(
      staffDocumentSchema.safeParse({ title: "", type: "NID" }).success,
    ).toBe(false);
    expect(
      staffDocumentSchema.safeParse({ title: "x", type: "PASSPORT" }).success,
    ).toBe(false);
  });
});
