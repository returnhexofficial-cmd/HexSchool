import { describe, expect, it } from "vitest";
import {
  assignSalarySchema,
  bonusRunSchema,
  leaveApplicationSchema,
  leaveTypeSchema,
  payslipEditSchema,
  salaryComponentSchema,
  salaryStructureSchema,
} from "./hr";

const leave = {
  personType: "TEACHER" as const,
  personId: "t-1",
  leaveTypeId: "lt-1",
  fromDate: "2027-03-10",
  toDate: "2027-03-12",
  reason: "Family matter",
};

describe("leaveApplicationSchema", () => {
  it("accepts a well-formed application", () => {
    expect(leaveApplicationSchema.safeParse(leave).success).toBe(true);
  });

  it("refuses an end date before the start", () => {
    const result = leaveApplicationSchema.safeParse({
      ...leave,
      toDate: "2027-03-09",
    });
    expect(result.success).toBe(false);
  });

  it("refuses a half day spanning more than one date", () => {
    const result = leaveApplicationSchema.safeParse({ ...leave, halfDay: true });
    expect(result.success).toBe(false);
  });

  it("accepts a half day on a single date", () => {
    const result = leaveApplicationSchema.safeParse({
      ...leave,
      toDate: leave.fromDate,
      halfDay: true,
    });
    expect(result.success).toBe(true);
  });

  it("insists on a reason", () => {
    expect(
      leaveApplicationSchema.safeParse({ ...leave, reason: "x" }).success,
    ).toBe(false);
  });
});

describe("leaveTypeSchema", () => {
  const type = {
    name: "Casual Leave",
    code: "CASUAL",
    annualQuota: 10,
    carryForward: false,
    maxCarry: 0,
    isPaid: true,
    applicableTo: "ALL" as const,
  };

  it("accepts a sound type", () => {
    expect(leaveTypeSchema.safeParse(type).success).toBe(true);
  });

  it("refuses a lower-case or spaced code", () => {
    expect(leaveTypeSchema.safeParse({ ...type, code: "casual" }).success).toBe(
      false,
    );
    expect(
      leaveTypeSchema.safeParse({ ...type, code: "SICK LEAVE" }).success,
    ).toBe(false);
  });

  it("refuses a carry cap with carry-forward off", () => {
    expect(leaveTypeSchema.safeParse({ ...type, maxCarry: 20 }).success).toBe(
      false,
    );
  });

  it("accepts a carry cap once carry-forward is on", () => {
    expect(
      leaveTypeSchema.safeParse({
        ...type,
        carryForward: true,
        maxCarry: 20,
      }).success,
    ).toBe(true);
  });
});

describe("salaryComponentSchema", () => {
  const component = {
    name: "House Rent",
    type: "ALLOWANCE" as const,
    calc: "PERCENT_OF_BASIC" as const,
    value: 40,
    isTaxable: true,
    isPfBase: false,
  };

  it("accepts a percentage inside 0–100", () => {
    expect(salaryComponentSchema.safeParse(component).success).toBe(true);
  });

  it("refuses a percentage above 100 (the roadmap §7 rule)", () => {
    expect(
      salaryComponentSchema.safeParse({ ...component, value: 140 }).success,
    ).toBe(false);
  });

  it("allows a flat amount above 100", () => {
    expect(
      salaryComponentSchema.safeParse({
        ...component,
        calc: "FLAT",
        value: 1500,
      }).success,
    ).toBe(true);
  });

  it("refuses more than two decimal places", () => {
    expect(
      salaryComponentSchema.safeParse({
        ...component,
        calc: "FLAT",
        value: 12.345,
      }).success,
    ).toBe(false);
  });

  it("refuses a negative value", () => {
    expect(
      salaryComponentSchema.safeParse({ ...component, value: -1 }).success,
    ).toBe(false);
  });
});

describe("salaryStructureSchema", () => {
  it("accepts a structure with no components (an MPO zero-basic scale)", () => {
    expect(
      salaryStructureSchema.safeParse({
        name: "MPO Grade 10",
        basic: 0,
        components: [],
      }).success,
    ).toBe(true);
  });

  it("refuses a nameless structure", () => {
    expect(
      salaryStructureSchema.safeParse({ name: "", basic: 1000, components: [] })
        .success,
    ).toBe(false);
  });
});

describe("assignSalarySchema", () => {
  const base = {
    personType: "TEACHER" as const,
    structureId: "s-1",
    effectiveFrom: "2027-03-01",
  };

  it("requires bank details for a bank transfer", () => {
    const result = assignSalarySchema.safeParse({
      ...base,
      paymentMode: "BANK",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a bank transfer with an account", () => {
    const result = assignSalarySchema.safeParse({
      ...base,
      paymentMode: "BANK",
      bankName: "Sonali Bank",
      accountNo: "0123456789",
    });
    expect(result.success).toBe(true);
  });

  it("does not ask for bank details when paying cash", () => {
    expect(
      assignSalarySchema.safeParse({ ...base, paymentMode: "CASH" }).success,
    ).toBe(true);
  });
});

describe("bonusRunSchema", () => {
  const bonus = {
    name: "Eid-ul-Fitr 2027",
    type: "FESTIVAL" as const,
    basis: "PERCENT_OF_BASIC" as const,
    value: 100,
    minServiceMonths: 6,
    prorate: false,
    applicableTo: "ALL" as const,
  };

  it("accepts a full-basic festival bonus", () => {
    expect(bonusRunSchema.safeParse(bonus).success).toBe(true);
  });

  it("refuses a percentage above 100", () => {
    expect(bonusRunSchema.safeParse({ ...bonus, value: 150 }).success).toBe(
      false,
    );
  });

  it("accepts a flat bonus above 100", () => {
    expect(
      bonusRunSchema.safeParse({ ...bonus, basis: "FLAT", value: 20000 })
        .success,
    ).toBe(true);
  });

  it("refuses a malformed month", () => {
    expect(
      bonusRunSchema.safeParse({ ...bonus, monthPaidWith: "2027-3" }).success,
    ).toBe(false);
  });
});

describe("payslipEditSchema", () => {
  it("insists on a real reason — the edit is audited", () => {
    expect(payslipEditSchema.safeParse({ reason: "fix" }).success).toBe(false);
    expect(
      payslipEditSchema.safeParse({ reason: "Exam committee duty allowance" })
        .success,
    ).toBe(true);
  });
});
