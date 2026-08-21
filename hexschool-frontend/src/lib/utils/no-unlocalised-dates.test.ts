import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Source guard for the QA finding F18 class.
 *
 * The product stores UTC and must display **Asia/Dhaka** in DD/MM/YYYY
 * (roadmap Global Conventions). A bare `new Date(x).toLocaleDateString()` uses
 * whatever locale the *viewer's machine* is set to, so the same row reads
 * `8/18/2026` for one user and `18/08/2026` for another — and near midnight
 * they disagree about the day.
 *
 * This was found twice: once as F9 (raw ISO in the students list) and again as
 * F18 (27 call sites across 20 files). A unit test is the cheapest layer that
 * catches the third time, because the mistake is invisible on a machine whose
 * locale happens to be en-GB.
 *
 * Use `formatDate` / `formatDateTime` / `formatDateLong` from `./date` instead.
 */

const SRC = path.resolve(__dirname, "../..");

/** `date.ts` documents the banned call in prose, and its tests assert on it. */
const ALLOWED = [
  path.join("lib", "utils", "date.ts"),
  path.join("lib", "utils", "date.test.ts"),
  path.join("lib", "utils", "no-unlocalised-dates.test.ts"),
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** A Date formatted with no locale argument — the machine-dependent form. */
const UNLOCALISED =
  /new Date\([^()]*(?:\([^()]*\)[^()]*)*\)\s*\.\s*toLocale(?:Date|Time)?String\(\s*\)/g;

/**
 * The *other* half of the same bug: a date-shaped value dropped straight into
 * prose. `admitted ${s.admissionDate}` renders
 * `admitted 2026-01-05T00:00:00.000Z` to a user expecting `05/01/2026`.
 *
 * F9 was exactly this shape in the students list. It came back in the students
 * detail header and three exam screens (finding F24) because the guard above
 * only knew about `toLocaleDateString()` — a call that never happens here.
 *
 * Restricted to template literals whose *static* text contains a space, i.e.
 * prose meant for a human. React-query keys and ISO construction interpolate
 * the very same fields — `` `${id}:${updatedAt}` ``,
 * `` `${values.startAt}T00:00:00.000Z` `` — and are not display strings.
 */
const TEMPLATE_LITERAL = /`[^`]*`/g;
const DATE_FIELD = /\$\{([^{}]*\b\w*(?:Date|At)\b[^{}]*)\}/g;
/** *Every* interpolation, not just the date-shaped ones — see `isProse`. */
const ANY_INTERPOLATION = /\$\{[^{}]*\}/g;

/**
 * Already routed through a display helper. `format*` covers the shared ones;
 * `*Relative` covers the per-module "in 3 days" renderers, which are a
 * deliberate choice rather than a raw value.
 */
function formatted(expr: string): boolean {
  return (
    /\b(?:format\w*|\w+Relative)\s*\(/i.test(expr) ||
    // A calendar year is not a date — `© ${new Date().getFullYear()}`.
    /\bgetFullYear\s*\(\s*\)/.test(expr)
  );
}

/**
 * The third shape, and the widest: `row.dueDate.slice(0, 10)`.
 *
 * Truncating an ISO instant has exactly one honest purpose — producing the
 * `YYYY-MM-DD` an `<input type="date">` needs — and that purpose now has a
 * name, `isoDateInput`. So the raw idiom is banned outright rather than
 * guessed at: all 17 remaining uses were table cells and captions showing a
 * reader `2026-08-17` where the product shows `17/08/2026`.
 *
 * They survived the F18 codemod because they call no formatter, and survived
 * the prose rule above because a JSX expression is not a template literal.
 * Three shapes of one bug, three rules.
 */
const ISO_TRUNCATION = /\b\w*(?:Date|At)\b\s*\.\s*slice\(\s*0\s*,\s*10\s*\)/g;

/**
 * The fourth shape: a date interpolated into **JSX text** rather than into a
 * template literal — `<DialogTitle>Convert {date} to a holiday</DialogTitle>`,
 * which rendered `Convert 2026-08-17 to a holiday`.
 *
 * Two things defeat the prose rule here. JSX text is not a template literal,
 * and the variable is called plainly `date`, so a `Date`-suffix pattern never
 * sees it — and widening that pattern case-insensitively is not an option,
 * because it would flag `update`, `candidate` and `validate`.
 *
 * So this rule keys on **position** rather than name: an interpolation sitting
 * between two runs of element text that contain letters. That is a sentence a
 * user reads, whatever the variable happens to be called. An attribute such as
 * `value={date}` has no surrounding text and is not matched.
 */
const JSX_TEXT_INTERPOLATION =
  />([^<>{}]*[A-Za-z][^<>{}]*)\{\s*([^{}]+?)\s*\}([^<>{}]*[A-Za-z][^<>{}]*)</g;
/**
 * Bare `date`, the `…Date`/`…At` shapes the other rules know, and the
 * range-boundary names — `effectiveFrom`, `validUntil`.
 *
 * `day` is deliberately **not** here: a routine grid renders `{day}` as a
 * weekday name, and flagging it would train the reader to ignore this test.
 *
 * That last group was added after `{row.effectiveFrom}` rendered
 * `2026-08-18T00:00:00.000Z` into the routines table and slipped past all four
 * rules, because the name ends in neither `Date` nor `At`. It is a reminder of
 * what a name-based guard can and cannot do — which is why
 * `e2e/sweeps/dates.spec.ts` checks the rendered page instead, and caught this
 * class of thing without knowing any names at all.
 */
const DATE_EXPR = /^(?:date|[\w.]*(?:Date|At|From|Until|Till))$/;

/**
 * An interpolation that is an element's **only** child — `<TableCell>{x}</…>`.
 * A table cell is a display string even though it has no prose around it, so
 * the positional rule above cannot see it; this one relies on the name.
 */
const JSX_SOLE_CHILD = />\s*\{\s*([^{}]+?)\s*\}\s*</g;

/**
 * Static text only. Interpolations must *all* be stripped first: an unrelated
 * one such as `${pad(d.getMonth() + 1)}` contains a space and would otherwise
 * make an ISO-construction literal look like a sentence.
 */
function isProse(literal: string): boolean {
  return / /.test(literal.replace(ANY_INTERPOLATION, ""));
}

describe("no unlocalised date formatting", () => {
  it("every date is formatted through lib/utils/date", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      if (ALLOWED.some((a) => file.endsWith(a))) continue;
      const text = fs.readFileSync(file, "utf8");
      for (const match of text.matchAll(UNLOCALISED)) {
        const line = text.slice(0, match.index).split("\n").length;
        offenders.push(
          `${path.relative(SRC, file).replace(/\\/g, "/")}:${line} — ${match[0]}`,
        );
      }
    }

    expect(
      offenders,
      "These render dates in the viewer's machine locale instead of Asia/Dhaka " +
        "DD/MM/YYYY. Use formatDate/formatDateTime from @/lib/utils/date:\n" +
        offenders.map((o) => `    · ${o}`).join("\n"),
    ).toEqual([]);
  });

  it("the guard actually matches the shape it is meant to catch", () => {
    // Without this, a broken regex would make the test above vacuously pass.
    const sample = `const x = new Date(row.createdAt).toLocaleDateString();`;
    expect(sample.match(UNLOCALISED)).not.toBeNull();

    // …and must not flag a correctly localised call, or a number.
    const ok = `
      new Date(a).toLocaleDateString("en-GB", { timeZone: "Asia/Dhaka" });
      total.toLocaleString();
    `;
    expect(ok.match(UNLOCALISED)).toBeNull();
  });

  it("no date-shaped value is interpolated into prose unformatted", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      if (ALLOWED.some((a) => file.endsWith(a))) continue;
      const text = fs.readFileSync(file, "utf8");

      for (const literal of text.matchAll(TEMPLATE_LITERAL)) {
        if (!isProse(literal[0])) continue;

        for (const interp of literal[0].matchAll(DATE_FIELD)) {
          if (formatted(interp[1])) continue;
          const line = text.slice(0, literal.index).split("\n").length;
          offenders.push(
            `${path.relative(SRC, file).replace(/\\/g, "/")}:${line} — ${interp[0]}`,
          );
        }
      }
    }

    expect(
      offenders,
      "These print a raw API date into a sentence a user reads. Wrap them in " +
        "formatDate/formatDateTime from @/lib/utils/date:\n" +
        offenders.map((o) => `    · ${o}`).join("\n"),
    ).toEqual([]);
  });

  it("no ISO instant is truncated for display", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      if (ALLOWED.some((a) => file.endsWith(a))) continue;
      const text = fs.readFileSync(file, "utf8");
      for (const match of text.matchAll(ISO_TRUNCATION)) {
        const line = text.slice(0, match.index).split("\n").length;
        offenders.push(
          `${path.relative(SRC, file).replace(/\\/g, "/")}:${line} — ${match[0]}`,
        );
      }
    }

    expect(
      offenders,
      "These show a reader the ISO form. Use formatDate to display, or " +
        'isoDateInput when feeding an <input type="date">:\n' +
        offenders.map((o) => `    · ${o}`).join("\n"),
    ).toEqual([]);
  });

  it("no date is interpolated bare into JSX text", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      if (ALLOWED.some((a) => file.endsWith(a))) continue;
      const text = fs.readFileSync(file, "utf8");
      for (const match of text.matchAll(JSX_TEXT_INTERPOLATION)) {
        const expr = match[2];
        if (!DATE_EXPR.test(expr)) continue;
        const line = text.slice(0, match.index).split("\n").length;
        offenders.push(
          `${path.relative(SRC, file).replace(/\\/g, "/")}:${line} — {${expr}}`,
        );
      }
    }

    expect(
      offenders,
      "These drop a raw date into a sentence in JSX. Wrap them in formatDate:\n" +
        offenders.map((o) => `    · ${o}`).join("\n"),
    ).toEqual([]);
  });

  it("no date is an element's only content, unformatted", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      if (ALLOWED.some((a) => file.endsWith(a))) continue;
      const text = fs.readFileSync(file, "utf8");
      for (const match of text.matchAll(JSX_SOLE_CHILD)) {
        const expr = match[1];
        if (!DATE_EXPR.test(expr)) continue;
        const line = text.slice(0, match.index).split("\n").length;
        offenders.push(
          `${path.relative(SRC, file).replace(/\\/g, "/")}:${line} — {${expr}}`,
        );
      }
    }

    expect(
      offenders,
      "A date is the whole content of an element here, so it is a display " +
        "string. Wrap it in formatDate:\n" +
        offenders.map((o) => `    · ${o}`).join("\n"),
    ).toEqual([]);
  });

  it("the JSX rule reads position, not variable names", () => {
    // A sentence: text, interpolation, text.
    const sentence = ">Convert {date} to a holiday<";
    const hits = [...sentence.matchAll(JSX_TEXT_INTERPOLATION)]
      .map((m) => m[2])
      .filter((e) => DATE_EXPR.test(e));
    expect(hits).toEqual(["date"]);

    // An attribute is not a sentence — no surrounding text to sit between.
    expect([...'<input value={date} />'.matchAll(JSX_TEXT_INTERPOLATION)]).toHaveLength(0);

    // And the name filter must not swallow ordinary words containing "date".
    for (const notADate of ["update", "candidate", "validate", "count"]) {
      expect(DATE_EXPR.test(notADate)).toBe(false);
    }
    for (const isADate of [
      "date",
      "leave.fromDate",
      "row.issuedAt",
      "row.effectiveFrom",
    ]) {
      expect(DATE_EXPR.test(isADate)).toBe(true);
    }

    // `day` is excluded on purpose: a routine grid renders it as SUNDAY.
    expect(DATE_EXPR.test("day")).toBe(false);
  });

  it("the prose guard separates display strings from keys", () => {
    const bad = "`${s.studentUid} · admitted ${s.admissionDate}`";
    expect(isProse(bad)).toBe(true);
    expect([...bad.matchAll(DATE_FIELD)].filter((m) => !formatted(m[1]))).toHaveLength(1);

    // A react-query key and an ISO-construction literal must NOT be flagged —
    // neither has a space in its static text.
    for (const ok of [
      "`${role.id}:${role.updatedAt}`",
      "`${values.startAt}T00:00:00.000Z`",
    ]) {
      expect(isProse(ok)).toBe(false);
    }

    // The ISO-truncation rule catches the shape that started this.
    expect("{leave.fromDate.slice(0, 10)}".match(ISO_TRUNCATION)).not.toBeNull();
    expect("total.slice(0, 10)".match(ISO_TRUNCATION)).toBeNull();
    expect("isoDateInput(cycle.startAt)".match(ISO_TRUNCATION)).toBeNull();

    // …and prose that is already formatted is allowed.
    const good = "`due ${formatDate(a.dueAt)} today`";
    expect(isProse(good)).toBe(true);
    expect([...good.matchAll(DATE_FIELD)].every((m) => formatted(m[1]))).toBe(true);

    // A copyright year is prose, but a year is not a date.
    const year = "`© ${new Date().getFullYear()} HexSchool`";
    expect(isProse(year)).toBe(true);
    expect([...year.matchAll(DATE_FIELD)].every((m) => formatted(m[1]))).toBe(true);

    // An ISO string built for an <input type="datetime-local"> is not prose,
    // even though one of its other interpolations contains a space.
    const iso = "`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`";
    expect(isProse(iso)).toBe(false);
  });
});
