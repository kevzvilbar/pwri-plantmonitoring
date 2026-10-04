import process from 'node:process';
import { test as base, devices, type Page, type PlaywrightTestConfig } from '@playwright/test';

// Local Supabase instance (started by supabase start in CI)
// URL: http://localhost:54321
// Anon key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0

export const BASE_URL = 'http://localhost:5000';

/**
 * The app's Content-Security-Policy (index.html) only allows `https://*.supabase.co`
 * in connect-src, so the browser REFUSES every request to the local Supabase stack
 * that CI starts (http://127.0.0.1:54321): sign-in fails with "violates the document's
 * Content Security Policy" and the page never leaves /auth. Tests are about app
 * behavior, not the CSP, so the test browser bypasses it -- but only for a plain-http
 * (local) Supabase. With an https Supabase URL (the smoke job's placeholder) the CSP
 * stays enforced, so the smoke test still catches a CSP that blanks the app.
 */
export const BYPASS_CSP = /^http:\/\//.test(process.env.VITE_SUPABASE_URL ?? 'http://localhost:54321');

// Test credentials (seeded by supabase/e2e-seed.sql)
export const E2E_EMAIL = process.env.E2E_EMAIL ?? 'e2e-operator@test.local';
export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'testpassword123';
export const E2E_MANAGER_EMAIL = process.env.E2E_MANAGER_EMAIL ?? 'e2e-manager@test.local';
export const E2E_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@test.local';
export const HAS_CREDENTIALS = Boolean(process.env.E2E_EMAIL && process.env.E2E_PASSWORD);

/**
 * Roles the suite signs in as. Each is signed in ONCE by e2e/global-setup.ts and
 * its session is saved to authFile(role); specs opt in with
 * `test.use({ storageState: authFile('admin') })` instead of logging in through
 * the UI before every test (that cost ~20 s per test and was the reason the
 * authenticated job overran its time limit).
 */
export type E2ERole = 'operator' | 'manager' | 'admin';
export const E2E_ROLES: ReadonlyArray<{ role: E2ERole; email: string }> = [
  { role: 'operator', email: E2E_EMAIL },
  { role: 'manager', email: E2E_MANAGER_EMAIL },
  { role: 'admin', email: E2E_ADMIN_EMAIL },
];
// Relative to the frontend/ working directory. Gitignored: it holds live session tokens.
export const authFile = (role: E2ERole) => `e2e/.auth/${role}.json`;

const isPastAuth = (url: URL) => !/\/auth\/?$/.test(url.pathname);

/**
 * Signs in through the real UI. Used by global-setup only -- specs reuse the
 * saved session. It fails fast, with the reason, instead of silently burning a
 * test timeout: an on-screen login error aborts immediately; otherwise it waits
 * up to SIGN_IN_TIMEOUT (generous on purpose -- this runs once per role, and a
 * slow shared CI runner is not a reason to fail).
 */
const SIGN_IN_TIMEOUT = 30_000;

export async function signIn(page: Page, email = E2E_EMAIL, password = E2E_PASSWORD) {
  await page.goto('/auth');
  await page.fill('#signin-email', email);
  await page.fill('#signin-password', password);
  // Target the form submit button (the "Sign in" tab trigger also matches has-text).
  await page.click('button[type="submit"]:has-text("Sign in")');

  // Three outcomes, raced: we leave /auth; an operator picker appears first (several
  // operators at the assigned plant); or the form reports an error. Each branch
  // resolves to a label instead of rejecting, so one branch timing out can't fail
  // the race while another is still on its way, and a losing branch can never
  // surface later as an unhandled rejection.
  const pickOperator = page.locator('button:has-text("@")').first();
  const errorToast = page.locator('[data-sonner-toast][data-type="error"]').first();
  const redirected = page
    .waitForURL(isPastAuth, { timeout: SIGN_IN_TIMEOUT })
    .then(() => 'redirected' as const, () => 'timeout' as const);
  const picker = pickOperator
    .waitFor({ state: 'visible', timeout: SIGN_IN_TIMEOUT })
    .then(() => 'picker' as const, () => 'timeout' as const);
  const failed = errorToast
    .waitFor({ state: 'visible', timeout: SIGN_IN_TIMEOUT })
    .then(() => 'error' as const, () => 'timeout' as const);

  const first = await Promise.race([redirected, picker, failed]);

  if (first === 'picker') {
    await pickOperator.click();
    await page.waitForURL(isPastAuth, { timeout: SIGN_IN_TIMEOUT });
    return;
  }
  if (first === 'error') {
    const message = (await errorToast.textContent())?.trim() || 'no message';
    throw new Error(`Sign-in as ${email} was rejected by the app: "${message}"`);
  }
  if (!isPastAuth(new URL(page.url()))) {
    throw new Error(
      `Sign-in as ${email} did not leave /auth within ${SIGN_IN_TIMEOUT / 1000}s (url: ${page.url()}).`,
    );
  }
}

const IS_CI = Boolean(process.env.CI);
// CI serves the production build with `vite preview` (see the E2E job in ci.yml).
// Local runs keep using the dev server so `npm run test:e2e` still works with no build.
const USE_PREVIEW = Boolean(process.env.E2E_PREVIEW);

const config: PlaywrightTestConfig = {
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  // Signs in once per role before any test runs; if that fails the run aborts in
  // seconds with a clear message instead of every test timing out separately.
  globalSetup: './e2e/global-setup.ts',
  // CI-only ceilings: a systemic failure must end in minutes, and always with a
  // report, rather than being cancelled by the job timeout (which skips the
  // report-upload step).
  globalTimeout: IS_CI ? 6 * 60_000 : 0,
  maxFailures: IS_CI ? 10 : 0,
  fullyParallel: true,
  retries: IS_CI ? 1 : 0,
  reporter: IS_CI
    ? [['list'], ['html', { open: 'never' }]]
    : [['list']],
  use: {
    baseURL: BASE_URL,
    // Make hangs fail at the step that hung (with a useful message) instead of
    // silently consuming the whole 30 s test timeout.
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // The built app registers a PWA service worker; keep tests deterministic.
    serviceWorkers: 'block',
    bypassCSP: BYPASS_CSP,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: USE_PREVIEW
      ? 'npm run preview -- --host 0.0.0.0 --port 5000 --strictPort'
      : 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !IS_CI,
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? 'http://localhost:54321',
      VITE_SUPABASE_PUBLISHABLE_KEY: process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
      // Serve from "/" (vite.config.ts picks '/pwri-plantmonitoring/' otherwise).
      // `vite preview` must see the same value the build used.
      E2E_ROOT_BASE: '1',
    },
  },
};

export const test = base.extend<{
  context: any;
}>({});

export default config;
