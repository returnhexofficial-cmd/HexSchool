import { describe, expect, it } from "vitest";
import {
  alumniEventSchema,
  alumniSchema,
  cancelDonationSchema,
  checkInSchema,
  donationSchema,
  publicTicketSchema,
  ticketStatusSchema,
} from "./community";

const CURRENT_YEAR = new Date().getFullYear();

describe("publicTicketSchema — the anonymous box's contract", () => {
  const base = {
    type: "COMPLAINT" as const,
    category: "FACILITY" as const,
    subject: "The tap is broken",
    description: "It has been dripping for a week.",
  };

  it("accepts a named complaint with a phone", () => {
    expect(
      publicTicketSchema.safeParse({ ...base, phone: "01712345678" }).success,
    ).toBe(true);
  });

  it("accepts a named complaint with only an email", () => {
    expect(
      publicTicketSchema.safeParse({ ...base, email: "a@b.com" }).success,
    ).toBe(true);
  });

  it("accepts an anonymous complaint with no contact at all", () => {
    expect(publicTicketSchema.safeParse({ ...base, anonymous: true }).success).toBe(
      true,
    );
  });

  it("refuses a named complaint with no way to reply to it", () => {
    const result = publicTicketSchema.safeParse(base);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/anonymously/);
    }
  });

  it("refuses a subject over the 200-character limit (roadmap §7)", () => {
    expect(
      publicTicketSchema.safeParse({
        ...base,
        subject: "x".repeat(201),
        phone: "01712345678",
      }).success,
    ).toBe(false);
  });

  it("refuses a malformed BD mobile", () => {
    expect(
      publicTicketSchema.safeParse({ ...base, phone: "0181234" }).success,
    ).toBe(false);
    expect(
      publicTicketSchema.safeParse({ ...base, phone: "01212345678" }).success,
    ).toBe(false);
  });
});

describe("ticketStatusSchema — a resolution is not optional", () => {
  it("accepts moving to IN_PROGRESS with nothing written", () => {
    expect(ticketStatusSchema.safeParse({ status: "IN_PROGRESS" }).success).toBe(
      true,
    );
  });

  for (const status of ["RESOLVED", "CLOSED"] as const) {
    it(`refuses ${status} with no resolution`, () => {
      expect(ticketStatusSchema.safeParse({ status }).success).toBe(false);
    });

    it(`refuses ${status} with only whitespace`, () => {
      expect(
        ticketStatusSchema.safeParse({ status, resolution: "   " }).success,
      ).toBe(false);
    });

    it(`accepts ${status} with a real resolution`, () => {
      expect(
        ticketStatusSchema.safeParse({ status, resolution: "Plumber booked" })
          .success,
      ).toBe(true);
    });
  }
});

describe("checkInSchema — the multi-day pass is OFFICIAL-only (roadmap §8)", () => {
  const base = {
    name: "A Vendor",
    phone: "01712345678",
    purpose: "VENDOR" as const,
  };

  it("accepts an ordinary same-day visit", () => {
    expect(checkInSchema.safeParse(base).success).toBe(true);
  });

  it("refuses a multi-day pass for a vendor", () => {
    const result = checkInSchema.safeParse({
      ...base,
      validUntil: "2026-08-20",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/OFFICIAL/);
    }
  });

  it("allows one for an external invigilator", () => {
    expect(
      checkInSchema.safeParse({
        ...base,
        purpose: "OFFICIAL",
        validUntil: "2026-08-20",
      }).success,
    ).toBe(true);
  });

  it("requires a name and a valid mobile at the gate", () => {
    expect(checkInSchema.safeParse({ ...base, name: "A" }).success).toBe(false);
    expect(checkInSchema.safeParse({ ...base, phone: "12345" }).success).toBe(
      false,
    );
  });
});

describe("alumniSchema — batch year and reachability", () => {
  const base = {
    name: "Farhana Akter",
    batchYear: 2015,
    phone: "01712345678",
  };

  it("accepts a plausible alumnus", () => {
    expect(alumniSchema.safeParse(base).success).toBe(true);
  });

  it("refuses a future batch — that person is still a student", () => {
    expect(
      alumniSchema.safeParse({ ...base, batchYear: CURRENT_YEAR + 1 }).success,
    ).toBe(false);
  });

  it("accepts the current year", () => {
    expect(
      alumniSchema.safeParse({ ...base, batchYear: CURRENT_YEAR }).success,
    ).toBe(true);
  });

  it("refuses a batch before 1950", () => {
    expect(alumniSchema.safeParse({ ...base, batchYear: 1949 }).success).toBe(
      false,
    );
  });

  it("refuses a profile with neither a phone nor an email", () => {
    const result = alumniSchema.safeParse({
      name: "Farhana Akter",
      batchYear: 2015,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/nobody can reach/);
    }
  });

  it("accepts an email-only profile", () => {
    expect(
      alumniSchema.safeParse({
        name: "Farhana Akter",
        batchYear: 2015,
        email: "f@example.com",
      }).success,
    ).toBe(true);
  });
});

describe("alumniEventSchema", () => {
  const base = { title: "Golden Jubilee Reunion", eventDate: "2026-12-20" };

  it("accepts a free event with no fee at all", () => {
    expect(alumniEventSchema.safeParse(base).success).toBe(true);
  });

  it("accepts an event priced at zero — not the same as free", () => {
    expect(alumniEventSchema.safeParse({ ...base, fee: 0 }).success).toBe(true);
  });

  it("refuses a deadline after the event", () => {
    const result = alumniEventSchema.safeParse({
      ...base,
      registrationDeadline: "2026-12-25",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/after the event/);
    }
  });

  it("accepts a deadline on the day itself", () => {
    expect(
      alumniEventSchema.safeParse({
        ...base,
        registrationDeadline: "2026-12-20",
      }).success,
    ).toBe(true);
  });
});

describe("donationSchema — roadmap §7's amount rule", () => {
  const base = {
    donorName: "Karim Traders",
    amount: 5000,
    method: "CASH" as const,
  };

  it("accepts a real donation", () => {
    expect(donationSchema.safeParse(base).success).toBe(true);
  });

  it("refuses zero — it would print a receipt saying nothing was received", () => {
    expect(donationSchema.safeParse({ ...base, amount: 0 }).success).toBe(false);
  });

  it("refuses a negative amount", () => {
    expect(donationSchema.safeParse({ ...base, amount: -100 }).success).toBe(
      false,
    );
  });

  it("accepts one paisa", () => {
    expect(donationSchema.safeParse({ ...base, amount: 0.01 }).success).toBe(
      true,
    );
  });
});

describe("cancelDonationSchema — the only correction a receipt has", () => {
  it("demands a reason", () => {
    expect(cancelDonationSchema.safeParse({ reason: "" }).success).toBe(false);
    expect(cancelDonationSchema.safeParse({ reason: "ok" }).success).toBe(false);
    expect(
      cancelDonationSchema.safeParse({ reason: "Entered twice by mistake" })
        .success,
    ).toBe(true);
  });
});
