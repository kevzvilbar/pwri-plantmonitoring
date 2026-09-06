import { test, expect } from '@playwright/test';

/**
 * E2E smoke — roadmap Phase 2. Deliberately asserts the minimum that
 * proves "the app boots and routes" without depending on copy, themes,
 * or a live backend:
 *
 *   1. index.html serves and mounts React (title from index.html),
 *   2. ProtectedRoute redirects an anonymous visitor to /auth,
 *   3. the sign-in form actually renders its email + password fields.
 *
 * Failure of any of these has historically been indistinguishable from
 * "works on my machine" — a blank preview URL. Kept independent of
 * element copy so an innocuous label change can't break CI.
 */
test('app shell boots and an anonymous visitor lands on the sign-in screen', async ({ page }) => {
  await page.goto('/');

  // index.html mounted and React Router took over (Vite's base-path
  // redirect lands the initial "/" visit on /pwri-plantmonitoring/).
  await expect(page).toHaveTitle(/PWRI Monitoring/i);

  // No stored session → useAuth finishes loading → ProtectedRoute
  // navigates to /auth (under the app's basename).
  await expect(page).toHaveURL(/\/auth$/, { timeout: 20_000 });

  // The sign-in form rendered its credential fields.
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
});
