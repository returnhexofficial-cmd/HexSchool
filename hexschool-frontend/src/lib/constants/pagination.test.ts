import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { MAX_PAGE_LIMIT } from "./pagination";

/**
 * Source guard for QA finding **F31**.
 *
 * Every list endpoint validates `limit` with `@Max(100)`. Asking for more is
 * **not clamped** — it is a 400, and a picker whose query 400s renders as an
 * empty select with no error anywhere the user can see. Fourteen call sites
 * asked for 200 or 300, so those controls had never worked:
 *
 *  - the routine builder's "combined with" section picker (how a school tells
 *    the conflict checker that two sections legitimately share a teacher);
 *  - the **promotion wizard's target sections**, on both its pages;
 *  - the assignment, inventory, library and alumni pickers.
 *
 * The bug is silent by construction, which is why it needs a test rather than
 * a review: nothing is thrown, nothing is logged in the UI, and an empty
 * dropdown looks exactly like a school that has not set anything up yet.
 */

const SRC = path.resolve(__dirname, "../..");

const ALLOWED = [
  path.join("lib", "constants", "pagination.ts"),
  path.join("lib", "constants", "pagination.test.ts"),
];

/** A numeric `limit:` literal, so the value can be compared to the cap. */
const LIMIT_LITERAL = /\blimit:\s*(\d+)/g;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("list limits stay within what the API accepts", () => {
  it("no request asks for more than MAX_PAGE_LIMIT", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      if (ALLOWED.some((a) => file.endsWith(a))) continue;
      const text = fs.readFileSync(file, "utf8");
      for (const match of text.matchAll(LIMIT_LITERAL)) {
        if (Number(match[1]) <= MAX_PAGE_LIMIT) continue;
        const line = text.slice(0, match.index).split("\n").length;
        offenders.push(
          `${path.relative(SRC, file).replace(/\\/g, "/")}:${line} — ${match[0]}`,
        );
      }
    }

    expect(
      offenders,
      `The API rejects any limit above ${MAX_PAGE_LIMIT} with a 400, and the ` +
        `control silently renders empty. Use MAX_PAGE_LIMIT, or paginate:\n` +
        offenders.map((o) => `    · ${o}`).join("\n"),
    ).toEqual([]);
  });

  it("matches the backend's cap", () => {
    // If the backend raises or lowers MAX_PAGE_LIMIT, this file must follow —
    // the two constants are a contract, not a coincidence.
    const backend = fs.readFileSync(
      path.resolve(
        SRC,
        "../../hexschool-backend/src/common/dto/pagination-query.dto.ts",
      ),
      "utf8",
    );
    const declared = /export const MAX_PAGE_LIMIT = (\d+);/.exec(backend);
    expect(declared, "backend no longer declares MAX_PAGE_LIMIT").not.toBeNull();
    expect(Number(declared![1])).toBe(MAX_PAGE_LIMIT);
  });

  it("the guard matches an over-limit literal and not a legal one", () => {
    expect([..."{ limit: 200 }".matchAll(LIMIT_LITERAL)][0]?.[1]).toBe("200");
    expect(
      [..."{ limit: 20 }".matchAll(LIMIT_LITERAL)].filter(
        (m) => Number(m[1]) > MAX_PAGE_LIMIT,
      ),
    ).toHaveLength(0);
  });
});
