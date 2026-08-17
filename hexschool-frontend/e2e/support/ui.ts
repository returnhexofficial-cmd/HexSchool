import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Small UI helpers that encode this app's specific quirks, so every spec does
 * not rediscover them.
 */

/**
 * Read a sonner toast.
 *
 * Toasts render **outside** `<form>`, in the root layout, and auto-dismiss in
 * roughly 4 seconds — so a spec that navigates first and looks second finds
 * nothing.
 */
export async function expectToast(page: Page, match: RegExp): Promise<void> {
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: match });
  await expect(toast).toBeVisible({ timeout: 4_000 });
}

/**
 * Wait for a `<Can>`-gated control.
 *
 * QA finding F5: gated controls mount only after `/auth/me` resolves, so the
 * table can be on screen while the actions are still absent. Waiting on the
 * table and then asserting the button is a race that fails intermittently —
 * always wait on the gated control itself.
 */
export async function waitForGatedControl(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible({ timeout: 15_000 });
}

/**
 * Every list page ships the same furniture, per the roadmap's Global
 * Conventions: search, filters, pagination, sorting, CSV/XLSX export, loading
 * skeleton, empty state, error state. This asserts the parts that are visible
 * without data-dependent setup, so each module's charter gets them for free.
 */
export async function expectStandardListChrome(page: Page): Promise<void> {
  await expect(page.locator('table')).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole('button', { name: /export/i }).first(),
  ).toBeVisible();
}

/**
 * Assert a date cell is not a raw ISO-8601 timestamp.
 *
 * QA finding F9: the students list printed `2014-01-01T00:00:00.000Z` in the
 * Date of Birth column. Dates are stored UTC and must display in Asia/Dhaka,
 * and a `@db.Date` field has no time component to show at all.
 */
export const RAW_ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

export function expectNoRawTimestamps(text: string): void {
  expect(
    text,
    'a raw ISO-8601 timestamp leaked into the UI — dates must be formatted for display',
  ).not.toMatch(RAW_ISO_TIMESTAMP);
}

/**
 * The message `apiErrorMessage()` falls back to when a response does not carry
 * the standard error envelope. Seeing it in the UI means the envelope contract
 * was broken, not that the user did something wrong.
 */
export const ENVELOPE_FALLBACK = /Something went wrong\. Please try again\./;

export async function expectNoEnvelopeFallback(page: Page): Promise<void> {
  await expect(
    page.getByText(ENVELOPE_FALLBACK),
    'the generic API fallback message appeared — the response was missing the standard error envelope',
  ).toHaveCount(0);
}
