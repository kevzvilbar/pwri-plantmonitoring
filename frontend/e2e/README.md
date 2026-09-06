# E2E Tests — PWRI Plant Monitoring

## Prerequisites

```bash
cd frontend
npm install            # @playwright/test is already in devDependencies
npx playwright install chromium
```

## Running

```bash
# Run all E2E tests (starts dev server automatically)
npm run test:e2e

# Run with interactive UI
npm run test:e2e:ui

# Run headed
npx playwright test --headed

# Run a specific test file
npx playwright test e2e/dashboard-loads.spec.ts
```

## Notes

- The dev server (`npm run dev`) is started automatically by Playwright via `webServer` in `playwright.config.ts`.
- Credentials: set `E2E_EMAIL` and `E2E_PASSWORD` env vars for auth-required tests. Without them, the well-reading workflow test is skipped with a clear message.
- Screenshots on failure are retained as Playwright traces.
