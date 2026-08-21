import { test, expect, waitForAdminShell } from "../support/auth";

/**
 * Runtime guard for the finding that keeps coming back: **F9 → F18 → F24**.
 *
 * The product stores UTC and displays Asia/Dhaka in DD/MM/YYYY. Three times
 * now a screen has shown a reader the machine form instead — `2026-08-17` in a
 * table cell, `admitted 2026-01-05T00:00:00.000Z` in a header, `Convert
 * 2026-08-17 to a holiday` in a dialog. Each time it was a *different* shape,
 * so each time the source guard missed it and a person had to notice.
 *
 * `no-unlocalised-dates.test.ts` now knows four shapes and greps for all of
 * them. This is the complement it cannot be: it does not care how the string
 * was produced, only that no ISO date is **on screen**. A fifth shape nobody
 * has thought of still fails here.
 *
 * Deliberately not a general "no ISO anywhere" rule — see the exclusions.
 */

/** `2026-08-17` or `2026-08-17T…`, as rendered text. */
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?\b/g;

/**
 * Pages worth scanning: one per shape of date rendering — list, detail header,
 * dialog-bearing tool, report, and a public page.
 */
const PAGES = [
  "/admin/students",
  "/admin/attendance/leaves",
  "/admin/attendance/reports",
  "/admin/calendar",
  "/admin/admissions",
  "/admin/promotions",
  "/admin/audit-logs",
  // Added after `{row.effectiveFrom}` rendered a raw ISO instant here and
  // slipped past every name-based rule in the source guard — the field ends in
  // neither `Date` nor `At`. This sweep does not need to know the name.
  "/admin/timetables",
];

/**
 * Text that legitimately contains something ISO-shaped.
 *
 * `<input type="date">` renders its value in the machine format by definition,
 * and the browser paints it per the *viewer's* locale regardless — it is not
 * ours to format. Everything else on screen is.
 */
async function visibleTextOutsideDateInputs(page: {
  evaluate: <T>(fn: () => T) => Promise<T>;
}): Promise<string> {
  return page.evaluate(() => {
    const main = document.querySelector("main");
    if (!main) return "";
    const clone = main.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll('input[type="date"], input[type="datetime-local"], time')
      .forEach((el) => el.remove());
    return clone.innerText;
  });
}

test.describe("no ISO dates are rendered to a reader", () => {
  for (const path of PAGES) {
    test(`${path} shows dates in DD/MM/YYYY`, async ({ page, signIn }) => {
      await signIn("admin");
      await page.goto(path);
      await waitForAdminShell(page);
      // Let the first data query resolve; an empty page proves nothing.
      await page.waitForLoadState("networkidle");

      const text = await visibleTextOutsideDateInputs(page);
      const hits = [...text.matchAll(ISO_DATE)].map((m) => m[0]);

      expect(
        hits,
        `${path} rendered ${hits.length} ISO-formatted date(s): ${hits
          .slice(0, 5)
          .join(", ")}. The product displays Asia/Dhaka DD/MM/YYYY — wrap them ` +
          `in formatDate from @/lib/utils/date (QA findings F9, F18, F24).`,
      ).toEqual([]);
    });
  }

  test("the ISO pattern matches what it claims to", async () => {
    // Two ways this suite could pass while blind: a page that rendered nothing
    // (covered below), and a regex that matches nothing (covered here).
    for (const bad of [
      "admitted 2026-01-05T00:00:00.000Z",
      "17/08/2026 → 2026-08-18",
      "Convert 2026-08-17 to a holiday",
    ]) {
      expect([...bad.matchAll(ISO_DATE)].length).toBeGreaterThan(0);
    }
    for (const good of ["17/08/2026", "1 Jan 2014", "BDT 1,250.00", "2026"]) {
      expect([...good.matchAll(ISO_DATE)]).toHaveLength(0);
    }
  });

  test("the sweep can actually see a date on the page it scans", async ({
    page,
    signIn,
  }) => {
    // Without this the suite would pass just as happily against blank pages.
    await signIn("admin");
    await page.goto("/admin/students");
    await waitForAdminShell(page);
    await page.waitForLoadState("networkidle");

    const text = await visibleTextOutsideDateInputs(page);
    expect(text, "students list rendered no rows to check").toMatch(
      /\d{2}\/\d{2}\/\d{4}/,
    );
  });
});
