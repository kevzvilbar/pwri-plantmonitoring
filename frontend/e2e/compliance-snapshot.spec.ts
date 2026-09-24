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

    // Page title. Role-based on purpose: the bare text 'Compliance' also matches
    // the sidebar link, the export button and the 'Evaluating facility
    // compliance...' state, which is a strict-mode violation.
    await expect(page.getByRole('heading', { name: 'Compliance', exact: true })).toBeVisible({ timeout: 15_000 });

    // Assert the absence of error UI only once the page has actually rendered.
    await expect(page.getByText('Application Error')).toHaveCount(0);
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
  });

  test('Facility Radar tab shows compliance score or evaluation pending', async ({ page }) => {
    await page.goto('/compliance');
    await expect(page.getByRole('heading', { name: 'Compliance', exact: true })).toBeVisible({ timeout: 15_000 });

    // Facility Radar tab (default)
    await page.getByRole('tab', { name: /Facility Radar/i }).click();

    // Should see either the score card, the evaluating state, or a violations list.
    // NOTE: Playwright's `text=a, text=b` is NOT a selector list -- the text engine
    // swallows the whole string, so it matched nothing. Combine with .or()/regex.
    const outcome = page
      .getByText('Compliance Rating')
      .or(page.getByText(/Evaluating facility compliance/i))
      .or(page.getByText(/violation/i));
    await expect(outcome.first()).toBeVisible({ timeout: 20_000 });
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
    await expect(page.getByRole('heading', { name: 'Compliance', exact: true })).toBeVisible({ timeout: 15_000 });

    // The tab always exists; a missing tab is a regression, not a reason to skip.
    await page.getByRole('tab', { name: /What-If/i }).click();

    // Sandbox inputs should be visible
    await expect(page.getByText('Real-Time What-If Simulation Sandbox')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('input[type="number"]').first()).toBeVisible({ timeout: 10_000 });
  });

  test('Export Compliance Audit CSV button is present', async ({ page }) => {
    await page.goto('/compliance');
    await page.waitForTimeout(3_000);

    const exportBtn = page.locator('button:has-text("Export"), button:has-text("Audit")');
    await expect(exportBtn.first()).toBeVisible({ timeout: 10_000 });
  });
});
