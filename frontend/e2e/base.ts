import process from 'node:process';
import { test as base, devices, type Page, type PlaywrightTestConfig } from '@playwright/test';

// Local Supabase instance (started by supabase start in CI)
// URL: http://localhost:54321
// Anon key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0

// Test credentials (seeded by supabase/e2e-seed.sql)
export const E2E_EMAIL = process.env.E2E_EMAIL ?? 'e2e-operator@test.local';
export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'testpassword123';
export const E2E_MANAGER_EMAIL = process.env.E2E_MANAGER_EMAIL ?? 'e2e-manager@test.local';
export const E2E_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@test.local';
export const HAS_CREDENTIALS = Boolean(process.env.E2E_EMAIL && process.env.E2E_PASSWORD);

export async function signIn(page: Page, email = E2E_EMAIL, password = E2E_PASSWORD) {
  // Ensure Admin MFA prompt is skipped in E2E tests
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem('pwri-admin-mfa-skipped', '1');
    } catch (_err) {
      // Ignored in restricted environments
    }
  });

  await page.goto('/auth');
  await page.fill('#signin-email', email);
  await page.fill('#signin-password', password);
  // Target the form submit button
  await page.click('button[type="submit"]:has-text("Sign in")');

  // Handle potential multi-operator pick or MFA skip prompts
  const pickOperator = page.locator('button:has-text("@")').first();
  const skipMfaBtn = page.locator('button:has-text("Skip for now")');

  try {
    await Promise.race([
      page.waitForURL((url) => !/\/auth\/?$/.test(url.pathname), { timeout: 20_000 }),
      pickOperator.waitFor({ state: 'visible', timeout: 5_000 }).then(async () => {
        await pickOperator.click();
        await page.waitForURL((url) => !/\/auth\/?$/.test(url.pathname), { timeout: 20_000 });
      }),
      skipMfaBtn.waitFor({ state: 'visible', timeout: 5_000 }).then(async () => {
        await skipMfaBtn.click();
        await page.waitForURL((url) => !/\/auth\/?$/.test(url.pathname), { timeout: 20_000 });
      }),
    ]);
  } catch {
    if (await skipMfaBtn.isVisible().catch(() => false)) {
      await skipMfaBtn.click();
    } else if (await pickOperator.isVisible().catch(() => false)) {
      await pickOperator.click();
    }
    await page.waitForURL((url) => !/\/auth\/?$/.test(url.pathname), { timeout: 20_000 }).catch(() => {});
  }
}

const config: PlaywrightTestConfig = {
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: process.env.CI ? 1 : undefined,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : [['list']],
  use: {
    baseURL: 'http://localhost:5000',
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
    command: 'npm run dev',
    url: 'http://localhost:5000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? 'http://localhost:54321',
      VITE_SUPABASE_PUBLISHABLE_KEY: process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
      E2E_ROOT_BASE: '1',
    },
  },
};

export const test = base.extend<{
  context: any;
}>({});

export default config;
