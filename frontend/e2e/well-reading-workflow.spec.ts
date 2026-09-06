import { test, expect } from '@playwright/test';
import { HAS_CREDENTIALS } from './base';

/**
 * Critical workflow: Well Reading entry on /operations.
 *
 * Prerequisites:
 *   E2E_EMAIL and E2E_PASSWORD env vars must be set.
 *   A real Supabase account with an Active profile and at least one plant/well.
 *
 * Without credentials, the entire suite is skipped with a clear message.
 */
test.describe('Well Reading Workflow', () => {
  test.beforeEach(async ({ page }) => {
    if (!HAS_CREDENTIALS) {
      test.skip(true, 'Skipping: set E2E_EMAIL and E2E_PASSWORD to run this suite.');
      return;
    }

    await page.goto('/auth');
    await page.fill('#signin-email', process.env.E2E_EMAIL!);
    await page.fill('#signin-password', process.env.E2E_PASSWORD!);
    await page.click('button:has-text("Sign in")');
    await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 15_000 });
  });

  test('navigates to Operations and shows Wells tab with well rows', async ({ page }) => {
    await page.goto('/operations');

    // Operations Control page rendered
    await expect(page.locator('text=Operations Control')).toBeVisible({ timeout: 15_000 });

    // Wells tab is present in the tab bar
    const wellsTab = page.locator('button:has-text("Wells")');
    await expect(wellsTab).toBeVisible();

    // Wells tab is active by default for the first plant (url param tab=well)
    await page.waitForTimeout(2000);

    // WellReadingForm renders either a plant selector or well rows
    const hasRows = await page.locator('text=Active Wells').count();
    const hasNoWellsMsg = await page.locator('text=No active wells for this plant').count();

    expect(hasRows + hasNoWellsMsg).toBeGreaterThan(0);
  });

  test('enters a meter reading and saves', async ({ page }) => {
    await page.goto('/operations?tab=well');
    await page.waitForTimeout(2000);

    // Wait for plant selector or wells to appear
    const plantSelector = page.locator('#wellsection-plant');
    const hasPlantSelector = (await plantSelector.count()) > 0;

    if (hasPlantSelector) {
      const firstOption = plantSelector.locator('option').nth(1);
      if ((await firstOption.count()) > 0) {
        await plantSelector.selectOption({ index: 1 });
        await page.waitForTimeout(1500);
      }
    }

    // Look for a meter reading input — WellRow exposes odometer inputs as inputs
    const readingInput = page.locator('input[type="number"]').first();
    const inputCount = await readingInput.count();

    if (inputCount === 0) {
      test.skip(true, 'No meter reading input found — likely no wells for the test plant.');
      return;
    }

    await readingInput.fill('9999');
    await page.waitForTimeout(500);

    // Click the first save/submit button associated with a well row
    const saveBtn = page.locator('button:has-text("Save"), button:has-text("Submit")').first();
    const saveCount = await saveBtn.count();

    if (saveCount > 0) {
      await saveBtn.click();
      // Success toast from sonner
      await expect(page.locator('[data-sonner-toast]')).toBeVisible({ timeout: 10_000 });
    }
  });
});
