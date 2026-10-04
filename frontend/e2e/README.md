# E2E Tests — PWRI Plant Monitoring

## Prerequisites

```bash
cd frontend
npm install            # @playwright/test is already in devDependencies
npx playwright install chromium
```

## Running

```bash
# Run all E2E tests (starts the dev server automatically)
npm run test:e2e

# Run with interactive UI
npm run test:e2e:ui

# Run headed
npx playwright test --headed

# Run a specific test file
npx playwright test e2e/dashboard-loads.spec.ts

# Run against the production build (what CI does) instead of the dev server
E2E_ROOT_BASE=1 npm run build
E2E_PREVIEW=1 npm run test:e2e
```

## How authentication works

`e2e/global-setup.ts` signs in **once per role** (operator, manager, admin) through the
real UI before any test runs and saves each session to `e2e/.auth/<role>.json`
(gitignored — it contains live tokens). Specs opt in with:

```ts
test.use({ storageState: authFile('admin') });
```

Do **not** log in inside `beforeEach`; that is what made the authenticated CI job
overrun its time limit. If a login fails, global setup aborts the run immediately with
the reason (and a screenshot in `test-results/auth-setup-<role>.png`) rather than every
test timing out separately.

Because sessions are shared, a test must never sign out: Supabase's default sign-out
revokes the user's other sessions too.

## Notes

- Without `E2E_EMAIL` / `E2E_PASSWORD`, global setup writes empty state files and the
  authenticated suites skip themselves with a clear message.
- The server is started automatically by Playwright via `webServer` in `e2e/base.ts`
  (`npm run dev` locally; `vite preview` of the production build when `E2E_PREVIEW` is set).
- Service workers are blocked in tests so the PWA cache can't make runs non-deterministic.
- In CI: failures stop the run after 10 failed tests, the run has a 6-minute global
  ceiling, and failure screenshots/traces are uploaded as an artifact.
