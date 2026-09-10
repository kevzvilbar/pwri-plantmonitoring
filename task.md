# Fix Tasks

## 🔴 Critical / High
- [x] Fix circuit breaker SQL bug (boolean into integer variable) — `20260909000004_phase4_cascade_circuit_breaker.sql`
- [x] Fix N+1 power query → added DB migration `20260910000001_latest_power_readings_fn.sql`, updated both `todayPowerRaw` and `yPower` queries in `useDashboardQueries.ts`
- [x] Type `useDashboardAggregates` params & return values — replaced `Record<string, any>` with `DashboardAggregatesParams` interface; ensured `production`, `consumption`, `rawWaterVol`, `yProduction`, etc. are strictly typed `number` with clean narrowing.

## 🟡 Medium
- [x] Replace `next-themes` in `sonner.tsx` with Zustand `useThemeStore` — eliminated extraneous Next.js dependency in Vite SPA
- [x] Remove orphaned shadcn `<Toaster />` from App.tsx — migrated consumers (`FilterReplacementHistory`, `FilterReplacementDialog`) → `toast.success/error` from sonner
- [x] Add per-route ErrorBoundary in AppShell wrapping `<Outlet />` — shell stays alive when one page crashes

## 🟢 Low / Quick wins
- [x] Add `frontend/.env.example` with all required/optional vars documented
- [x] Delete duplicate `TRIGGER-DEPENDENCY-GRAPH.md` (kept the larger `TRIGGER_DEPENDENCY_GRAPH.md`)
- [x] Updated CI `ci.yml` Phase 4 migration gate to include new `20260910000001_latest_power_readings_fn.sql`

## ✅ Verification
- [x] TypeScript build passes cleanly (`tsc --noEmit -p tsconfig.app.json` exit code 0)

