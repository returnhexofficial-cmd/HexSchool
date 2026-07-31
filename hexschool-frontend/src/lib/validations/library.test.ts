import { describe, expect, it } from "vitest";
import {
  bookSchema,
  generateCopiesSchema,
  isbnChecksumOk,
  markCopySchema,
  returnFormSchema,
  splitAuthorNames,
  waiveFineSchema,
} from "./library";

describe("isbnChecksumOk", () => {
  it.each(["0306406152", "080442957X", "9780306406157", "978-0-306-40615-7"])(
    "accepts %s",
    (value) => {
      expect(isbnChecksumOk(value)).toBe(true);
    },
  );

  /** One transposed digit is exactly what a checksum exists to catch. */
  it.each(["0306460152", "9780306046157", "030640615", "97803064061570"])(
    "rejects %s",
    (value) => {
      expect(isbnChecksumOk(value)).toBe(false);
    },
  );
});

describe("bookSchema", () => {
  const valid = {
    title: "Physics for Class 9",
    categoryId: "11111111-1111-4111-8111-111111111111",
  };

  it("accepts a title and a category", () => {
    expect(bookSchema.safeParse(valid).success).toBe(true);
  });

  /**
   * Most of a BD school library has no ISBN at all — locally printed
   * guides, donated older editions — so blank must stay legal.
   */
  it.each([undefined, ""])("treats %p as 'no ISBN'", (isbn) => {
    expect(bookSchema.safeParse({ ...valid, isbn }).success).toBe(true);
  });

  it("rejects an ISBN whose check digit is wrong", () => {
    const result = bookSchema.safeParse({ ...valid, isbn: "0306460152" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/check digit/i);
    }
  });

  it("requires a category", () => {
    expect(bookSchema.safeParse({ title: "Physics" }).success).toBe(false);
  });
});

describe("generateCopiesSchema", () => {
  it("accepts a normal batch", () => {
    expect(generateCopiesSchema.safeParse({ count: 12 }).success).toBe(true);
  });

  it("refuses zero and a batch past the server's cap", () => {
    expect(generateCopiesSchema.safeParse({ count: 0 }).success).toBe(false);
    expect(generateCopiesSchema.safeParse({ count: 201 }).success).toBe(false);
  });
});

describe("markCopySchema", () => {
  it("demands a reason for a write-off", () => {
    expect(
      markCopySchema.safeParse({ status: "LOST", reason: "ab" }).success,
    ).toBe(false);
    expect(
      markCopySchema.safeParse({
        status: "LOST",
        reason: "Reported missing by the student",
      }).success,
    ).toBe(true);
  });

  it("does not offer AVAILABLE as a write-off target", () => {
    expect(
      markCopySchema.safeParse({ status: "AVAILABLE", reason: "back" }).success,
    ).toBe(false);
  });
});

describe("waiveFineSchema", () => {
  /** `chk_book_issues_waiver_evidence` refuses one without a reason. */
  it("demands a reason", () => {
    expect(waiveFineSchema.safeParse({ amount: 20 }).success).toBe(false);
    expect(
      waiveFineSchema.safeParse({ amount: 20, reason: "Bus strike" }).success,
    ).toBe(true);
  });
});

describe("returnFormSchema", () => {
  it("accepts a plain return", () => {
    expect(returnFormSchema.safeParse({}).success).toBe(true);
  });

  it("demands a reason when the fine is set by hand", () => {
    const result = returnFormSchema.safeParse({ fineOverride: 5 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["fineReason"]);
    }
  });

  it("accepts a hand-set fine that explains itself", () => {
    expect(
      returnFormSchema.safeParse({
        fineOverride: 5,
        fineReason: "Waived four days for the strike",
      }).success,
    ).toBe(true);
  });

  /** Zero is a real override — "no fine, and here is why". */
  it("still demands a reason for a zero override", () => {
    expect(returnFormSchema.safeParse({ fineOverride: 0 }).success).toBe(false);
  });
});

describe("splitAuthorNames", () => {
  it("splits, trims and drops the blanks", () => {
    expect(splitAuthorNames(" Humayun Ahmed , Zafar Iqbal ,, ")).toEqual([
      "Humayun Ahmed",
      "Zafar Iqbal",
    ]);
  });

  it("returns nothing for an empty box", () => {
    expect(splitAuthorNames(undefined)).toEqual([]);
    expect(splitAuthorNames("   ")).toEqual([]);
  });

  it("caps at the ten the API accepts", () => {
    const many = Array.from({ length: 15 }, (_, i) => `A${i}`).join(", ");
    expect(splitAuthorNames(many)).toHaveLength(10);
  });
});
