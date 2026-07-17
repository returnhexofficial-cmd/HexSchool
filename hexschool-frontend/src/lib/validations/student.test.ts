import { describe, expect, it } from "vitest";
import {
  guardianEntrySchema,
  guardianSchema,
  studentMedicalSchema,
  studentPersonalSchema,
  validateGuardianEntries,
  type GuardianEntryValues,
  type StudentPersonalValues,
} from "./student";

const validPersonal = (): StudentPersonalValues => ({
  firstName: "Rahim",
  lastName: "Uddin",
  nameBn: "",
  gender: "MALE",
  dob: "2014-03-12",
  bloodGroup: "",
  religion: "ISLAM",
  birthCertificateNo: "",
  admissionDate: "2026-01-10",
  admissionClassId: "class-6",
  previousSchool: "",
});

const entry = (
  overrides: Partial<GuardianEntryValues> = {},
): GuardianEntryValues => ({
  guardianId: "",
  name: "Karim",
  phone: "01712345678",
  email: "",
  nid: "",
  occupation: "",
  relation: "FATHER",
  isPrimary: true,
  isEmergencyContact: true,
  ...overrides,
});

describe("studentPersonalSchema", () => {
  it("accepts a valid student", () => {
    expect(studentPersonalSchema.safeParse(validPersonal()).success).toBe(true);
  });

  it("requires an admission class", () => {
    expect(
      studentPersonalSchema.safeParse({
        ...validPersonal(),
        admissionClassId: "",
      }).success,
    ).toBe(false);
  });

  it("rejects a malformed birth certificate", () => {
    expect(
      studentPersonalSchema.safeParse({
        ...validPersonal(),
        birthCertificateNo: "123",
      }).success,
    ).toBe(false);
    expect(
      studentPersonalSchema.safeParse({
        ...validPersonal(),
        birthCertificateNo: "1".repeat(17),
      }).success,
    ).toBe(true);
  });
});

describe("guardianEntrySchema", () => {
  it("accepts an inline guardian with name + phone", () => {
    expect(guardianEntrySchema.safeParse(entry()).success).toBe(true);
  });

  it("accepts an existing-guardian pick without name/phone", () => {
    expect(
      guardianEntrySchema.safeParse(
        entry({ guardianId: "g-1", name: "", phone: "" }),
      ).success,
    ).toBe(true);
  });

  it("rejects an entry with neither id nor name+phone", () => {
    expect(
      guardianEntrySchema.safeParse(entry({ name: "", phone: "" })).success,
    ).toBe(false);
  });

  it("rejects a non-BD phone", () => {
    expect(
      guardianEntrySchema.safeParse(entry({ phone: "12345" })).success,
    ).toBe(false);
  });
});

describe("validateGuardianEntries", () => {
  it("requires at least one guardian", () => {
    expect(validateGuardianEntries([])).toMatch(/at least one/);
  });

  it("requires exactly one primary when several exist", () => {
    expect(
      validateGuardianEntries([
        entry({ isPrimary: false }),
        entry({ phone: "01812345679", isPrimary: false }),
      ]),
    ).toMatch(/exactly one/);
  });

  it("rejects two primaries", () => {
    expect(
      validateGuardianEntries([
        entry(),
        entry({ phone: "01812345679", isPrimary: true }),
      ]),
    ).toMatch(/[Oo]nly one/);
  });

  it("rejects duplicate guardian phones", () => {
    expect(
      validateGuardianEntries([
        entry({ isPrimary: true }),
        entry({ isPrimary: false }),
      ]),
    ).toMatch(/more than once/);
  });

  it("accepts a single unmarked guardian (implicit primary)", () => {
    expect(validateGuardianEntries([entry({ isPrimary: false })])).toBeNull();
  });
});

describe("guardianSchema", () => {
  it("requires a name and a BD phone", () => {
    expect(
      guardianSchema.safeParse({
        name: "Karim",
        relation: "FATHER",
        phone: "01712345678",
      }).success,
    ).toBe(true);
    expect(
      guardianSchema.safeParse({
        name: "",
        relation: "FATHER",
        phone: "01712345678",
      }).success,
    ).toBe(false);
  });
});

describe("studentMedicalSchema", () => {
  it("accepts numeric height/weight strings", () => {
    expect(
      studentMedicalSchema.safeParse({ heightCm: "140.5", weightKg: "38" })
        .success,
    ).toBe(true);
  });

  it("rejects non-numeric measurements", () => {
    expect(
      studentMedicalSchema.safeParse({ heightCm: "tall" }).success,
    ).toBe(false);
  });
});
