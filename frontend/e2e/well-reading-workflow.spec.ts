import { test, expect } from '@playwright/test';
import { signIn, HAS_CREDENTIALS } from './base';

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

    await signIn(page);
  });

  test('navigates to Operations and shows Wells tab with well rows', async ({ page }) => {
    await page.goto('/operations');

    // Daily Readings page rendered (heading, not bare text: the nav link has the same label)
    await expect(page.getByRole('heading', { name: 'Daily Readings' })).toBeVisible({ timeout: 15_000 });

    // Wells tab is present in the tab bar
    const wellsTab = page.locator('button:has-text("Wells")');
    await expect(wellsTab).toBeVisible();

    // The Wells section needs an active plant. An Operator with exactly one plant gets
    // it automatically; with several, ActivePlantChip shows a 'Choose a plant' prompt.
    // Wait for whichever appears (auto-retrying) instead of counting once after a
    // fixed sleep -- the plant list loads asynchronously and the dev server is cold.
    const activeWells = page.getByText('Active Wells', { exact: true }).first();
    const choosePlant = page.getByRole('group', { name: 'Choose a plant' });
    await expect(activeWells.or(choosePlant)).toBeVisible({ timeout: 20_000 });

    if (await choosePlant.isVisible()) {
      await choosePlant.getByRole('button', { name: 'E2E Test Plant' }).click();
    }

    await expect(activeWells).toBeVisible({ timeout: 15_000 });
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
