import { test, expect } from '@playwright/test';
import { authFile, HAS_CREDENTIALS } from './base';

test.describe('Import Page', () => {
  // Signed in once in e2e/global-setup.ts and reused; a UI login before every test
  // is what made this job overrun its time limit.
  // Admin, not the default Operator: /import isn't in OPERATOR_ALLOWED_PATHS.
  test.use({ storageState: authFile('admin') });
  test.beforeEach(() => {
    test.skip(!HAS_CREDENTIALS, 'Skipping: set E2E_EMAIL and E2E_PASSWORD to run this suite.');
  });
  test('renders the import page with a dropzone and no crash', async ({ page }) => {
    await page.goto('/import');

    // Page heading — SmartImportPanel renders a card or title
    await expect(page.locator('text=/import/i').first()).toBeVisible({ timeout: 15_000 });

    // Dropzone is present — SmartImportPanel uses a DropZone component with a file input
    const dropzone = page.locator('label:has-text("CSV"), input[type="file"], [class*="dropzone"], [class*="drop-zone"]');
    await expect(dropzone.first()).toBeVisible({ timeout: 10_000 });

    // Page title or instruction text confirms the module loaded
    // (`text=/a/i, text=/b/i` is not a selector list -- use a single regex.)
    await expect(page.getByRole('heading', { name: /Smart Multi-Import Studio/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('CSV File Upload', { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test('no crash when navigating away and back', async ({ page }) => {
    await page.goto('/import');
    await expect(page.locator('text=/import/i').first()).toBeVisible({ timeout: 15_000 });

    await page.goto('/');
    await expect(page.locator('text=Dashboard').first()).toBeVisible({ timeout: 15_000 });

    await page.goto('/import');
    await expect(page.locator('text=/import/i').first()).toBeVisible({ timeout: 15_000 });
  });
});
