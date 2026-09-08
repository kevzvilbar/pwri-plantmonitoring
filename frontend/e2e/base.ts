import { test as base, devices, type PlaywrightTestConfig } from '@playwright/test';

// Local Supabase instance (started by supabase start in CI)
// URL: http://localhost:54321
// Anon key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0

// Test credentials (seeded by supabase/e2e-seed.sql)
export const E2E_EMAIL = process.env.E2E_EMAIL ?? 'e2e-operator@test.local';
export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'testpassword123';
export const E2E_MANAGER_EMAIL = process.env.E2E_MANAGER_EMAIL ?? 'e2e-manager@test.local';
export const E2E_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@test.local';
export const HAS_CREDENTIALS = Boolean(E2E_EMAIL && E2E_PASSWORD);

const config: PlaywrightTestConfig = {
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
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
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
    },
  },
};

export const test = base.extend<{
  context: any;
}>({});

export default config;
