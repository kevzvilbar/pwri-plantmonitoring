import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config — roadmap Phase 2 ("add an E2E smoke test").
 *
 * Scope is deliberately tiny: ONE smoke test that proves the deployed app
 * shell boots, the router works, and an unauthenticated visitor is routed
 * to the sign-in screen. This is the tripwire for the failure class that
 * unit tests structurally can't catch: a broken build artifact, a runtime
 * crash before any component renders, a router regression that blanks the
 * page. Deeper flows (login → data entry) need a seeded staging Supabase
 * and are explicitly out of scope here — see docs/STAGING.md for the
 * environment they'd run against.
 *
 * The dev server (vite.config.ts: port 5000, base /pwri-plantmonitoring/)
 * is started automatically via webServer, locally and in CI. No Supabase
 * instance is needed: with no stored session, useAuth resolves without a
 * network call and ProtectedRoute redirects to /auth; the sign-in screen
 * renders its form regardless of whether background API calls fail.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://localhost:5000',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5000/pwri-plantmonitoring/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
