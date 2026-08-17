import { test, expect, waitForAdminShell } from './support/auth';
import { watchPageHealth } from './support/console-guard';
import { expectNoRawTimestamps, expectNoEnvelopeFallback } from './support/ui';

/**
 * Harness smoke test. If this fails, nothing else in the suite is meaningful —
 * check QA_RUNBOOK.md at the repo root before debugging an individual spec.
 */

test.describe('harness smoke', () => {
  test.beforeEach(async ({ signIn }) => {
    await signIn('admin');
  });

  test('the admin shell loads with a hydrated session', async ({ page }) => {
    const health = watchPageHealth(page);

    await page.goto('/admin');
    await waitForAdminShell(page);

    // The sidebar only renders its permission-gated items once /auth/me has
    // resolved, so their presence proves the session really did hydrate.
    await expect(page.getByRole('link', { name: 'Students' })).toBeVisible();

    health.assertClean();
  });

  test('the QA seed is present and the session switcher is on the QA session', async ({
    page,
  }) => {
    await page.goto('/admin/students');

    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(12, { timeout: 20_000 });
    await expect(page.getByText(/QA-\d{4}-0001/)).toBeVisible();

    // Session-scoped pages must read the switcher rather than resolving
    // "current" independently. The switcher is a shadcn select trigger, not a
    // plain button, so match on its text rather than an ARIA role.
    await expect(
      page.getByText(/QA \d{4} \(current\)/).first(),
    ).toBeVisible();
  });

  test('dynamic [param] routes resolve — regression guard for F1', async ({
    page,
  }) => {
    // A stale .next once made every dynamic route 404, hiding ~19 detail pages
    // for a whole QA round. Cheap to assert, expensive to rediscover.
    await page.goto('/admin/roles');
    const firstRoleLink = page.locator('tbody tr a').first();
    await expect(firstRoleLink).toBeVisible({ timeout: 20_000 });
    await firstRoleLink.click();

    // Generous timeout: against a cold `next dev` Turbopack compiles the
    // `[id]` route on first navigation, which comfortably exceeds the default
    // 10 s. A slow first compile is not the failure this test is looking for —
    // a 404 is.
    await expect(page).toHaveURL(/\/admin\/roles\/[0-9a-f-]{36}/, {
      timeout: 60_000,
    });
    await expect(page.getByText(/Permissions/).first()).toBeVisible();
    await expect(page.getByText(/could not find that page/i)).toHaveCount(0);
  });

  test('the students list formats dates — regression guard for F9', async ({
    page,
  }) => {
    await page.goto('/admin/students');
    await expect(page.locator('tbody tr').first()).toBeVisible({
      timeout: 20_000,
    });

    expectNoRawTimestamps(await page.locator('table').innerText());
    await expectNoEnvelopeFallback(page);
  });
});
