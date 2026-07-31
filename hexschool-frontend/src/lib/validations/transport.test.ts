import { describe, expect, it } from "vitest";
import {
  driverSchema,
  expenseSchema,
  reassignSchema,
  reasonSchema,
  routeSchema,
  stopSchema,
  vehicleSchema,
} from "./transport";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

describe("vehicleSchema", () => {
  const valid = { regNo: "DHAKA METRO GA 11-2345", capacity: 40 };

  it("accepts a plate and a seat count", () => {
    expect(vehicleSchema.safeParse(valid).success).toBe(true);
  });

  /**
   * Roadmap §7 makes the plate free text on purpose: BD registrations are
   * written half a dozen ways and a regex would refuse real buses.
   */
  it.each([
    "DHAKA-METRO-GA-11-2345",
    "Dhaka Metro Ga 11 2345",
    "চট্ট মেট্রো গ ১১-২৩৪৫",
  ])("accepts %s as a registration", (regNo) => {
    expect(vehicleSchema.safeParse({ ...valid, regNo }).success).toBe(true);
  });

  it("refuses a bus with no seats", () => {
    expect(vehicleSchema.safeParse({ ...valid, capacity: 0 }).success).toBe(
      false,
    );
  });

  it("refuses a seat count that is obviously a typo", () => {
    expect(vehicleSchema.safeParse({ ...valid, capacity: 4000 }).success).toBe(
      false,
    );
  });

  it("refuses a fractional seat", () => {
    expect(vehicleSchema.safeParse({ ...valid, capacity: 40.5 }).success).toBe(
      false,
    );
  });

  /** A lapsed date is a WARNING on the server, never a refusal here. */
  it("accepts an expiry date that is already in the past", () => {
    expect(
      vehicleSchema.safeParse({ ...valid, fitnessExpiry: "2020-01-01" })
        .success,
    ).toBe(true);
  });

  it("refuses a date that is not a date", () => {
    expect(
      vehicleSchema.safeParse({ ...valid, fitnessExpiry: "31/07/2026" })
        .success,
    ).toBe(false);
  });
});

describe("driverSchema", () => {
  const valid = {
    name: "Abdul Karim",
    phone: "01712345678",
    licenseNo: "DK-1234567",
  };

  it("accepts a driver with a BD mobile number", () => {
    expect(driverSchema.safeParse(valid).success).toBe(true);
  });

  it.each(["0171234567", "1712345678", "01212345678", "+8801712345678"])(
    "refuses %s as a phone number",
    (phone) => {
      expect(driverSchema.safeParse({ ...valid, phone }).success).toBe(false);
    },
  );

  it("refuses a blank licence number", () => {
    expect(driverSchema.safeParse({ ...valid, licenseNo: "" }).success).toBe(
      false,
    );
  });
});

describe("routeSchema", () => {
  const valid = { name: "Mirpur Morning" };

  it("accepts a route with nothing attached yet", () => {
    expect(routeSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses the same person as driver and substitute", () => {
    const result = routeSchema.safeParse({
      ...valid,
      driverId: UUID_A,
      substituteDriverId: UUID_A,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/substitute cannot be/i);
    }
  });

  it("accepts two different people", () => {
    expect(
      routeSchema.safeParse({
        ...valid,
        driverId: UUID_A,
        substituteDriverId: UUID_B,
      }).success,
    ).toBe(true);
  });
});

describe("stopSchema", () => {
  const valid = { name: "Kazipara", monthlyFee: 1500 };

  it("accepts a stop with a fare", () => {
    expect(stopSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts a free stop", () => {
    expect(stopSchema.safeParse({ ...valid, monthlyFee: 0 }).success).toBe(true);
  });

  /** A negative fare would hand a family money for travelling. */
  it("refuses a negative fare", () => {
    expect(stopSchema.safeParse({ ...valid, monthlyFee: -100 }).success).toBe(
      false,
    );
  });

  it.each(["7:10", "24:00", "07:60", "0710"])(
    "refuses %s as a time",
    (pickupTime) => {
      expect(stopSchema.safeParse({ ...valid, pickupTime }).success).toBe(false);
    },
  );

  it("accepts a well-formed pickup and drop", () => {
    expect(
      stopSchema.safeParse({
        ...valid,
        pickupTime: "07:10",
        dropTime: "16:20",
      }).success,
    ).toBe(true);
  });

  it("refuses a drop that is not after the pickup — one of them is the wrong run", () => {
    expect(
      stopSchema.safeParse({
        ...valid,
        pickupTime: "16:20",
        dropTime: "07:10",
      }).success,
    ).toBe(false);
  });
});

describe("reasonSchema", () => {
  it("demands a reason for a suspension or an ending", () => {
    expect(reasonSchema.safeParse({ reason: "" }).success).toBe(false);
    expect(reasonSchema.safeParse({ reason: "ok" }).success).toBe(false);
    expect(reasonSchema.safeParse({ reason: "Moved house" }).success).toBe(true);
  });

  it("accepts an effective date, and refuses a malformed one", () => {
    expect(
      reasonSchema.safeParse({ reason: "Long illness", effectiveDate: "2026-03-11" })
        .success,
    ).toBe(true);
    expect(
      reasonSchema.safeParse({ reason: "Long illness", effectiveDate: "March" })
        .success,
    ).toBe(false);
  });
});

describe("reassignSchema", () => {
  it("accepts a route move with a reason", () => {
    expect(
      reassignSchema.safeParse({
        fromRouteId: UUID_A,
        toRouteId: UUID_B,
        reason: "Route split for the new bus",
      }).success,
    ).toBe(true);
  });

  it("refuses a move with no reason — this is audited", () => {
    expect(
      reassignSchema.safeParse({
        fromRouteId: UUID_A,
        toRouteId: UUID_B,
        reason: "",
      }).success,
    ).toBe(false);
  });
});

describe("expenseSchema", () => {
  const valid = {
    vehicleId: UUID_A,
    type: "FUEL" as const,
    date: "2026-03-01",
    amount: 5000,
  };

  it("accepts a fuel receipt", () => {
    expect(expenseSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses an expense of zero — that is a receipt nobody keeps", () => {
    expect(expenseSchema.safeParse({ ...valid, amount: 0 }).success).toBe(false);
  });

  it("refuses a negative expense — that is income in the wrong place", () => {
    expect(expenseSchema.safeParse({ ...valid, amount: -100 }).success).toBe(
      false,
    );
  });

  it("accepts an odometer reading, and refuses a fractional one", () => {
    expect(
      expenseSchema.safeParse({ ...valid, odometer: 10_450 }).success,
    ).toBe(true);
    expect(
      expenseSchema.safeParse({ ...valid, odometer: 10_450.5 }).success,
    ).toBe(false);
  });

  it("refuses a receipt link that is not a URL", () => {
    expect(
      expenseSchema.safeParse({ ...valid, receiptUrl: "receipt.jpg" }).success,
    ).toBe(false);
    expect(
      expenseSchema.safeParse({ ...valid, receiptUrl: "" }).success,
    ).toBe(true);
  });
});
