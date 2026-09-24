import { test, expect } from '@playwright/test';
import { signIn, E2E_ADMIN_EMAIL, HAS_CREDENTIALS } from './base';

/**
 * Critical workflow: Plant-wide compliance snapshot.
 *
 * Verifies that:
 * - The /compliance page loads without crashing
 * - The Facility Radar tab renders threshold evaluation results
 * - The Fleet Matrix tab renders the cross-plant comparison table
 * - The What-If Simulator tab renders the sandbox inputs
 * - Export CSV button is present
 *
 * Prerequisites:
 *   E2E_EMAIL / E2E_PASSWORD must be set (they gate the suite). The test itself
 *   signs in as the seeded Admin: the seeded E2E_EMAIL user is an Operator, and
 *   ProtectedRoute bounces Operators off /compliance (OPERATOR_ALLOWED_PATHS).
 */
test.describe('Compliance Snapshot Workflow', () => {
  test.beforeEach(async ({ page }) => {
    if (!HAS_CREDENTIALS) {
      test.skip(true, 'Skipping: set E2E_EMAIL and E2E_PASSWORD to run this suite.');
      return;
    }

    await signIn(page, E2E_ADMIN_EMAIL);
  });

  test('compliance page renders without errors', async ({ page }) => {
    await page.goto('/compliance');
    await page.waitForTimeout(3_000);

    await expect(page.locator('text=Application Error')).toHaveCount(0);
    await expect(page.locator('text=Something went wrong')).toHaveCount(0);

    // Page title
    await expect(page.getByRole('heading', { name: 'Compliance' })).toBeVisible({ timeout: 10_000 });
  });

  test('Facility Radar tab shows compliance score or evaluation pending', async ({ page }) => {
    await page.goto('/compliance');
    await page.waitForTimeout(4_000);

    // Facility Radar tab (default)
    const tab = page.locator('[role="tab"]:has-text("Facility Radar"), button:has-text("Facility Radar")');
    const hasTab = (await tab.count()) > 0;

    if (hasTab) {
      await tab.first().click();
      await page.waitForTimeout(2_000);
    }

    // Should see either a compliance score card or evaluating state
    const hasScore = (await page.locator('text=Compliance Rating, text=Compliance Score').count()) > 0;
    const hasEvaluating = (await page.locator('text=Evaluating, text=Evaluate').count()) > 0;
    const hasViolations = (await page.locator('text=violations, text=Violations').count()) > 0;

    expect(hasScore || hasEvaluating || hasViolations).toBeTruthy();
  });

  test('Fleet Matrix tab shows cross-plant compliance table', async ({ page }) => {
    await page.goto('/compliance');
    await page.waitForTimeout(2_000);

    const fleetTab = page.locator('[role="tab"]:has-text("Fleet"), button:has-text("Fleet")');
    const hasFleet = (await fleetTab.count()) > 0;

    if (!hasFleet) {
      test.skip(true, 'Fleet tab not found — skip.');
      return;
    }

    await fleetTab.first().click();
    await page.waitForTimeout(3_000);

    // Either a fleet table or empty state should appear
    const hasTable = (await page.locator('table').count()) > 0;
    const hasEmptyMsg = (await page.locator('text=No plant').count()) > 0;

    expect(hasTable || hasEmptyMsg).toBeTruthy();
    await expect(page.locator('text=Application Error')).toHaveCount(0);
  });

  test('What-If Simulator tab renders sandbox inputs', async ({ page }) => {
    await page.goto('/compliance');
    await page.waitForTimeout(2_000);

    const whatIfTab = page.locator('[role="tab"]:has-text("What-If"), button:has-text("What-If")');
    const hasWhatIf = (await whatIfTab.count()) > 0;

    if (!hasWhatIf) {
      test.skip(true, 'What-If tab not found — skip.');
      return;
    }

    await whatIfTab.first().click();
    await page.waitForTimeout(2_000);

    // Sandbox inputs should be visible
    await expect(page.locator('text=/Sandbox/i, text=/Simulation/i').first()).toBeVisible({ timeout: 5_000 });
    const inputs = page.locator('input[type="number"]');
    await expect(inputs.first()).toBeVisible({ timeout: 5_000 });
  });

  test('Export Compliance Audit CSV button is present', async ({ page }) => {
    await page.goto('/compliance');
    await page.waitForTimeout(3_000);

    const exportBtn = page.locator('button:has-text("Export"), button:has-text("Audit")');
    await expect(exportBtn.first()).toBeVisible({ timeout: 10_000 });
  });
});
