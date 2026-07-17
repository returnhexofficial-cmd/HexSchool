import { describe, expect, it } from "vitest";
import {
  qualificationSchema,
  teacherLeaveSchema,
  teacherSchema,
  type TeacherFormValues,
} from "./teacher";

const valid = (): TeacherFormValues => ({
  email: "",
  phone: "01812345678",
  firstName: "Karima",
  lastName: "Khatun",
  nameBn: "",
  designation: "ASSISTANT_TEACHER",
  departmentId: "",
  gender: "FEMALE",
  dob: "1988-06-20",
  bloodGroup: "",
  nidNumber: "",
  presentAddress: "",
  permanentAddress: "",
  joiningDate: "2019-01-10",
  salaryGrade: "",
  mpoIndexNo: "",
  specialization: "Mathematics",
});

describe("teacherSchema", () => {
  it("accepts a valid phone-only teacher", () => {
    expect(teacherSchema.safeParse(valid()).success).toBe(true);
  });

  it("requires an email OR a phone", () => {
    expect(
      teacherSchema.safeParse({ ...valid(), phone: "" }).success,
    ).toBe(false);
    expect(
      teacherSchema.safeParse({ ...valid(), phone: "", email: "a@b.com" })
        .success,
    ).toBe(true);
  });

  it("rejects unknown designations", () => {
    expect(
      teacherSchema.safeParse({ ...valid(), designation: "JANITOR" }).success,
    ).toBe(false);
  });
});

describe("qualificationSchema", () => {
  const base = {
    degree: "BSc",
    institution: "University of Dhaka",
    result: "",
  };

  it("passing year must be 1950–current", () => {
    expect(
      qualificationSchema.safeParse({ ...base, passingYear: "2008" }).success,
    ).toBe(true);
    expect(
      qualificationSchema.safeParse({ ...base, passingYear: "1949" }).success,
    ).toBe(false);
    expect(
      qualificationSchema.safeParse({
        ...base,
        passingYear: String(new Date().getFullYear() + 1),
      }).success,
    ).toBe(false);
  });
});

describe("teacherLeaveSchema", () => {
  const base = {
    teacherId: "t-1",
    type: "CASUAL" as const,
    reason: "",
  };

  it("end must be on/after start", () => {
    expect(
      teacherLeaveSchema.safeParse({
        ...base,
        fromDate: "2026-03-01",
        toDate: "2026-03-05",
      }).success,
    ).toBe(true);
    expect(
      teacherLeaveSchema.safeParse({
        ...base,
        fromDate: "2026-03-06",
        toDate: "2026-03-05",
      }).success,
    ).toBe(false);
  });

  it("requires a teacher", () => {
    expect(
      teacherLeaveSchema.safeParse({
        ...base,
        teacherId: "",
        fromDate: "2026-03-01",
        toDate: "2026-03-05",
      }).success,
    ).toBe(false);
  });
});
