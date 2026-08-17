import { test } from '../support/auth';
import { expectNoA11yViolations, scanA11y } from '../support/a11y';

/**
 * Accessibility sweep of the admin panel.
 *
 * The public site holds Lighthouse A11y 100 (M19). The admin panel — where
 * staff actually spend the day — has never been measured. This walks the busiest
 * surfaces and blocks on serious/critical violations.
 *
 * One route per shape rather than all 33 admin areas: a list page, a detail page
 * with tabs, an editable grid, a form-heavy settings page, a calendar, and a
 * dashboard. Violations are overwhelmingly components, not routes, so covering
 * each *kind* of page finds them without a 33-route runtime.
 */

const ADMIN_ROUTES: Array<{ path: string; shape: string }> = [
  { path: '/admin', shape: 'dashboard' },
  { path: '/admin/students', shape: 'list + filters + export' },
  { path: '/admin/sessions', shape: 'list with row actions' },
  { path: '/admin/structure/classes', shape: 'master list' },
  { path: '/admin/calendar', shape: 'month grid' },
  { path: '/admin/settings/profile', shape: 'form + file upload' },
  { path: '/admin/settings/grading', shape: 'editable grid' },
  { path: '/admin/roles', shape: 'list feeding a detail page' },
  { path: '/admin/audit-logs', shape: 'dense read-only table' },
];

test.describe('admin panel accessibility', () => {
  test.beforeEach(async ({ signIn }) => {
    await signIn('admin');
  });

  for (const { path, shape } of ADMIN_ROUTES) {
    test(`${path} (${shape}) has no serious or critical violations`, async ({
      page,
    }) => {
      await page.goto(path);
      // Wait for the shell so the scan sees hydrated, permission-gated markup
      // rather than a skeleton (F5).
      await page.getByRole('link', { name: 'Dashboard' }).waitFor({
        state: 'visible',
        timeout: 20_000,
      });

      const result = await expectNoA11yViolations(page, path);

      // Advisory findings are recorded, not failed — see support/a11y.ts.
      if (result.advisory.length > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `  ${path} advisory: ` +
            result.advisory.map((v) => `${v.id}(${v.nodes})`).join(', '),
        );
      }
    });
  }
});

test.describe('public site accessibility', () => {
  // M19 measured this with Lighthouse and scored 100; axe checks a different
  // (overlapping) rule set, so it is worth its own pass — and it needs no login.
  for (const path of ['/', '/notices', '/admission/apply', '/login']) {
    test(`${path} has no serious or critical violations`, async ({ page }) => {
      await page.goto(path);
      await scanA11y(page); // warm, then assert
      await expectNoA11yViolations(page, path);
    });
  }
});
