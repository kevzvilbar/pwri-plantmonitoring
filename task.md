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

## Slice 3: `notifications` & `auth` (Next Up)
- [ ] 1. Plan and organize `src/features/notifications/` (Alerts, components/notifications, push notifications)
- [ ] 2. Plan and organize `src/features/auth/` (Auth, Onboarding, Profile)
- [ ] 3. Maintain routing and re-export shims
- [ ] 4. Verify all gates: `tsc`, `npm test`, `npm run build`, `npm run lint`
- [ ] 5. Commit & push Slice 3
