import { test as base, type Page, type BrowserContext } from '@playwright/test';
import { API_URL, BASE_URL } from '../../playwright.config';
import { SESSION_HINT_COOKIE } from '../../src/lib/utils/session-cookie';

/**
 * Per-test sign-in.
 *
 * **Why not `storageState`?** The usual Playwright pattern — sign in once in a
 * setup project, reuse the saved cookies everywhere — does not work against
 * this app, and the failure is silent and destructive:
 *
 *  - refresh tokens **rotate**: every cold page load spends the presented
 *    token and is issued a new one;
 *  - Playwright builds a fresh context per test, so every test replays the
 *    *same* saved snapshot;
 *  - from test 2 onward that token is already revoked, which is
 *    indistinguishable from theft — the backend's reuse detection revokes
 *    **every session for that user** and the test lands on `/login`.
 *
 * So each test signs in for itself. It costs about a second, and it is only
 * practical because the QA backend runs with `AUTH_THROTTLE_ENABLED=false`
 * (the 5/min credential limit otherwise refuses the burst).
 */

export const QA_PASSWORD = process.env.QA_PASSWORD ?? 'QaPass123!';

export type QaLogin =
  | 'admin'
  | 'principal'
  | 'accountant'
  | 'librarian'
  | 'teacher'
  | 'teacher2'
  | 'student'
  | 'parent'
  | 'office'
  | 'admissions'
  | 'viceprincipal';

export const qaEmail = (role: QaLogin): string => `${role}@qa.hexschool.local`;

/**
 * Sign in through the API and hand the cookies to the browser context.
 *
 * Faster than driving the login form, and it leaves the app to bootstrap
 * exactly as it does for a returning user: the httpOnly refresh cookie mints
 * an access token on first load.
 */
export async function loginAs(
  context: BrowserContext,
  role: QaLogin,
): Promise<void> {
  const res = await context.request.post(`${API_URL}/auth/login`, {
    data: { identifier: qaEmail(role), password: QA_PASSWORD },
  });

  if (!res.ok()) {
    throw new Error(
      `Sign-in failed for ${qaEmail(role)}: ${res.status()} ${await res.text()}\n` +
        `Is the QA seed loaded (npm run seed:qa) and is the backend running ` +
        `with AUTH_THROTTLE_ENABLED=false?`,
    );
  }

  // `context.request` shares the context's cookie jar, so the httpOnly
  // `hs_refresh` cookie the API set is already stored.
  //
  // But `hs_session` is **not** set by the API — the browser sets it after a
  // successful login (`setSessionHint` in src/lib/utils/session-cookie.ts).
  // It is the non-sensitive hint that `proxy.ts` uses for its optimistic
  // route guard, so without it every /admin and /portal navigation redirects
  // straight to /login and the session never gets a chance to bootstrap.
  const body = (await res.json()) as { data?: { user?: { userType?: string } } };
  const userType = body.data?.user?.userType;
  if (!userType) {
    throw new Error(
      `Login response for ${qaEmail(role)} carried no user.userType; ` +
        `cannot set the ${SESSION_HINT_COOKIE} hint cookie.`,
    );
  }

  // `domain` + `path` rather than `url` — Playwright rejects both together.
  const { hostname } = new URL(BASE_URL);
  await context.addCookies([
    {
      name: SESSION_HINT_COOKIE,
      value: encodeURIComponent(userType),
      domain: hostname,
      path: '/',
      sameSite: 'Lax',
    },
  ]);
}

type AuthFixtures = {
  /** Sign in as `role`, then navigate. Call at the top of a test. */
  signIn: (role: QaLogin) => Promise<void>;
};

export const test = base.extend<AuthFixtures>({
  signIn: async ({ context }, use) => {
    await use((role: QaLogin) => loginAs(context, role));
  },
});

export { expect } from '@playwright/test';

/** Wait for the admin shell to finish hydrating before asserting on it. */
export async function waitForAdminShell(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Dashboard' }).waitFor({
    state: 'visible',
    timeout: 20_000,
  });
}
