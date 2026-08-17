import { test, expect, type QaLogin } from '../support/auth';
import { expectNoA11yViolations } from '../support/a11y';

/**
 * Permission sweep — the single highest-yield spec in the suite.
 *
 * Scenario M03-13 ("403 for a user lacking a permission") went unrun for the
 * entire project because the seed only ever created a SUPER_ADMIN, which
 * bypasses every check. With a login per role it becomes a data-driven sweep
 * over the route table.
 *
 * Three assertions per role:
 *   1. the sidebar shows only what the role's permissions allow;
 *   2. an allowed route renders its data;
 *   3. a forbidden route renders a refusal, not a working page (finding F8).
 */

const MATRIX: Array<{
  role: QaLogin;
  allowed: string[];
  forbidden: string[];
  hiddenNav: string[];
}> = [
  {
    role: 'librarian',
    allowed: ['/admin/library'],
    forbidden: ['/admin/roles', '/admin/audit-logs', '/admin/accounting'],
    hiddenNav: ['Roles & Permissions', 'Audit Logs', 'Accounting'],
  },
  {
    role: 'accountant',
    allowed: ['/admin/fees'],
    forbidden: ['/admin/roles', '/admin/audit-logs'],
    hiddenNav: ['Roles & Permissions', 'Audit Logs'],
  },
];

for (const { role, allowed, forbidden, hiddenNav } of MATRIX) {
  test.describe(`${role}`, () => {
    test.beforeEach(async ({ signIn }) => {
      await signIn(role);
    });

    test(`sidebar hides what ${role} may not do`, async ({ page }) => {
      await page.goto('/admin');
      // Wait for the gated menu to mount before asserting on absence,
      // otherwise everything is trivially absent (F5).
      await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible({
        timeout: 20_000,
      });

      for (const label of hiddenNav) {
        await expect(
          page.getByRole('link', { name: label, exact: true }),
          `${role} must not see the "${label}" menu item`,
        ).toHaveCount(0);
      }
    });

    for (const route of allowed) {
      test(`${role} can load ${route}`, async ({ page }) => {
        await page.goto(route);
        await expect(
          page.getByText(/don't have access to this page/i),
          `${route} should be allowed for ${role}`,
        ).toHaveCount(0);

        // The sweep already visits every route for every role, so scanning
        // here is close to free — and the admin panel has never been measured
        // for accessibility, unlike the public site.
        await expectNoA11yViolations(page, `${role} @ ${route}`);
      });
    }

    for (const route of forbidden) {
      test(`${role} is refused at ${route}`, async ({ page }) => {
        await page.goto(route);

        // F8: the route itself is now gated, so a forbidden page shows the
        // shared refusal instead of full chrome over an empty table.
        await expect(
          page.getByText(/don't have access to this page/i),
        ).toBeVisible({ timeout: 20_000 });

        // And it must not offer controls over data the user cannot read.
        await expect(
          page.getByRole('button', { name: /export/i }),
          `${route} must not render a working Export control for ${role}`,
        ).toHaveCount(0);
      });
    }
  });
}
