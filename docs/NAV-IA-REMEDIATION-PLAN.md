# Navigation, IA and alerts remediation plan

| | |
|---|---|
| Repo | `kevzvilbar/pwri-plantmonitoring` |
| Baseline | `d193fbb` (includes `d31b6d3` nav/alerts commit and the feature-slicing refactor) |
| Written | 2026-09-20 |
| Scope | Information architecture, navigation flow, alert flow, freshness indicators |
| Suggested path | `docs/NAV-IA-REMEDIATION-PLAN.md` |

Effort sizes are rough: **S** under half a day, **M** one to two days, **L** three or more. Adjust to your velocity. Task IDs (`P0-1`, `P3-2`, ...) are stable so you can reference them in commits and PRs.

---

## 1. Where things stand

The two critique commits moved the app in the right direction: sidebar and bottom nav now use `hasPermission()`, `/alerts` is in the nav and the operator allow-list, `/chemicals` is a real redirect, and fake "Live" counters were replaced with data-driven ones. Four things need attention first:

1. **Crash.** `ProtectedRoute` throws `Too many re-renders` when an operator opens a forbidden path (reproduced, see Appendix C).
2. **Two sources of truth that aren't one.** `navConfig.ts` is imported by nothing, and its output omits Admin. The sidebar and bottom nav each keep their own copy of the group structure.
3. **Acknowledge/resolve is cosmetic.** The bell panel records the literal string `'current-user'`. No UI reads the status. `addAlerts` overwrites it on the next recompute. Nothing persists.
4. **Alarms still depend on the Dashboard.** `useDashboardAlerts` runs only when `pages/Dashboard.tsx` mounts, so a cold open on any other page shows "All plant systems and sensors operating normally".

Everything else in the first review is either partly done or untouched. Appendix B has the full status table.

---

## 2. Decisions needed before starting

| ID | Question | Recommendation | Blocks |
|---|---|---|---|
| D1 | Should Managers see the Admin Console link? The matrix already lets them into the Plants and Audit tabs (`admin_plants`, `admin_audit` view = Manager, Admin). The nav hides it. | Show "Admin Console" to anyone with view on any `admin_*` module. The page already gates per tab. | P1-1 |
| D2 | What does "Resolve" mean for an alert derived from live data? If the condition is still true, the next recompute re-raises it. | Acknowledge is manual and audited. Alerts auto-clear when the condition clears. "Resolve" needs a required note and suppresses re-firing until the value changes. Snooze max 24 h and never for critical. | P3-2, P3-5 |
| D3 | Where should alerts be computed? | Now: client-side, once, at app-shell level. Later: server-side (the repo already has a `dashboard_server_aggregates` migration to build on). | P3-7 |
| D4 | Mobile bottom-nav slots. | Readings · RO trains · Dashboard · Alerts · More, with Plants in More. This is a hypothesis: check usage data or ask a few operators first. | P1-3 |
| D5 | Plant visibility rule (TopBar, Plants page and Alerts currently disagree). | Admin, Manager, Data Analyst: all plants. Everyone else: assigned plants only. Nobody assigned: none, with an "ask an admin to assign a plant" message. | P5-1 |

---

## 3. Phases

### Phase 0: Stop the operator crash (S, do first, ship alone)

**Problem.** `frontend/src/components/ProtectedRoute.tsx` calls `toast.error()` and `setShowAccessDenied(true)` in the render body. React re-renders on every render-phase update until it throws. The real file, run with a mocked operator on `/data-corrections`, throws `Too many re-renders` and fires 104 toasts.

- [ ] **P0-1** Replace the render-body side effects with a small component:

  ```tsx
  function AccessDenied() {
    useEffect(() => {
      toast.error('Access restricted', {
        id: 'access-denied',            // dedupes under StrictMode
        description: 'You do not have permission to view this page.',
      });
    }, []);
    return <Navigate to="/" replace />;
  }
  // in ProtectedRoute:  if (!allowed) return <AccessDenied />;
  ```

  Then delete the `showAccessDenied` state, its `useEffect`, the trailing `if (showAccessDenied) return null`, and the `useState` import.
- [ ] **P0-2** Add `frontend/src/components/ProtectedRoute.test.tsx` (below). This file was verified against the patched component: one toast, redirect to `/`, allowed paths untouched.

  ```tsx
  import { render, screen } from '@testing-library/react';
  import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
  import { describe, it, expect, vi, beforeEach } from 'vitest';

  const toastError = vi.fn();
  vi.mock('sonner', () => ({ toast: { error: (...a: any[]) => toastError(...a), success: vi.fn() } }));
  vi.mock('@/hooks/useAuth', () => ({
    useAuth: () => ({
      user: { id: 'u1' }, loading: false,
      profile: { profile_complete: true, confirmed: true, designation: 'Operator' },
      roles: ['Operator'],
    }),
  }));
  vi.mock('@/components/AppLoading', () => ({ AppLoading: () => null }));
  vi.mock('@/components/DesignationCombobox', () => ({ OPERATOR_DESIGNATION: 'Operator' }));
  import { ProtectedRoute } from '@/components/ProtectedRoute';

  const Where = () => <span data-testid="p">{useLocation().pathname}</span>;
  const App = ({ start }: { start: string }) => (
    <MemoryRouter initialEntries={[start]}>
      <Routes>
        <Route element={<ProtectedRoute><Where /></ProtectedRoute>}>
          <Route path="*" element={null} />
        </Route>
      </Routes>
    </MemoryRouter>
  );

  describe('ProtectedRoute (operator)', () => {
    beforeEach(() => toastError.mockClear());
    it('redirects a forbidden path to / with exactly one toast', () => {
      render(<App start="/data-corrections" />);
      expect(screen.getByTestId('p').textContent).toBe('/');
      expect(toastError).toHaveBeenCalledTimes(1);
    });
    it('leaves allowed paths alone', () => {
      render(<App start="/incidents" />);
      expect(screen.getByTestId('p').textContent).toBe('/incidents');
      expect(toastError).not.toHaveBeenCalled();
    });
  });
  ```
- [ ] **P0-3** Manual check as an Operator: open `/data-corrections` directly, and via the Operations ribbon. Expected: land on `/`, one "Access restricted" toast, no error screen.

**Done when:** the new test passes, and the full suite still passes.

---

### Phase 1: One navigation source of truth (M)

**Problem.** Three copies of the group structure exist: `navConfig.ts` (unused; `buildNavConfig(['Admin'])` returns no Admin group because it filters every `admin_*` key), `AppSidebar.buildSidebarGroups`, and `BottomNav.buildSideSheetGroups`. Labels differ between them ("Data Analysis & Review" vs "Data Analysis"), group order differs (Admin before Other in the sidebar, after in the sheet), and `Other` holds six unrelated items including Profile, which reuses the Dashboard icon.

There is also a permissions gap. The nav calls the base `hasPermission(roles, ...)`, but pages use `usePermission()`, which applies custom-role overrides from Admin → Roles. An override that restricts a module will not hide it in the nav.

- [ ] **P1-1** Rewrite `frontend/src/navConfig.ts` as plain data plus a pure builder that takes a predicate:

  ```ts
  export type Can = (moduleKey: ModuleKey, action?: Action) => boolean;
  export function buildNavConfig(can: Can): NavGroup[] { /* filters NAV_GROUPS by can(...) */ }
  ```

  - Groups and order per Appendix A. Do not filter out `admin_*`. Show "Admin Console" when `can('admin_users') || can('admin_plants') || can('admin_audit')` (D1).
  - Labels come only from `MODULE_LABELS`. Add `mobileLabel`, `end`, `matchPaths`, `matchTabValues` and `priority` (for bottom-nav slots) to each item.
  - Remove `profile` from the nav (it lives in the avatar menu). Give every remaining module a unique icon.
- [ ] **P1-2** Add `useCan()` to `hooks/usePermission.ts`. It calls `useAuth()` and `useMyCustomRole()` once and returns a memoized `Can` that applies `effectivePermission` for custom roles, else `hasPermission`. Add `useNavGroups()` = `buildNavConfig(useCan())`.
- [ ] **P1-3** `AppSidebar.tsx`: render `useNavGroups()`; delete `buildSidebarGroups`. `BottomNav.tsx`: render `priority` items in the bar and the rest in the More sheet from the same groups; delete `buildSideSheetGroups` (D4).
- [ ] **P1-4** Alerts badge in the sidebar item and the bottom-nav Alerts slot (count of unacknowledged critical + warning). Until Phase 3, count from `useAlertStore`.
- [ ] **P1-5** Page titles match nav labels. `features/operations/pages/OperationsPage.tsx` title "Operations Control" becomes "Daily Readings". Check the other pages against `MODULE_LABELS`.
- [ ] **P1-6** Add `navConfig.test.ts` asserting the exact output per role from Appendix A, plus an invariant: every route an Operator sees in the nav is in `OPERATOR_ALLOWED_PATHS`.
- [ ] **P1-7** *(stretch)* Derive `OPERATOR_ALLOWED_PATHS` from `ROUTE_MAP` and the matrix for the Operator role, so the route guard cannot drift from the nav again.
- [ ] **P1-8** Fix stale comments: `BottomNav` ("Plants moves into More"), `ProtectedRoute` ("Generated from PERMISSION_MATRIX via usePermission()"), and the `permissions.ts` header.

**Done when:** `AppSidebar` and `BottomNav` import nothing but `useNavGroups()`, the per-role test passes, and no group is called `Other`.

---

### Phase 2: Dead ends and broken links (M)

- [ ] **P2-1** `OperationsPage.tsx`: gate the Import and Export buttons and each "Operations Tools" ribbon link with `useCan()` (`smart_import`, `data_exports`, `data_corrections`, `manager_scorecard`, `network_topology`). Hide the whole ribbon when empty. Add a small `<CanLink>` helper so other pages can reuse it.
- [ ] **P2-2** Dashboard Data Trust cluster (`components/dashboard/DataTrustAuditCard.tsx`, `PendingReviewCard.tsx`): for roles without `data_corrections` view, render read-only or hide the navigate buttons. Operators get "My correction requests" once P5-6 lands.
- [ ] **P2-3** `pages/Dashboard/hooks/useDashboardAlerts.ts` (~line 541): low-stock `linkPath: '/chemicals'` becomes `/ro-trains?tab=chemical-dosing`. Operators are blocked from `/chemicals` by `ProtectedRoute` before the redirect runs. Keep the `/chemicals` route for old bookmarks. Add a unit test that every alert `linkPath` an operator can receive is in the allow-list.
- [ ] **P2-4** `features/readings/pages/DataCorrectionsPage.tsx`: read and write `?tab=` (`pending | inbox | history | operators`) with a validity guard. The Dashboard already links to `?tab=history` and the page ignores it (`<Tabs defaultValue="pending">`).
- [ ] **P2-5** Login deep link.
  - `LoginForm.tsx` (three `navigate('/')` calls, ~lines 136, 140, 153): use the `from` location saved by `ProtectedRoute`.
  - `AuthPage.tsx`: `redirectTo` currently drops `search` and `hash`.
  - Extract `getPostLoginPath(location)` that returns `pathname + search + hash`, and accepts only strings starting with a single `/` (reject `//host` open redirects). Unit-test it.
- [ ] **P2-6** `/admin?tab=`: make `AdminPage` read and write `tab`. `ROUTE_MAP` already emits `/admin?tab=plants` and friends, and the page ignores them.
- [ ] **P2-7** Bell empty state: add `alertsReady` to the store and show "Checking plant systems…" until the first computation finishes. Never say "operating normally" before that.

**Done when:** an operator can click every visible button and link without an "Access restricted" toast, and a deep link survives sign-in including its query string.

---

### Phase 3: Make alarms real (L)

**Problem.**
- `AlertPanel.tsx` passes the literal `'current-user'` in five places. `AlertsPage.tsx` uses the real user id.
- `getAlertStatus`, `acknowledgedAt` and `resolvedAt` are never read by any UI. After "Resolve all" the list and the bell count are unchanged.
- `alertStore.addAlerts` replaces same-id alerts, so status set on the store object is lost on the next recompute.
- `plantAlerts` is not persisted and nothing is written to the database, so there is no audit trail.
- "Resolve all" and "Snooze all" are one tap with no confirmation.

- [ ] **P3-1** Use `useAuth().user.id` everywhere in `AlertPanel.tsx`. Remove every `'current-user'`.
- [ ] **P3-2** Persist events. Sketch (adapt to your migration naming and RLS helpers such as `has_role()`):

  ```sql
  create table public.alert_events (
    id           uuid primary key default gen_random_uuid(),
    alert_key    text not null,                       -- stable id, e.g. 'stock-<chemical id>'
    plant_id     uuid references public.plants(id),
    action       text not null check (action in ('acknowledged','resolved','snoozed','reopened')),
    user_id      uuid not null default auth.uid() references auth.users(id),
    note         text,
    snooze_until timestamptz,
    created_at   timestamptz not null default now()
  );
  -- RLS: insert own rows; select for users assigned to plant_id, plus Manager/Admin.
  ```

  Add `useAlertEvents(plantIds)` (query and mutations). Alert status becomes derived: `status = f(alert_key, latest event, snooze)`. The app advertises offline-first field use, so check how readings are queued offline and route these writes through the same queue.
- [ ] **P3-3** Read the status in the UI.
  - Filters: Active / Acknowledged / Snoozed / Resolved.
  - `Signal` shows "Acknowledged by X · 14:02".
  - The bell badge and nav badge count unacknowledged items only.
- [ ] **P3-4** Stop-gap if P3-2 slips: make `addAlerts` merge by id and preserve `acknowledged*` and `resolved*` fields.
- [ ] **P3-5** Bulk actions get a confirm dialog that states the count. Exclude critical alerts from bulk snooze. Resolve requires a note (D2).
- [ ] **P3-6** One vocabulary: Acknowledge · Snooze · Resolve. Remove `removeAlerts` (it snoozes for 5 minutes despite its name) and the deprecated `onDismiss` path.
- [ ] **P3-7** Compute alerts independent of route (D3). Mount one `<AlertsRuntime />` in `AppShell`, and remove `useDashboardAlerts` from `pages/Dashboard.tsx`. **Watch for double mounting:** `useTrainAutoOffline` documents that two mounted instances write duplicate Offline status-log rows. Measure the added query load on non-Dashboard pages before shipping.
- [ ] **P3-8** `useTopBarState.ts:64` calls `clearAlerts()` on every plant change. Replace with filtering by plant so switching the selector doesn't destroy alert state.
- [ ] **P3-9** Tests:
  - the store merge preserves status
  - an ack records the real user id
  - resolved and acknowledged alerts leave the badge count
  - a cold open of `/operations` shows "Checking…" and then the real alerts

**Done when:** an acknowledgement survives a page reload and a recompute, shows who and when, and is visible to a second user.

---

### Phase 4: Honest freshness (S)

**Problem.** The Dashboard hero now uses real data, but prints raw seconds ("Updated 10800s ago"), stays green with a pulsing lamp however stale the data is, and falls back to "Live" when there is no reading. `PlantsPage` shows "Synced 0s ago" while loading or with no data, and always shows a static "Live Telemetry" badge. `OperationsPage` has a hard-coded, pulsing "Data freshness validated" label.

- [ ] **P4-1** Add `shared/freshness.ts`: `describeFreshness(ts: Date | null, now = Date.now())` returns `{ label, tone: 'fresh' | 'aging' | 'stale' | 'unknown' }`. Suggested thresholds: fresh under 90 min, aging under 4 h, stale after that. Confirm against the real logging cadence with operations.
- [ ] **P4-2** `components/dashboard/PlantPulseHero.tsx`: show the label and tone. The lamp pulses only when fresh. No "Live" fallback; use "No recent readings".
- [ ] **P4-3** `features/plants/pages/PlantsPage.tsx` and `PlantListHeader.tsx`: pass `null` (not `0`) when unknown, use a per-plant timestamp rather than one global "latest", and bind or remove the static "Live Telemetry" badge.
- [ ] **P4-4** `OperationsPage.tsx`: remove "Data freshness validated", or bind it to a real check.
- [ ] **P4-5** Add `useNow(30_000)` so "4 min ago" advances without a refetch.
- [ ] **P4-6** Confirm the source: the latest reading across wells, locators and RO trains, or a server aggregate. Today it is `ro_train_readings` only.
- [ ] **P4-7** Unit-test `describeFreshness` at each threshold and for `null`.

---

### Phase 5: IA follow-ups (M to L, pick in any order)

- [ ] **P5-1** `useVisiblePlants()` shared by TopBar, `PlantsPage` and `useAlerts` (D5). Delete the three inline copies.
- [ ] **P5-2** One plant context.
  - Opening `/plants/:id` sets `selectedPlantId`.
  - Replace the per-form `PlantSelector` in Operations with a read-only plant chip bound to the global selector.
  - When the selection is "All plants", require an explicit choice. Remove the `plants?.[0]` fallback in `OperationsPage`.
  - Reset `selectedPlantId` on sign-out.
- [ ] **P5-3** Make well detail a route (`/plants/:id/wells/:wellId`) so it is linkable and browser Back returns to the wells list. `WellsList.tsx` currently does `if (detail) return <WellDetail … />`.
- [ ] **P5-4** One `useUrlTab(key, validValues, default)` hook. Migrate Operations, RO Trains, Plants, Employees, Maintenance, Incidents, Compliance, Costs, Admin and Data Corrections. Today: 6 pages use `useTabPersist` (sessionStorage), 3 use `?tab=`, and the rest use plain state.
- [ ] **P5-5** Help and approvals.
  - Add "Help & Manual" to the avatar menu (`OperatorSwitcher`), hosting `AppManual` on its own route.
  - Move `PendingApprovals` to Admin → Users with a count badge on the Admin nav item.
  - Rename the Employees "Info" tab to "Org chart".
- [ ] **P5-6** "My correction requests" view for operators (tab or route), added to the operator allow-list.
- [ ] **P5-7** Cross-links between assets and readings. `WellsList` → Operations exists (`handleNavOperations`); add Operations rows → asset.
- [ ] **P5-8** `PendingApproval`: subscribe to the user's own profile row (or poll every ~10 s) and continue automatically when approved. Fix the copy.
- [ ] **P5-9** Dashboard: keep one drill-down mode. Stop rewriting the saved preference when "inline" is clicked.
- [ ] **P5-10** *(stretch)* Command palette using `components/ui/command.tsx`: jump to a page, plant or well.
- [ ] **P5-11** Mobile and accessibility.
  - Raise 9 px nav labels to at least 11 px.
  - Fix the active-label size shift in the bottom nav.
  - Replace the hand-rolled tab bars (Operations, Plant detail) with Radix `Tabs`, or add `role="tab"` and `aria-selected`.
  - Fix the "More" sheet scroll container for long lists.

---

### Phase 6: Hygiene (S)

- [ ] **P6-1** Run Prettier on files with drifted indentation: `AlertPanel`, `useTopBarState`, `Signal`, `PlantPulseHero`, `Dashboard`, `PlantsPage`, `useAlerts`, `ControlConsole`.
- [ ] **P6-2** Finish the slicing: `features/readings` still imports from `@/pages/plants/...` and `@/pages/operations/shared`. Point those at `@/features/...` and delete the shims left in `pages/plants` and `pages/operations`.
- [ ] **P6-3** `AddPlantDialog` in `PlantsPage.tsx` has no trigger anywhere (also true before the refactor). Add an "Add plant" button for MANAGE roles, or delete the dead dialog if Admin → Plants is the intended entry point.
- [ ] **P6-4** Remove unused imports (`useNavigationType` in `AuthPage`, `profile` in `BottomNav`) and fix the two `react-hooks/exhaustive-deps` warnings in `useTopBarState`.

---

## 4. Test plan

| Phase | Tests to add | Type |
|---|---|---|
| 0 | `ProtectedRoute.test.tsx` (operator forbidden/allowed path) | unit |
| 1 | `navConfig.test.ts` (Appendix A per role, operator-reachability invariant); custom-role override hides a nav item | unit |
| 2 | `getPostLoginPath` (query preserved, open redirect rejected); alert `linkPath` reachability; DataCorrections `?tab=` | unit |
| 3 | store merge preserves status; ack records user id; badge excludes acknowledged; cold-open `/operations` shows "Checking…" | unit + integration |
| 4 | `describeFreshness` thresholds and `null` | unit |
| 5 | `useVisiblePlants` per role; `useUrlTab` invalid value falls back; well-detail route Back behavior | unit + integration |

The current suite (75 files, 688 tests) has no coverage of `ProtectedRoute`, `AppSidebar`, `BottomNav` or `navConfig`, which is why the Phase 0 crash passed CI.

---

## 5. Risks

| Risk | Mitigation |
|---|---|
| Regrouping changes muscle memory | Routes do not change, so bookmarks and alert deep links keep working. Ship with a short release note. |
| Shell-level alert computation adds query load on every page | Measure before and after. Plan the server-side move (D3). |
| Two mounted alert hooks duplicate status-log rows | One `<AlertsRuntime />` only. Remove the Dashboard mount in the same PR. |
| Alert events written offline | Reuse the existing offline queue (see P3-2). |
| Custom roles diverge from the matrix | Nav and guard use `useCan()` (effective permission), never base `hasPermission` directly. |
| `admin_*` visibility for Managers is a policy change | Resolve D1 explicitly before P1-1. |

---

## Appendix A: target navigation

Group order: Overview → Daily Logs → Assets → Review → Reports & Data → Team & Admin. Group names reuse your existing labels where they exist (Overview, Assets, Daily Logs, Review). "Other" and "Admin" are replaced.

| Group | Items (module key) | Visible to |
|---|---|---|
| Overview | Dashboard (`dashboard`), Alerts (`alerts`), Compliance (`compliance`) | Dashboard and Alerts: all. Compliance: Technician, Manager, Data Analyst, Admin |
| Daily Logs | Daily Readings (`operations`), RO Trains (`ro_trains`), PM Schedule (`pm_schedule`), Incidents (`incidents`) | all |
| Assets | Plants (`plants`), Network Topology (`network_topology`) | Plants: all. Topology: Technician and up |
| Review | Data Analysis & Review, Data Corrections, Manager Scorecard | Manager, Data Analyst, Admin |
| Reports & Data | Costs & Tariffs (`costs`), Data Exports, Smart Import | Costs: Technician and up. Exports and Import: Manager, Data Analyst, Admin |
| Team & Admin | Employees (`employees`), Admin Console (`admin_*`) | Employees: all. Admin Console: per D1 (Admin; Manager for Plants/Audit tabs) |

Profile is not a nav item.

**Expected output of `buildNavConfig` per role** (use as the P1-6 test; assumes D1 = yes):

| Role | Groups | Items |
|---|---|---|
| Operator | Overview[Dashboard, Alerts] · Daily Logs[4] · Assets[Plants] · Team & Admin[Employees] | 4 groups, 8 items |
| Technician | Overview[Dashboard, Alerts, Compliance] · Daily Logs[4] · Assets[Plants, Network Topology] · Reports & Data[Costs & Tariffs] · Team & Admin[Employees] | 5 groups, 11 items |
| Manager | Overview[3] · Daily Logs[4] · Assets[2] · Review[3] · Reports & Data[3] · Team & Admin[Employees, Admin Console] | 6 groups, 17 items |
| Data Analyst | as Manager, without Admin Console | 6 groups, 16 items |
| Admin | as Manager | 6 groups, 17 items |

---

## Appendix B: status of the first review's findings

| Finding | Status at `d193fbb` |
|---|---|
| Nav hand-codes roles, drifts from matrix | Mostly fixed (uses `hasPermission`), but three copies remain and custom-role overrides are ignored → P1 |
| "Wells & Locators" label | Nav renamed; page title still "Operations Control" → P1-5 |
| Alerts not in nav | Sidebar yes; mobile behind More, no badge → P1-3, P1-4 |
| Operators hit forbidden links | Access-restricted toast added but crashes → P0. Buttons still shown → P2-1, P2-2 |
| Dismiss = silent 5-min snooze | Acknowledge/resolve added but cosmetic → P3 |
| Fake "Live • Ns ago" counters | Now real data, poorly presented, new static labels → P4 |
| `/chemicals` shim | Proper redirect; alert still links to it → P2-3 |
| Deep link lost at login | `AuthPage` half-done; `LoginForm` unchanged → P2-5 |
| Alarms exist only after Dashboard mounts | Untouched → P3-7, P2-7 |
| Plant scoping, plant picker, `plants[0]` fallback | Untouched → P5-1, P5-2 |
| Well detail in component state; `?tab=history` ignored | Untouched → P5-3, P2-4 |
| Help and approvals buried in Employees → Info | Untouched → P5-5 |
| Pending-approval polling; tab-state mechanisms; command palette; Dashboard view modes; mobile a11y | Untouched → P5-8, P5-4, P5-10, P5-9, P5-11 |

---

## Appendix C: verification log

Cloned `origin/main` at `d193fbb` on 2026-09-20 and compared against `d3f1d25` (the version first reviewed). Nothing was pushed to the repository.

- `npm ci` then `vitest run`: 75 files, 688 tests, all passing.
- `tsc --noEmit -p tsconfig.app.json`: clean.
- ESLint on the touched nav/alert files: 0 errors, 12 warnings (mostly `any`, plus two `exhaustive-deps`).
- Throwaway test on the real `ProtectedRoute.tsx` (mocked `useAuth` and `sonner`, React 18.3.1, jsdom): operator on a forbidden path threw `Too many re-renders` and called `toast.error` 104 times. With the P0-1 patch: 1 toast, redirect to `/`, allowed path unaffected.
- Throwaway test calling `buildNavConfig` per role: no Admin group for any role, and `Other` holds Compliance, Costs, Employees, Exports, Import and Profile.
- `grep`: `navConfig` has no importers; `getAlertStatus`, `acknowledgedAt` and `resolvedAt` are never read by UI code; `'current-user'` appears five times in `AlertPanel.tsx`; `setShowAddPlant(true)` is never called.
- The `navConfig.test.ts` in P1-6 and the other suggested tests are not yet written or run.
