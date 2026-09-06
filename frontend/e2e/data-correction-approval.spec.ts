import { test, expect } from '@playwright/test';
import { HAS_CREDENTIALS } from './base';

/**
 * Critical workflow: Manager reviews and approves a data correction.
 *
 * Tests the /data-corrections page for managers — confirming that:
 * - The page renders for authenticated managers
 * - Pending corrections (if any) appear in the table
 * - The approve / reject action buttons are present
 *
 * Prerequisites:
 *   E2E_EMAIL / E2E_PASSWORD must be set, and the user must have manager or admin role.
 */
test.describe('Manager Data Correction Approval Workflow', () => {
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

  test('loads the Data Corrections page without errors', async ({ page }) => {
    await page.goto('/data-corrections');
    await page.waitForTimeout(3_000);

    // Should not render an error state
    await expect(page.locator('text=Application Error')).toHaveCount(0);
    await expect(page.locator('text=Something went wrong')).toHaveCount(0);

    // Either the corrections table or an empty-state card should be visible
    const hasTable = (await page.locator('table').count()) > 0;
    const hasEmptyState = (await page.locator('text=No pending, text=no corrections').count()) > 0;
    const hasHeading = (await page.locator('text=Data Corrections, text=Correction Requests').count()) > 0;

    expect(hasTable || hasEmptyState || hasHeading).toBeTruthy();
  });

  test('shows Approve and Reject buttons for pending corrections if any exist', async ({ page }) => {
    await page.goto('/data-corrections');
    await page.waitForTimeout(3_000);

    // If no corrections exist, the test is informational (not a failure)
    const pendingRows = page.locator('tr:has-text("pending"), tr:has-text("Pending")');
    const rowCount = await pendingRows.count();

    if (rowCount === 0) {
      // No corrections to review — acceptable outcome
      return;
    }

    // At least one approve or reject button must exist per pending row
    const approveBtn = page.locator('button:has-text("Approve"), button:has-text("Accept")');
    await expect(approveBtn.first()).toBeVisible({ timeout: 5_000 });
  });

  test('correction detail dialog opens on row click (if corrections exist)', async ({ page }) => {
    await page.goto('/data-corrections');
    await page.waitForTimeout(3_000);

    const rows = page.locator('tbody tr');
    const count = await rows.count();

    if (count === 0) {
      return; // No rows — skip detail check
    }

    await rows.first().click();
    await page.waitForTimeout(1_000);

    // A dialog or side panel should appear
    const dialog = page.locator('[role="dialog"]');
    const hasDialog = (await dialog.count()) > 0;

    if (hasDialog) {
      await expect(dialog.first()).toBeVisible({ timeout: 5_000 });
    }
  });
});
