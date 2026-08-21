import { test, expect, waitForAdminShell } from "../support/auth";
import type { Page } from "@playwright/test";

/**
 * Module 12 — attendance marking.
 *
 * Covers the rules a browser can prove and a unit test cannot: that the sheet
 * opens on the **Dhaka** day rather than the UTC one, that the guards announce
 * themselves before the save rather than after it, and that a status set in
 * the grid survives a reload.
 *
 * The arithmetic lives in `calc/percentage.util.spec.ts` (finding F28) and the
 * entry guards are e2e-covered at the API; neither is repeated here.
 */

/** Dhaka is UTC+6 year-round, so today's local date is a fixed shift. */
function dhakaToday(): string {
  return new Date(Date.now() + 6 * 60 * 60_000).toISOString().slice(0, 10);
}

async function chooseClassAndSection(page: Page): Promise<void> {
  await page.locator("main [data-slot=select-trigger]:not([disabled])").first().click();
  await page.getByRole("option", { name: "QA Class 6" }).click();
  await page.locator("main [data-slot=select-trigger][data-placeholder]").click();
  await page.getByRole("option", { name: "A", exact: true }).click();
  await expect(page.locator("main table tbody tr").first()).toBeVisible();
}

test.describe("attendance marking", () => {
  test("opens on the Dhaka day, and refuses to look further ahead", async ({
    page,
    signIn,
  }) => {
    await signIn("admin");
    await page.goto("/admin/attendance");
    await waitForAdminShell(page);

    const date = page.locator("#attendance-date");
    // Between 18:00 and 24:00 UTC these differ — the window in which a
    // UTC-based default silently offers yesterday's sheet to a Dhaka user.
    await expect(date).toHaveValue(dhakaToday());
    await expect(date).toHaveAttribute("max", dhakaToday());
  });

  test("a weekly off-day is announced before anything is typed", async ({
    page,
    signIn,
  }) => {
    await signIn("admin");
    await page.goto("/admin/attendance");
    await waitForAdminShell(page);
    await chooseClassAndSection(page);

    // The most recent Friday, which `general.weekly_holidays` makes an off-day.
    const friday = new Date(`${dhakaToday()}T00:00:00Z`);
    friday.setUTCDate(friday.getUTCDate() - ((friday.getUTCDay() + 2) % 7));
    await page.locator("#attendance-date").fill(friday.toISOString().slice(0, 10));

    await expect(page.getByText(/is a holiday/i)).toBeVisible();
    await expect(page.getByText(/holiday-override permission/i)).toBeVisible();
  });

  test("the roster is session-scoped and keyed on enrolment", async ({
    page,
    signIn,
  }) => {
    await signIn("admin");
    await page.goto("/admin/attendance");
    await waitForAdminShell(page);

    // The page must read the selected session, never fetch "current" itself.
    await expect(page.getByText(/Mark daily attendance for QA 2026/)).toBeVisible();
    await chooseClassAndSection(page);

    const rows = page.locator("main table tbody tr");
    await expect(rows).toHaveCount(2);
    // Roll order, and the UID proves the row came from the enrolment spine.
    await expect(rows.first()).toContainText("QA-2026-0001");
  });

  test("statuses cycle through every value and wrap", async ({ page, signIn }) => {
    await signIn("admin");
    await page.goto("/admin/attendance");
    await waitForAdminShell(page);
    await chooseClassAndSection(page);

    const toggle = page.locator("main table tbody tr").first().locator("button").first();
    const seen: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      seen.push(((await toggle.textContent()) ?? "").trim());
      await toggle.click();
    }

    expect(seen).toEqual(["Present", "Absent", "Late", "Half day", "Present"]);
  });

  test("a saved sheet comes back marked, with its statuses intact", async ({
    page,
    signIn,
  }) => {
    await signIn("admin");
    await page.goto("/admin/attendance");
    await waitForAdminShell(page);
    await chooseClassAndSection(page);

    const firstToggle = page
      .locator("main table tbody tr")
      .first()
      .locator("button")
      .first();
    await firstToggle.click(); // Present → Absent
    await expect(firstToggle).toHaveText("Absent");

    await page.getByRole("button", { name: /Save attendance/i }).click();
    await expect(page.getByText(/Saved \d+ student/)).toBeVisible();

    await page.reload();
    await waitForAdminShell(page);
    await chooseClassAndSection(page);

    // Re-marking is an update, not a second row — the sheet says so, and the
    // unique index on (enrolment, date, period) enforces it.
    await expect(page.getByText(/already marked/i)).toBeVisible();
    await expect(
      page.locator("main table tbody tr").first().locator("button").first(),
    ).toHaveText("Absent");
  });
});
