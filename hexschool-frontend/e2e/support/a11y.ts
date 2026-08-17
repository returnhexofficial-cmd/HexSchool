import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * Accessibility assertions for the admin panel.
 *
 * The public site scores Lighthouse A11y 100 (M19), but **the admin panel has
 * never been measured** — and it is where staff spend their whole day. The
 * permission sweep already walks role × route, so checking each page it visits
 * costs one call.
 *
 * Blocks on `serious` and `critical` only. `moderate`/`minor` are reported for
 * information: failing the suite on colour-contrast nits would make it noise
 * nobody reads, which is how a11y gates usually die.
 */

const BLOCKING = ['serious', 'critical'] as const;

/**
 * Rules disabled with a reason. Keep this list short and justified — an
 * unexplained exclusion is indistinguishable from a bug someone hid.
 */
const EXCLUDED_RULES: Array<{ id: string; why: string }> = [
  {
    id: 'region',
    why: 'Next.js dev-tools and the TanStack Query devtools button mount outside any landmark in dev builds; not app markup.',
  },
];

/**
 * Selectors excluded from the scan, each tied to an open finding.
 *
 * Excluding a *selector* rather than a *rule* is deliberate: dropping
 * `button-name` wholesale would also hide every future unlabelled button, which
 * is most of the value. Narrowing to the one known-bad component keeps the gate
 * live for everything else.
 *
 * **Delete an entry the moment its finding is fixed.**
 */
const KNOWN_ISSUE_SELECTORS: Array<{ selector: string; finding: string }> = [
  {
    // F13 — 420 SelectTrigger usages across 83 files, only 4 with an
    // accessible name. Systemic; needs a label-association decision, not 420
    // hand edits. Until then every a11y test would fail on the same defect.
    selector: '[data-slot="select-trigger"]',
    finding: 'F13',
  },
];

export type A11yResult = {
  blocking: Array<{ id: string; impact: string; nodes: number; help: string }>;
  advisory: Array<{ id: string; impact: string; nodes: number }>;
};

/** Run axe against the current page and return the findings, split by severity. */
export async function scanA11y(page: Page): Promise<A11yResult> {
  let builder = new AxeBuilder({ page })
    .disableRules(EXCLUDED_RULES.map((r) => r.id))
    // The dev overlays are not the application under test.
    .exclude('#next-logo')
    .exclude('[data-nextjs-dev-tools-button]')
    .exclude('.tsqd-open-btn');

  for (const { selector } of KNOWN_ISSUE_SELECTORS) {
    builder = builder.exclude(selector);
  }

  const results = await builder.analyze();

  const blocking = results.violations
    .filter((v) => BLOCKING.includes(v.impact as (typeof BLOCKING)[number]))
    .map((v) => ({
      id: v.id,
      impact: v.impact ?? 'unknown',
      nodes: v.nodes.length,
      help: v.help,
    }));

  const advisory = results.violations
    .filter((v) => !BLOCKING.includes(v.impact as (typeof BLOCKING)[number]))
    .map((v) => ({ id: v.id, impact: v.impact ?? 'unknown', nodes: v.nodes.length }));

  return { blocking, advisory };
}

/**
 * Assert a page has no serious or critical accessibility violations.
 * `label` names the page in the failure message — with a data-driven sweep the
 * test title alone often does not say which route broke.
 */
export async function expectNoA11yViolations(
  page: Page,
  label: string,
): Promise<A11yResult> {
  const result = await scanA11y(page);

  expect(
    result.blocking,
    `${label} has serious/critical accessibility violations:\n` +
      result.blocking
        .map((v) => `    · ${v.id} (${v.impact}, ${v.nodes} node(s)) — ${v.help}`)
        .join('\n'),
  ).toEqual([]);

  return result;
}
