import AxeBuilder from '@axe-core/playwright';
import { test } from '../support/auth';

/**
 * Diagnostic helper, not a gate: prints the offending markup for every axe
 * violation so a failure in `a11y.spec.ts` can be traced to a component.
 *
 * Run explicitly:
 *   npx playwright test e2e/sweeps/a11y-report.spec.ts --project=sweeps
 */
const ROUTES = [
  '/admin',
  '/admin/students',
  '/admin/fees',
  '/admin/settings/profile',
];

test.describe('a11y diagnostics', () => {
  // Opt-in: this prints, it never asserts, so in a normal run it is 30 seconds
  // of vacuous passes. Reach for it when a11y.spec.ts fails and you need to know
  // which element caused it.
  test.skip(
    !process.env.QA_A11Y_REPORT,
    'diagnostic only — set QA_A11Y_REPORT=1 to run',
  );

  test.beforeEach(async ({ signIn }) => {
    await signIn('admin');
  });

  for (const path of ROUTES) {
    test(`report ${path}`, async ({ page }) => {
      await page.goto(path);
      await page
        .getByRole('link', { name: 'Dashboard' })
        .waitFor({ state: 'visible', timeout: 20_000 });

      const results = await new AxeBuilder({ page })
        .disableRules(['region'])
        .exclude('#next-logo')
        .exclude('[data-nextjs-dev-tools-button]')
        .exclude('.tsqd-open-btn')
        .analyze();

      // eslint-disable-next-line no-console
      console.log(`\n===== ${path} =====`);
      for (const v of results.violations) {
        // eslint-disable-next-line no-console
        console.log(`\n[${v.impact}] ${v.id} — ${v.help}`);
        for (const node of v.nodes.slice(0, 4)) {
          // eslint-disable-next-line no-console
          console.log(`   target: ${node.target.join(' ')}`);
          // eslint-disable-next-line no-console
          console.log(`   html:   ${node.html.slice(0, 220)}`);
        }
      }
    });
  }
});
