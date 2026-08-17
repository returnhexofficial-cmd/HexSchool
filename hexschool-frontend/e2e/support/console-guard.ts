import type { Page, TestInfo } from '@playwright/test';

/**
 * Passive page-health guard: attach it once and every page a spec visits is
 * checked for console errors and failed requests. This catches a whole class
 * of bug on pages nobody wrote an assertion for.
 *
 * **The allow-list is the important part.** A naive "fail on any console.error
 * or any 4xx" guard fails *every* test in this app, because two things are
 * expected by design:
 *
 *  - **Bootstrap 401s** (QA finding F6). The access token lives in memory
 *    only, so every hard navigation fires its first queries with no token,
 *    takes a 401, refreshes, and retries. The page is healthy; the 401 is the
 *    handshake.
 *  - **403s a spec asked for.** Permission-boundary scenarios deliberately
 *    provoke refusals. Those specs opt out per-URL via `allowStatus`.
 *
 * Anything else — a 500, an unhandled rejection, a genuine React error — is a
 * real finding and fails the test.
 */

export type PageHealth = {
  /** Fail the test if anything was collected. Call at the end of a spec. */
  assertClean: (opts?: { allowStatus?: number[] }) => void;
  consoleErrors: string[];
  failedRequests: Array<{ url: string; status: number }>;
};

/** Requests that are allowed to fail without failing the test. */
const EXPECTED_FAILURES: Array<{ status: number; urlPattern: RegExp }> = [
  // F6 — cold-load handshake before the refresh interceptor catches up.
  { status: 401, urlPattern: /\/api\/v1\// },
];

/** Console noise that is not a defect. */
const IGNORED_CONSOLE = [
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /React DevTools/i,
  // The browser logs its own line for every failed response; the request
  // listener already records those with far more detail.
  /Failed to load resource/i,
];

export function watchPageHealth(page: Page, testInfo?: TestInfo): PageHealth {
  const consoleErrors: string[] = [];
  const failedRequests: Array<{ url: string; status: number }> = [];

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
    consoleErrors.push(text);
  });

  page.on('pageerror', (err) => {
    consoleErrors.push(`[pageerror] ${err.message}`);
  });

  page.on('response', (res) => {
    const status = res.status();
    if (status < 400) return;
    const url = res.url();
    if (
      EXPECTED_FAILURES.some(
        (e) => e.status === status && e.urlPattern.test(url),
      )
    ) {
      return;
    }
    failedRequests.push({ url, status });
  });

  const assertClean: PageHealth['assertClean'] = (opts = {}) => {
    const allow = new Set(opts.allowStatus ?? []);
    const requests = failedRequests.filter((r) => !allow.has(r.status));
    const problems: string[] = [];

    if (consoleErrors.length > 0) {
      problems.push(
        `console errors:\n${consoleErrors.map((e) => `    · ${e}`).join('\n')}`,
      );
    }
    if (requests.length > 0) {
      problems.push(
        `failed requests:\n${requests
          .map((r) => `    · ${r.status} ${r.url}`)
          .join('\n')}`,
      );
    }
    if (problems.length > 0) {
      throw new Error(
        `Page health check failed${testInfo ? ` in "${testInfo.title}"` : ''}:\n  ${problems.join('\n  ')}`,
      );
    }
  };

  return { assertClean, consoleErrors, failedRequests };
}
