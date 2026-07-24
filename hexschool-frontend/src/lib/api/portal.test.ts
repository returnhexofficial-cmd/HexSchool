import { describe, expect, it } from "vitest";
import { formatBDT } from "./portal";

describe("portal formatBDT (Module 18)", () => {
  it("prefixes the taka sign", () => {
    expect(formatBDT(1500).startsWith("৳")).toBe(true);
  });

  it("renders zero without decimals", () => {
    expect(formatBDT(0)).toBe("৳0");
  });

  it("keeps up to two decimals", () => {
    expect(formatBDT(1234.5)).toContain("1,234.5");
  });

  it("groups large amounts (grouping separators present)", () => {
    // ICU grouping style is locale/build-dependent; just assert a
    // separator appears somewhere in a 7-digit number.
    expect(formatBDT(1500000)).toMatch(/[,\s]/);
  });
});
