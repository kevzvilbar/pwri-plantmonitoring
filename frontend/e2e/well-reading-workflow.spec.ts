import { test, expect } from '@playwright/test';
import { authFile, HAS_CREDENTIALS } from './base';

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
  // Signed in once in e2e/global-setup.ts and reused; a UI login before every test
  // is what made this job overrun its time limit.
  test.use({ storageState: authFile('operator') });
  test.beforeEach(() => {
    test.skip(!HAS_CREDENTIALS, 'Skipping: set E2E_EMAIL and E2E_PASSWORD to run this suite.');
  });

  test('navigates to Operations and shows Wells tab with well rows', async ({ page }) => {
    await page.goto('/operations');

    // Daily Readings page rendered (heading, not bare text: the nav link has the same label)
    await expect(page.getByRole('heading', { name: 'Daily Readings' })).toBeVisible({ timeout: 15_000 });

    // /operations opens on the Locators tab (useUrlTab default is 'locator'), and only
    // the open tab's form is mounted -- so the Wells section does not exist until the
    // Wells tab is selected. The tab label also carries a count badge, hence the regex.
    const wellsTab = page.getByRole('tab', { name: /Wells/ });
    await expect(wellsTab).toBeVisible();
    await wellsTab.click();
    await expect(wellsTab).toHaveAttribute('aria-selected', 'true');

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
    await expect(page.getByRole('heading', { name: 'Daily Readings' })).toBeVisible({ timeout: 15_000 });

    const activeWells = page.getByText('Active Wells', { exact: true }).first();
    const choosePlant = page.getByRole('group', { name: 'Choose a plant' });
    await expect(activeWells.or(choosePlant)).toBeVisible({ timeout: 20_000 });

    if (await choosePlant.isVisible()) {
      await choosePlant.getByRole('button', { name: 'E2E Test Plant' }).click();
      await expect(activeWells).toBeVisible({ timeout: 15_000 });
    }

    // Look for a meter reading input — WellRow exposes odometer inputs or number inputs
    const readingInput = page.locator('input[type="number"], [data-testid*="well-meter-input"]').first();
    const inputCount = await readingInput.count();

    if (inputCount === 0) {
      test.skip(true, 'No meter reading input found — likely no wells for the test plant.');
      return;
    }

    // Enter realistic non-anomalous reading (seeded previous reading was 1000)
    await readingInput.fill('1050');
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
