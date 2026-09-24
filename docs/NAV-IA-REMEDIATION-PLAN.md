# Navigation & Information Architecture Remediation Plan

This document defines the architectural standard, migration phases, decision log, and verification rules for navigation, role permissions, plant visibility, and alert lifecycles across the PWRI Plant Monitoring platform.

---

## Decision Log

- **D1 (Admin Console Visibility)**: Any user with `view` permission on any `admin_*` submodule (`admin_users`, `admin_plants`, `admin_audit`) sees the "Admin Console" nav item. Tab-level authorization is enforced within `AdminPage`.
- **D2 (Alert Reopening & Notes Lifecycle)**: Resolving an alert requires a non-empty human note recorded in `alert_events`. A resolve suppresses re-firing only until the underlying condition clears; when the condition returns to normal, a `reopened` event is recorded so subsequent recurrences can sound the alarm. Bulk actions require confirmation dialogs and never bulk-snooze critical alarms.
- **D3 (Plant-Scoped Routing)**: Plant context is preserved in URL paths (e.g., `/plants/:plantId/wells/:wellId`), enabling browser history, deep linking, and predictable back navigation.
- **D4 (Mobile Bottom Bar Slots)**: Four fixed slots (`Readings`, `RO Trains`, `Dashboard`, `Alerts`) are displayed across all roles; all remaining permitted pages are accessible via the "More" menu.
- **D5 (Plant Visibility & RLS Alignment)**: Admins, Managers, and Data Analysts have global plant visibility (`is_manager_or_analyst_or_admin`). Operators and Technicians are restricted to their explicitly assigned plants (`user_has_plant_access`). All RLS policies and server RPCs strictly align with this rule.

---

## Remediation Phases

### Phase 1: Navigation Structure & Unified Sidebar
- [x] **P1-1**: Consolidate navigation configuration into `frontend/src/navConfig.ts`.
- [x] **P1-2**: Standardize `MODULE_LABELS` across permissions and navigation.
- [x] **P1-3**: Unify sidebar (`AppSidebar.tsx`) and mobile bottom navigation (`BottomNav.tsx`) to consume `buildNavConfig()`.
- [x] **P1-4**: Eliminate duplicate "Other" group and remove `/profile` from primary navigation tree (relocated to user avatar menu).
- [x] **P1-5**: Align page titles and header metadata with navConfig labels.
- [x] **P1-6**: Implement comprehensive unit test suite in `frontend/src/navConfig.test.ts`.
- [x] **P1-7**: Maintain `OPERATOR_ALLOWED_PATHS` in `ProtectedRoute.tsx` guarded by automated drift tests.

### Phase 2: Page Headers & Component Consistency
- [x] **P2-1**: Standardize `PageHeader` component across all top-level views.
- [x] **P2-2**: Remove redundant nested page titles.
- [x] **P2-3**: Ensure Operator-safe route redirects for chemical dosing (`/ro-trains?tab=chemical-dosing`).
- [x] **P2-4**: Align back button behavior across asset details.
- [x] **P2-5**: Standardize status pills and operational badges across views.
- [x] **P2-6**: Provide consistent empty states across data tables and lists.
- [x] **P2-7**: Prevent misleading "operating normally" signals during initial calculation loading.

### Phase 3: Alert System & Notification Hub
- [x] **P3-1**: Implement `public.alert_events` table for append-only audit trail.
- [x] **P3-2**: Implement `get_alert_statuses` RPC to derive server-side alert status.
- [x] **P3-3**: Create `useAlertEvents` hook with offline localStorage outbox pattern.
- [x] **P3-4**: Deduplicate incoming alerts and maintain acknowledged/resolved timestamps in Zustand `alertStore`.
- [x] **P3-5**: Enforce safeguards: `ConfirmBulkDialog` for bulk actions, `ResolveNoteDialog` with required notes for single/bulk resolve in `AlertsPage` and `TopBar/AlertPanel`.
- [x] **P3-6**: Remove legacy silent 5-minute dismiss; implement explicit condition clearing with `clearConditionAlerts`.
- [x] **P3-7**: Mount `<AlertsRuntime />` at the root shell level so alarms evaluate continuously across all routes.
- [x] **P3-8**: Implement automatic alert reopening lifecycle on condition clearing (D2).

### Phase 4: Topology & System Process Stages
- [x] **P4-1**: Standardize plant topology models and stage diagrams.
- [x] **P4-2**: Persist stage positions and link metadata.
- [x] **P4-3**: Restrict topology editing to authorized administrative roles.
- [x] **P4-4**: Provide responsive panning and zoom controls for large networks.

### Phase 5: Plant Visibility & Scoping
- [x] **P5-1**: Implement `useVisiblePlants` and `plantVisibility.ts` enforcing D5.
- [x] **P5-2**: Synchronize selected plant across routes (`usePlantRouteSync`, `ActivePlantChip`).
- [x] **P5-3**: Update Well navigation with URL-based detail view (`/plants/:id/wells/:wellId`).
- [x] **P5-4**: Handle unassigned user state with `<NoPlantsAssigned />`.
- [x] **P5-5**: Scope alert calculations and aggregate queries strictly to permitted plants.
- [x] **P5-6**: Add `/my-corrections` for operators to track raised correction requests.
- [x] **P5-7**: Provide bidirectional asset-to-readings deep links (`readingsPath`).
- [x] **P5-8**: Align database RLS policies (`alert_events`, `well_readings`, `ro_trains`, etc.) with `is_manager_or_analyst_or_admin`.
- [x] **P5-9**: Update database constraints (`ON DELETE CASCADE` for user references).
- [x] **P5-10**: Support command palette (`Cmd+K` / `Ctrl+K`) for rapid navigation.
- [x] **P5-11**: Optimize mobile navigation bar typography and touch targets.

### Phase 6: Code Health & Maintenance
- [x] **P6-1**: Format codebase with Prettier.
- [x] **P6-2**: Remove unused legacy components and dead hooks.
- [x] **P6-3**: Verify full TypeScript compilation with zero errors (`tsc --noEmit`).
- [x] **P6-4**: Enforce ESLint ceilings and verify comprehensive unit test suite.

---

## Appendix A: Target Navigation & Roles Table

| Group | Nav Item | Route | Operator | Technician | Manager | Data Analyst | Admin |
|---|---|---|:---:|:---:|:---:|:---:|:---:|
| **Overview** | Dashboard | `/` | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Alerts | `/alerts` | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Compliance | `/compliance` | | ✓ | ✓ | ✓ | ✓ |
| **Daily Logs** | Daily Readings | `/operations` | ✓ | ✓ | ✓ | ✓ | ✓ |
| | RO Trains | `/ro-trains` | ✓ | ✓ | ✓ | ✓ | ✓ |
| | PM Schedule | `/maintenance` | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Incidents | `/incidents` | ✓ | ✓ | ✓ | ✓ | ✓ |
| | My Corrections | `/my-corrections` | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Assets** | Plants | `/plants` | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Network Topology | `/topology` | | ✓ | ✓ | ✓ | ✓ |
| **Review** | Data Analysis & Review | `/data-analysis` | | | ✓ | ✓ | ✓ |
| | Data Corrections | `/data-corrections` | | | ✓ | ✓ | ✓ |
| | Manager Scorecard | `/manager-scorecard` | | | ✓ | ✓ | ✓ |
| **Reports & Data** | Costs & Tariffs | `/costs` | | ✓ | ✓ | ✓ | ✓ |
| | Data Exports | `/exports` | | | ✓ | ✓ | ✓ |
| | Smart Import | `/import` | | | ✓ | ✓ | ✓ |
| **Team & Admin** | Employees | `/employees` | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Admin Console | `/admin` | | | ✓ | | ✓ |
| **Total Items** | | | **9** | **12** | **18** | **17** | **18** |
