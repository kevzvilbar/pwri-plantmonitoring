import { test, expect } from '@playwright/test';

test.describe('Import Page', () => {
  test('renders the import page with a dropzone and no crash', async ({ page }) => {
    await page.goto('/import');

    // Page heading — SmartImportPanel renders a card or title
    await expect(page.locator('text=/import/i').first()).toBeVisible({ timeout: 15_000 });

    // Dropzone is present — SmartImportPanel uses a DropZone component with a file input
    const dropzone = page.locator('label:has-text("CSV"), input[type="file"], [class*="dropzone"], [class*="drop-zone"]');
    await expect(dropzone.first()).toBeVisible({ timeout: 10_000 });

    // Page title or instruction text confirms the module loaded
    const instruction = page.locator('text=/Pick an import type/i, text=/CSV File Upload/i, text=/Smart import/i');
    await expect(instruction.first()).toBeVisible({ timeout: 10_000 });
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
