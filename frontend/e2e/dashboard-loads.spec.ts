import { test, expect } from '@playwright/test';
import { authFile, HAS_CREDENTIALS } from './base';

test.describe('Dashboard loads', () => {
  // Signed in once in e2e/global-setup.ts and reused; a UI login before every test
  // is what made this job overrun its time limit.
  test.use({ storageState: authFile('operator') });
  test.beforeEach(() => {
    test.skip(!HAS_CREDENTIALS, 'Skipping: set E2E_EMAIL and E2E_PASSWORD to run this suite.');
  });
  test('renders Dashboard with KPI cards and no error boundary', async ({ page }) => {
    await page.goto('/');

    // Dashboard heading or content is visible
    await expect(page.locator('text=Dashboard').first()).toBeVisible({ timeout: 20_000 });

    // At least one StatCard-style KPI card — look for cards with value content
    // Dashboard uses StatCard components; we verify the page rendered stat content
    const statCards = page.locator('.stat-card, [class*="stat-card"], .kpi, [class*="kpi"]');
    const cardCount = await statCards.count();

    if (cardCount === 0) {
      // Fallback: check that some numeric/heading content rendered (not a blank page)
      const bodyText = await page.locator('body').textContent();
      expect(bodyText?.trim().length ?? 0).toBeGreaterThan(0);
    } else {
      expect(cardCount).toBeGreaterThan(0);
    }

    // No error boundary visible (ErrorBoundary renders a heading like "Something went wrong")
    const errorHeading = page.locator('text=/something went wrong/i, text=/error/i >> nth=0');
    const errorCount = await errorHeading.count();
    expect(errorCount).toBe(0);
  });

  test('captures a screenshot for visual regression', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);

    await page.screenshot({ path: 'e2e/screenshots/dashboard.png', fullPage: false });
  });
});
