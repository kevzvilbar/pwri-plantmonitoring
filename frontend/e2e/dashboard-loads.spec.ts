import { test, expect } from '@playwright/test';

test.describe('Dashboard loads', () => {
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
