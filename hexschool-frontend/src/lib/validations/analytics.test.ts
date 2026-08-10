import { describe, expect, it } from "vitest";
import {
  describeCron,
  nextRun,
  parseCron,
  scheduleSchema,
} from "./analytics";

/**
 * The client cron reader is a **duplicate of the server's parser**, and
 * these tests are what make the duplication safe: they assert the same
 * rules the backend `cron.engine.spec.ts` asserts, so a divergence shows
 * up here rather than as a form that accepts something the API refuses.
 */

const dhaka = (iso: string) => new Date(`${iso}+06:00`);

describe("parseCron — the §7 whitelist, mirrored", () => {
  it("refuses a wildcard minute", () => {
    expect(parseCron("* * * * *").ok).toBe(false);
  });

  it("refuses a stepped, listed or ranged minute", () => {
    expect(parseCron("*/5 * * * *").ok).toBe(false);
    expect(parseCron("0,30 * * * *").ok).toBe(false);
    expect(parseCron("0-30 * * * *").ok).toBe(false);
  });

  it("accepts a single literal minute", () => {
    expect(parseCron("35 * * * *").ok).toBe(true);
  });

  it("refuses the wrong field count, six included", () => {
    expect(parseCron("0 0 7 * * *").ok).toBe(false);
    expect(parseCron("0 7 * *").ok).toBe(false);
    expect(parseCron("").ok).toBe(false);
  });

  it("expands ranges, lists and steps", () => {
    const result = parseCron("0 8-10 1,15 */3 *");
    expect(result.fields?.hours).toEqual([8, 9, 10]);
    expect(result.fields?.daysOfMonth).toEqual([1, 15]);
    expect(result.fields?.months).toEqual([1, 4, 7, 10]);
  });

  it("rejects out-of-range and backwards values", () => {
    expect(parseCron("0 24 * * *").ok).toBe(false);
    expect(parseCron("0 7 32 * *").ok).toBe(false);
    expect(parseCron("0 7 * * 7").ok).toBe(false);
    expect(parseCron("0 10-8 * * *").ok).toBe(false);
  });
});

describe("nextRun — the same Dhaka arithmetic as the server", () => {
  it("fires at the Dhaka hour", () => {
    expect(nextRun("0 7 * * *", dhaka("2026-08-10T06:00:00"))?.toISOString()).toBe(
      "2026-08-10T01:00:00.000Z",
    );
  });

  it("is strictly after the given instant", () => {
    const at = dhaka("2026-08-10T07:00:00");
    expect(nextRun("0 7 * * *", at)?.getTime()).toBeGreaterThan(at.getTime());
  });

  it("ORs both day fields when both are restricted (Vixie)", () => {
    expect(
      nextRun("0 7 1 * 1", dhaka("2026-08-10T09:00:00"))
        ?.toISOString()
        .slice(0, 10),
    ).toBe("2026-08-17");
  });

  it("returns null for an expression that can never fire", () => {
    expect(nextRun("0 9 30 2 *", dhaka("2026-08-10T09:00:00"))).toBeNull();
  });

  it("returns null rather than throwing on nonsense", () => {
    expect(nextRun("nonsense")).toBeNull();
  });
});

describe("describeCron", () => {
  it("reads a daily schedule back", () => {
    expect(describeCron("0 7 * * *")).toBe("At 07:00 (Asia/Dhaka) every day");
  });

  it("reads a weekly and a monthly one", () => {
    expect(describeCron("30 6 * * 1")).toBe(
      "At 06:30 (Asia/Dhaka) every Monday",
    );
    expect(describeCron("0 7 22 * *")).toBe(
      "At 07:00 (Asia/Dhaka) on the 22nd",
    );
  });

  it("is null when it cannot parse, so the field can say so", () => {
    expect(describeCron("*/5 * * * *")).toBeNull();
  });
});

describe("scheduleSchema", () => {
  const valid = {
    reportCode: "fee.dues",
    name: "Monthly dues",
    cron: "0 7 1 * *",
    format: "XLSX" as const,
    emails: "head@school.test, accounts@school.test",
  };

  it("accepts a well-formed schedule and splits the recipients", () => {
    const parsed = scheduleSchema.parse(valid);
    expect(parsed.emails).toEqual(["head@school.test", "accounts@school.test"]);
  });

  it("refuses a sub-hourly cron before the request is made", () => {
    const result = scheduleSchema.safeParse({ ...valid, cron: "*/5 * * * *" });
    expect(result.success).toBe(false);
  });

  it("refuses a cron that can never fire", () => {
    const result = scheduleSchema.safeParse({ ...valid, cron: "0 9 30 2 *" });
    expect(result.success).toBe(false);
  });

  it("refuses a schedule with nobody to send to", () => {
    // Otherwise the report is generated and nobody is told.
    expect(scheduleSchema.safeParse({ ...valid, emails: "" }).success).toBe(
      false,
    );
    expect(scheduleSchema.safeParse({ ...valid, emails: "  ,  " }).success).toBe(
      false,
    );
  });

  it("refuses a malformed address in the list", () => {
    const result = scheduleSchema.safeParse({
      ...valid,
      emails: "head@school.test, not-an-email",
    });
    expect(result.success).toBe(false);
  });

  it("accepts newline-separated recipients", () => {
    const parsed = scheduleSchema.parse({
      ...valid,
      emails: "a@school.test\nb@school.test",
    });
    expect(parsed.emails).toHaveLength(2);
  });

  it("demands a name", () => {
    expect(scheduleSchema.safeParse({ ...valid, name: "x" }).success).toBe(
      false,
    );
  });
});
