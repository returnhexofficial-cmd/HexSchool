import { defineConfig, devices } from '@playwright/test';

/**
 * Browser-QA suite. Complements — does not replace — the backend Jest e2e
 * suites: those prove API contracts, these prove the app behaves in Chromium.
 *
 * Prerequisites (see QA_RUNBOOK.md at the repo root):
 *   docker compose up -d postgres redis minio mailpit   # never a bare `up -d`
 *   DATABASE_URL=…5433/smis npm run seed:qa             # a login per role
 *   DATABASE_URL=…5433/smis AUTH_THROTTLE_ENABLED=false npm run start
 *   npm run dev                                         # frontend on :3000
 *
 * `AUTH_THROTTLE_ENABLED=false` is not optional: every test signs in for
 * itself (see e2e/support/auth.ts for why storageState cannot be reused
 * against rotating refresh tokens), and the 5/min per-IP credential limit
 * would refuse the burst.
 *
 * There is deliberately **no `webServer`**. Both servers are long-running and
 * started by hand, exactly as the backend e2e suites expect, and a QA round
 * routinely restarts one without wanting to tear down the other.
 */

export const BASE_URL = process.env.QA_BASE_URL ?? 'http://localhost:3000';
export const API_URL = process.env.QA_API_URL ?? 'http://localhost:5007/api/v1';

export default defineConfig({
  testDir: './e2e',
  // Keep traces, videos and failure screenshots out of the repo root — they are
  // large, numerous and gitignored, and scattering them makes the tree noisy.
  outputDir: './e2e/.artifacts',
  // The suite mutates a shared database, so parallel workers would race on
  // roll numbers, sequence counters and the single is_current session — the
  // same reason the backend e2e config pins maxWorkers to 1.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // The app stores UTC and displays Asia/Dhaka. Pinning the browser clock
    // stops "passes at 14:00, fails at 19:00" — which PROJECT_CONTEXT §18
    // records as having broken the backend suite four separate times.
    timezoneId: 'Asia/Dhaka',
    locale: 'en-US',
  },

  projects: [
    {
      name: 'public',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /public\/.*\.spec\.ts/,
    },
    {
      name: 'qa',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /(modules|journeys)\/.*\.spec\.ts|smoke\.spec\.ts/,
    },
    {
      name: 'sweeps',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /sweeps\/.*\.spec\.ts/,
    },
  ],
});
