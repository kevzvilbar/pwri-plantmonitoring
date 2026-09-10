# Fix Tasks

## 🔴 Critical / High
- [x] Fix circuit breaker SQL bug (boolean into integer variable) — `20260909000004_phase4_cascade_circuit_breaker.sql` (Committed)
- [x] Fix N+1 power query → added DB migration `20260910000001_latest_power_readings_fn.sql`, updated both `todayPowerRaw` and `yPower` queries in `useDashboardQueries.ts` (Committed)
- [x] Modularize Dashboard "God Component" complex into domain hooks (`useProductionStats`, `usePowerStats`, `useQualityStats`, `useCostStats`, `useDashboardAlerts`) (Committed)
- [x] Replace `Record<string, any>` in `useDashboardAlerts` with strictly typed `DashboardAlertsParams` interface (Committed)
- [x] Remove legacy `as any` casts in dashboard queries now enabled by 72/72 table types (Committed)
- [x] Ratchet down ESLint warning ceiling from 2486 → 2447 (**-39 warnings total**) (Committed)
- [x] Ratchet down bundle size from 1161.8 kB → 1161.5 kB (Committed)
- [x] Delete dead monolithic files `useDashboardQueries.ts` (935 lines) and `useDashboardAggregates.ts` (588 lines) (Committed)

## 🟡 Medium
- [x] Replace `next-themes` in `sonner.tsx` with Zustand `useThemeStore` (Committed)
- [x] Remove `next-themes` from `frontend/package.json` dependencies
- [x] Delete dead toast files (`toaster.tsx`, `use-toast.ts`, and `hooks/use-toast.ts`) now that Sonner is the sole toast notification system
- [x] Improve root `package.json` build command (`npm --prefix frontend run build` instead of chaining `cd frontend && npm install && npm run build`)
- [x] Add per-route ErrorBoundary in AppShell wrapping `<Outlet />` — shell stays alive when one page crashes (Committed)

## 🟢 Low / Quick wins
- [x] Add `frontend/.env.example` with all required/optional vars documented (Committed)
- [x] Delete duplicate `TRIGGER-DEPENDENCY-GRAPH.md` (kept the larger `TRIGGER_DEPENDENCY_GRAPH.md`) (Committed)
- [x] Updated CI `ci.yml` Phase 4 migration gate to include new `20260910000001_latest_power_readings_fn.sql` (Committed)

## ✅ Verification
- [x] TypeScript build passes cleanly (`tsc --noEmit -p tsconfig.app.json` exit code 0)
- [x] Full Vitest test suite passes (42 test files, 393 tests passed cleanly)
