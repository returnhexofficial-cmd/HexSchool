import { describe, expect, it } from "vitest";
import { conflictsFromError } from "./timetable";

/**
 * The 409 contract: the backend refuses a conflicting grid as a block and
 * ships the offending cells in the error envelope. If this extraction
 * breaks the builder degrades to a bare toast with no red cells, so the
 * shape is worth pinning.
 */
describe("conflictsFromError", () => {
  const conflict = {
    kind: "TEACHER" as const,
    day: "SAT" as const,
    slotId: "slot-1",
    sectionId: "sec-1",
    message: "Mr X is busy in Class 7 — B",
  };

  it("reads the conflicts out of the error envelope", () => {
    const err = {
      response: {
        data: {
          success: false,
          error: {
            code: "CONFLICT",
            message: "1 scheduling conflict(s) — nothing was saved",
            details: { conflicts: [conflict] },
          },
        },
      },
    };
    expect(conflictsFromError(err)).toEqual([conflict]);
  });

  it("returns an empty list for a conflict-free error", () => {
    const err = {
      response: {
        data: { success: false, error: { code: "BAD_REQUEST", message: "no" } },
      },
    };
    expect(conflictsFromError(err)).toEqual([]);
  });

  it("survives a network error with no response at all", () => {
    expect(conflictsFromError(new Error("Network Error"))).toEqual([]);
    expect(conflictsFromError(undefined)).toEqual([]);
    expect(conflictsFromError(null)).toEqual([]);
  });

  it("ignores a details payload of the wrong shape", () => {
    const err = {
      response: {
        data: { error: { details: { conflicts: "not-an-array" } } },
      },
    };
    expect(conflictsFromError(err)).toEqual([]);
  });
});
