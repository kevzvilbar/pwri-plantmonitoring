# Feature-Slice Reorganization — Task List

## Slice 1: `ro-trains` (Completed)
- [x] 1. Extract `readingAudit.ts` into `src/shared/`
- [x] 2. Consolidate `pages/ROTrains/` and `pages/ro-trains/` into `src/features/ro-trains/`
- [x] 3. Fix all internal and external import paths
- [x] 4. Remove duplicate directory and configure compatibility re-exports (`pages/ROTrains.tsx`, `pages/ro-trains/helpers.tsx`)
- [x] 5. Verify all gates: `tsc`, `npm test` (75 suites, 688 tests), `npm run build`, `npm run lint`
- [x] 6. Commit `6a1f1b6c` & pushed to origin `main`

## Slice 2: `costs` (Completed)
- [x] 1. Create `src/features/costs/` structure (`components/`, `tabs/`, `hooks/`)
- [x] 2. Migrate `src/components/costs/` to `src/features/costs/components/`
- [x] 3. Migrate `src/pages/costs/` to `src/features/costs/tabs/`
- [x] 4. Migrate `src/pages/Costs.tsx` to `src/features/costs/CostsPage.tsx`
- [x] 5. Migrate `useCostComposition.ts` and `useOpexBudget.ts` to `src/features/costs/hooks/`
- [x] 6. Create barrel `src/features/costs/index.ts`
- [x] 7. Update internal relative/alias imports within `src/features/costs/`
- [x] 8. Setup backwards-compatibility shims (`src/pages/Costs.tsx`, `src/hooks/useCostComposition.ts`, `src/hooks/useOpexBudget.ts`)
- [x] 9. Remove legacy `src/pages/costs/` and `src/components/costs/`
- [x] 10. Verify all gates: `tsc`, `npm test` (75 suites, 688 tests), `npm run build`, `npm run lint`
- [x] 11. Commit `41aa42c2` & pushed to origin `main`

## Slice 3: `notifications` & `auth` (Completed)
- [x] 1. Create `src/features/notifications/` (`components/`, `hooks/`, `lib/`)
- [x] 2. Migrate Alerts page, components, hooks, and tests into `src/features/notifications/`
- [x] 3. Migrate PushNotificationCard, hooks, lib, and tests into `src/features/notifications/`
- [x] 4. Create `src/features/auth/` (`components/`, `components/SignUpForm/`)
- [x] 5. Migrate Auth, Onboarding, Profile pages and auth components into `src/features/auth/`
- [x] 6. Setup barrels and compatibility shims for pages, components, and hooks
- [x] 7. Update internal imports within `src/features/notifications/` and `src/features/auth/`
- [x] 8. Verify all gates: `tsc`, `npm test` (75 suites, 688 tests), `npm run build`, `npm run lint`
- [x] 9. Commit `7bf7c7fd` & pushed to origin `main`

## Slice 4: `readings` (Next Up)
- [ ] 1. Plan and organize `src/features/readings/` (smart-import, ReadingImportDialog, components/import, data-corrections, dataAnalysis)
- [ ] 2. Maintain routing and re-export shims
- [ ] 3. Verify all gates: `tsc`, `npm test`, `npm run build`, `npm run lint`
- [ ] 4. Commit & push Slice 4
