import { chromium, type FullConfig } from '@playwright/test';
import fs from 'node:fs';
import { BASE_URL, BYPASS_CSP, E2E_ROLES, HAS_CREDENTIALS, authFile, confirmShiftHandover, signIn } from './base';

/**
 * Runs once before the suite (after the webServer is up): signs in as each seeded
 * role through the real UI and saves the session so specs can reuse it via
 * `test.use({ storageState: authFile(role) })`.
 *
 * - Without E2E_EMAIL / E2E_PASSWORD (smoke job, local runs) it writes empty
 *   state files and returns; the specs that need a login skip themselves.
 * - A failed login throws here, which aborts the whole run immediately with the
 *   reason, instead of every authenticated test timing out on its own.
 */
export default async function globalSetup(_config: FullConfig) {
  fs.mkdirSync('e2e/.auth', { recursive: true });

  if (!HAS_CREDENTIALS) {
    for (const { role } of E2E_ROLES) {
      fs.writeFileSync(authFile(role), JSON.stringify({ cookies: [], origins: [] }));
    }
    return;
  }

  const browser = await chromium.launch();
  try {
    for (const { role, email } of E2E_ROLES) {
      const context = await browser.newContext({ baseURL: BASE_URL, serviceWorkers: 'block', bypassCSP: BYPASS_CSP });
      const page = await context.newPage();
      const startedAt = Date.now();
      try {
        await signIn(page, email);
        if (role === 'operator') {
          // Operators get a blocking Shift Handover dialog in every fresh browser; confirming
          // it here stores the confirmation in the saved session (see base.ts for why it matters).
          await confirmShiftHandover(page);
        }
        if (role === 'admin') {
          await page.evaluate(() => {
            try {
              localStorage.setItem('pwri-admin-mfa-skipped', '1');
              sessionStorage.setItem('pwri-admin-mfa-skipped', '1');
            } catch {
              // Ignore in private browsing or restricted environments
            }
          });
        }
        await context.storageState({ path: authFile(role) });
        // Logged so CI shows how long a real login takes on that runner.
        console.log(`[e2e] signed in as ${role} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
      } catch (err) {
        fs.mkdirSync('test-results', { recursive: true });
        await page.screenshot({ path: `test-results/auth-setup-${role}.png` }).catch(() => {});
        throw new Error(`E2E auth setup failed for role "${role}": ${(err as Error).message}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}
