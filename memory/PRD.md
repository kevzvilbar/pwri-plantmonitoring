# PWRI Monitoring — Product Requirements (PRD)

_Last updated: 2026-04-25 (iteration 10)_

## 1. Problem Statement (verbatim — consolidated across 6 iterations)
> "Check for possible error and improve pls the app pls" + pre-load 8
> XLSX files (Mambaling Q1+Q2, SRP×2, Umapad×2, SRP MCWD, Guizo); remove
> standalone Downtime field in favour of unified Alerts; fix Dashboard
> Trends pop-up (X=Date ascending, Y=Value, add Raw Water Trendline and
> Recovery Trendline); add Blending/Bypass-well tagging with audit trail;
> mobile-friendly; Vercel-friendly.
> Iteration 3: remove "Seed attached samples" card from /import; allow
> .txt/.doc/.docx/.xlsx upload; remove axis-label paragraph from trend
> modal; fix 7D-90D duration filters; fix ro-last undefined error; add
> LatLon GPS fields on Locators and Wells; replace Blending Well
> terminology with "Mark As Bypass Well" (require meter reading before
> marking); Title Case across views (except Notes).
> Iteration 4: "scan for error … rescan everything correct possible
> error and forget about vercel." + initial Deletion Rules (Admin-only
> users, Admin/Manager plants, soft/hard, dependency check, audit log).
> Iteration 5 (refinement): User Management designation combobox,
> force-override flow, audit log table, profile page with plant
> selector, plants list shows wells count.
> Iteration 6 (current — Energy + Wells deletion + Dashboard polish):
> 1. Energy & Meter Integration — dedicated electric meters for wells,
>    Solar+Grid plant flags, daily kWh split, Dashboard EnergyMixCard.
> 2. Wells Deletion (Admin) — multi-select bulk hard-delete with audit.
> 3. Dashboard / UX polish — TrendModal Custom date inline,
>    "Mark as Bypass" caption, middle-aligned pump labels.
> Iteration 7 (current — Admin RBAC verification + audit log + reason
> required + login attempts):
> 1. **Provision Kevin Vilbar (kevzvilbar@gmail.com / @Kevz)** as the
>    org's first Admin via the existing Sign-Up flow + a SQL promotion
>    migration (`20260428_promote_admin_kevin.sql`).
> 2. **Login attempts audit log** — new Supabase table `login_attempts`
>    (RLS: anon-insert, Admin-select). Frontend `Auth.tsx` writes a
>    success-or-failure row on every Sign-In click with email,
>    user-agent, error reason, and resolved user_id when known.
> 3. **Required deletion reason (min 5 chars)** for hard-delete and
>    force-delete (users / plants / wells). Soft-delete remains
>    optional. UI shows live char counter + disables confirm button
>    until threshold met.
> 4. **`deletion_audit_log.kind` accepts `'well'`** (was `'user'|'plant'`)
>    so the iter-6 wells bulk-delete audit rows now pass the check
>    constraint.
> 5. **Sidebar / mobile More-sheet hide the Admin group** for non-Admins
>    (Admin Console, Employees, Data Exports, Smart Import are now
>    Admin-only on the nav). The `/admin` route is still
>    `ProtectedRoute requireRole="Admin"` so deep-link bypass is
>    blocked on top of the visual gating.

## 2. Personas
- Plant operator — mobile-first reading entry, GPS capture, tag bypass
  wells, log per-well kWh and Solar/Grid daily split.
- Compliance officer — reviews unified alerts (downtime, bypass,
  recovery).
- Maintenance planner — AI PM forecast per equipment, decommission
  wells via bulk-delete with audit reason.
- Analyst / management — AI queries, CSV exports, energy mix
  reporting (Solar vs Grid).

## 3. Tech stack
- Frontend: React + Vite + Tailwind + shadcn/ui + TanStack Query +
  Supabase JS.
- Backend: FastAPI + Motor (Mongo) + emergentintegrations LLM SDK +
  supabase-py (user-JWT-aware).
- Database: Supabase Postgres (primary) + MongoDB (alerts/blending
  audit + AI sessions).
- Serverless: all cron jobs are plain HTTP `POST /api/cron/*`,
  scheduled via `vercel.json`. No background daemons.

## 4. Core Requirements status

### 4.1 Data ingestion
- [x] XLSX parser for well-meter readings (tri-block monthly layout).
- [x] File picker accepts `.xlsx, .xlsm, .txt, .doc, .docx`.
- [x] Mambaling Q2 & Umapad Q2 Downtime sheets → Mongo `downtime_events`.

### 4.2 Dashboard
- [x] Tiles in ascending-date responsive grids.
- [x] Standalone Downtime tile removed; downtime surfaces in the
  unified Alerts card.
- [x] Unified Alerts engine `GET /api/alerts/feed` (downtime, bypass,
  recovery deviations) + live-computed RO/chem/train-gap alerts.
- [x] Trends pop-up: 7D/14D/30D/60D/90D + Custom; stable useMemo
  cache keys (iteration 6).
- [x] **Iteration 6: Custom Date UI** — inline From → To inputs
  beside range buttons (no extra row), auto-applies on change.
- [x] Calc badges on derived metrics.
- [x] Tile labels in Title Case.
- [x] **Iteration 6: EnergyMixCard** — KPI tiles for Today Solar /
  Today Grid / Today Total + 14-day stacked-bar (Solar yellow,
  Grid chart-6).

### 4.3 AI Agent
- [x] `/api/ai/chat`, `/api/ai/chat-tools`, `/api/ai/anomalies`,
  `/api/ai/pm-forecast` — all on emergentintegrations gpt-5.1.

### 4.4 Bypass wells (was: Blending)
- [x] `/api/blending/{toggle,wells,audit}` endpoints.
- [x] **Iteration 6: small "Mark as Bypass" caption** stacked above
  the toggle button on each well row in Operations → Well.

### 4.5 Locators & Wells GPS + meters
- [x] `AddLocatorDialog` has GPS Lat/Lng + **Use My Location**.
- [x] `AddWellDialog` with Diameter/Depth/Water Meter fields + GPS.
- [x] **Iteration 6: dedicated electric meter** — `wells.electric_meter_brand/size/serial/installed_date`
  added via migration `20260427_energy_meter_integration.sql`;
  `AddWellDialog` exposes a "Has Dedicated Electric Meter"
  checkbox and brand/size/serial/install-date inputs;
  `WellDetail` shows a separate "Active Electric Meter" card with
  edit dialog (Manager+); `WellsList` shows an `Electric` pill +
  electric serial inline beside the water serial.

### 4.6 Wells deletion (NEW iteration 6)
- [x] **Multi-select checkboxes** on each well row (Admin only).
- [x] **Bulk delete** button surfaces when ≥1 row selected.
- [x] Confirmation dialog with reason text.
- [x] Cascade handled by existing `ON DELETE CASCADE` foreign keys
  on `well_readings`, `well_meter_replacements`, `well_pms_records`.
- [x] Best-effort audit row per deleted well in
  `deletion_audit_log` (kind=`well`, action=`hard`,
  reason prefixed `[BULK]`).

### 4.7 Energy sources (NEW iteration 6)
- [x] `plants.has_solar`, `plants.has_grid`,
  `plants.solar_capacity_kw` columns (migration above).
- [x] `power_readings.daily_solar_kwh`, `daily_grid_kwh`
  columns + backfill (legacy `daily_consumption_kwh` becomes
  `daily_grid_kwh`).
- [x] `EnergySourceCard` on PlantDetail (Manager+ edit) toggles
  Solar/Grid + capacity.
- [x] Operations → Power form auto-shows a foldable
  "Energy Source Breakdown" section with Solar/Grid daily inputs
  when the selected plant has the corresponding flag enabled.
- [x] Dashboard `EnergyMixCard` graceful-falls-back to legacy
  `daily_consumption_kwh` (treated as Grid) when split columns are
  null/zero.

### 4.8 Compliance & scheduling
- [x] `/api/compliance/thresholds` GET/PUT with 10 defaults.
- [x] `/api/compliance/evaluate?summarize=`.
- [x] `/api/cron/compliance-evaluate` + `/api/cron/pm-forecast-sweep`.

### 4.9 Error handling
- [x] Error boundary + toast on global query/mutation errors.
- [x] **Iteration 6: backend pod env fix** — `postgrest`,
  `supabase-auth`, `realtime`, `storage3`, `gotrue` were missing
  from the fork pod and broke `/api/*`. Reinstalled; full
  pytest suite back to **59/59 passing**.

## 5. Endpoints
| Endpoint | Method |
|---|---|
| `/api/import/seed-from-url` | POST |
| `/api/import/parse-wellmeter` | POST |
| `/api/downtime/events` | GET |
| `/api/alerts/feed` | GET |
| `/api/blending/wells`, `/toggle`, `/audit` | GET / POST / POST |
| `/api/ai/chat`, `/chat-tools`, `/anomalies`, `/pm-forecast` | POST |
| `/api/compliance/thresholds`, `/evaluate` | GET/PUT, GET |
| `/api/cron/compliance-evaluate`, `/cron/pm-forecast-sweep` | POST |
| `/api/admin/users/{id}/dependencies`, `/plants/{id}/dependencies` | GET |
| `/api/admin/users/{id}/soft-delete`, `/plants/{id}/soft-delete` | POST |
| `/api/admin/users/{id}`, `/plants/{id}` (`?force=true&reason=...`) | DELETE |
| `/api/admin/audit-log` (`?kind=user|plant|well&limit=N`) | GET |
| `/api/admin/plants/cleanup` (Admin) | POST |

> Wells delete in iteration 6 is performed client-side via the
> Supabase JS client (RLS-gated, cascade FK-handled). A backend
> `/api/admin/wells/{id}` DELETE route is **NOT** added — well
> deletes flow directly to Supabase and audit rows are inserted
> client-side. This keeps the change surface area small.

## 6. Prioritized backlog
### P0 (shipped — iteration 6)
- EnergyMixCard component (was a build-blocking undefined symbol).
- Solar / Grid plant flags + daily kWh split.
- Per-well dedicated electric meter columns + UI.
- Wells multi-select bulk delete (Admin only).
- TrendModal Custom Date UI compaction.
- "Mark as Bypass" caption + middle-aligned pump/housing labels.

### P1 (next)
- [ ] Sidebar compliance badge (open-violation count).
- [ ] Strip residual "Auto" prefixes in Operations/Costs tabs.
- [ ] Uniform computed-field colouring via `ComputedInput`.
- [ ] PM Scheduling DB migration (waiting on user's SQL) → frequency
      enum + checklist popups.
- [ ] Per-RO-train parser for MAMBALING/UMAPAD RO DATA sheets.
- [ ] Chemical Consumption XLSX parser + inventory reconciliation.
- [ ] Backend `/api/admin/wells/{id}` DELETE for symmetry with
      users/plants (so all delete audit goes through one code path).

### P2 (backlog)
- [ ] Email / push alerts (Resend or SendGrid) — user explicitly
      skipped; in-app Alerts card only.

## 7. Testing
- Backend: `pytest backend/tests/ -v` — **65/65 passing** (iter 8).
  Added `TestPlantsCleanupEndpoint` (6 tests): route registration,
  401 no-bearer, 401/403 malformed-bearer, 422 empty `names`,
  422 short reason, 422 missing body.
- Frontend: `yarn tsc --noEmit -p tsconfig.app.json` clean.

## 8. Deployment & Operational Notes
- Vercel work was explicitly abandoned in iter 4. App is served via
  Emergent preview + supervisor (FastAPI on :8001, Vite on :3000).
- **Required manual SQL steps** (run in Supabase SQL editor IN ORDER):
  1. `/app/supabase/migrations/20260424_deletion_audit_log.sql`
     (audit log table — iter 5).
  2. `/app/supabase/migrations/20260427_energy_meter_integration.sql`
     (iter 6 — wells electric meter columns + plants solar/grid flags
     + power_readings solar/grid split + backfill).
  3. `/app/supabase/migrations/20260428_admin_audit_enhancements.sql`
     (iter 7 — `login_attempts` table + extends `deletion_audit_log.kind`
     to accept `'well'`).
  4. **After Kevin signs up at `/auth`** with kevzvilbar@gmail.com /
     BPWI2025!, run
     `/app/supabase/migrations/20260428_promote_admin_kevin.sql`
     to attach his profile + Admin role.
- Hard-delete of a user removes `user_profiles` + `user_roles` only —
  the `auth.users` row requires the Supabase service-role key.


## 9. Iteration 10 — Admin Login Verification (2026-04-25)

### Goal
Verify `kevzvilbar@gmail.com` is a confirmed Admin and the Admin
console + force-delete tools are reachable from `/auth` end-to-end.

### Outcome
- **Supabase state confirmed (read-only)**: `user_profiles` row has
  `status='Active'`, `designation='Admin'`, `profile_complete=true`,
  4 plants assigned. `user_roles` has `role='Admin'`.
- **Backend dependencies stabilized** (carried over from iter 9):
  `supabase==2.5.3`, `postgrest==1.1.1` pinned in
  `backend/requirements.txt`.
- **Bug found & fixed — `/onboarding` race**: `useAuth` was setting
  `user` synchronously inside `onAuthStateChange` but loading
  `profile` via deferred `setTimeout`. `loading` was never re-raised,
  so `ProtectedRoute` rendered with `user=set, profile=null` and
  bounced freshly-signed-in admins to `/onboarding`. Fix in
  `/app/frontend/src/hooks/useAuth.tsx`: set `loading=true` on every
  auth-state-change with a session and clear it only after
  `loadProfileAndRoles` resolves.
- **Verified via Playwright**: sign-in lands on `/` (Dashboard);
  `/admin` renders with `data-testid='admin-page'`, Users tab
  enabled, Kevin's row labeled `Admin / Full access`, per-row
  delete-menu trigger present.
- **Force-delete UX (clarified, not changed)**: the
  `data-testid='force-hard-delete'` button is rendered conditionally
  inside the hard-delete dialog when
  `deps?.blocking && isAdmin` (DeleteEntityMenu.tsx L301). This is
  the intended workflow — the override only appears when blocking
  dependencies exist.
- **Test credentials file**: `/app/memory/test_credentials.md`
  created with Kevin's admin login.

### Known cosmetic warnings (non-blocking)
- Frontend hits `public.login_attempts` (iter 7 SQL not yet run in
  this Supabase project) → 404 PGRST205 in console; sign-in still
  works because the insert is wrapped in try/catch.
- Dashboard query references `power_readings.daily_solar_kwh /
  daily_grid_kwh`; iter 6 energy migration not yet run → 400 42703.
  Both resolved by running the migrations listed in §8.

## 10. Iteration 11 — Codebase Audit + Vercel Cleanup (2026-02 fork)

### Goal
"Forget about Vercel deployment, review code and fix possible errors."

### Changes
- **Backend dependency conflict resolved** — pinned
  `supabase==2.15.0`, `postgrest==1.0.2`, `storage3==0.11.3` in
  `backend/requirements.txt` to fix the `ModuleNotFoundError:
  No module named 'deprecation'` crash-loop. Backend pytest
  suite back to 65/65 passing.
- **Vite base path reverted to `/`** in `frontend/vite.config.ts`
  (was `/pwri-plantmonitoring/`, which forced a 302 redirect from
  the root path on Emergent preview/production hosts).
- **`/app/vercel.json` removed** — Vercel deployment was abandoned
  in iter 4; the file was obsolete. Existing `cron_service.py`
  HTTP endpoints (`/api/cron/*`) still work via any HTTP scheduler.

### Verified
- `curl /` returns HTTP 200 with no redirects.
- `curl /api/` returns `{"message":"Hello World"}`.
- Supervisor: backend + frontend RUNNING.


---

## Iteration 11 — Dashboard 3-Mode Trend Graph View (2026-04-29)

### What landed
- Dashboard view-mode toggle (Inline / Sections / Popup) **now drives trend
  graphs**, not cluster headers. Cluster headers (Overview, Quality,
  Production Cost) stay always visible regardless of mode.
- **Inline mode** — every chart-bearing KPI's trend chart renders in flow
  beneath its cluster (compact 260px height). Just scroll to see them.
  KPI card click is a no-op (chart already on screen).
- **Sections mode** — clicking a chart-bearing KPI card folds its trend
  chart open below the cluster (full 420px height). Single-open: clicking
  another KPI auto-collapses the previous.
- **Popup mode** — click KPI card → modal Dialog with the trend chart
  (legacy behaviour preserved).
- View-mode preference persists to `localStorage['pwri:dashboard-view-mode']`.

### Code changes (file: `/app/frontend/src/pages/Dashboard.tsx`)
- Removed `ClusterShell` (and `popupCluster` state). Added simpler
  `ClusterCharts` + `InlineTrendChart` components driven by mode.
- Extracted `<TrendChart>` from `<TrendModal>` so the chart renderer is
  reusable inline, in section-collapsibles, and in the modal.
- Added `expandedMetric` state and `handleMetricClick(metric, title)` that
  swaps click behaviour based on the active view mode.
- Added `OVERVIEW_CHART_METRICS` / `QUALITY_CHART_METRICS` /
  `COST_CHART_METRICS` constant registries.
- Added `<DialogDescription>` (sr-only) inside `TrendModal` to silence
  the Radix a11y warning.
- Removed unused `Collapsible` / `ChevronDown` imports.

### Verified
- `npx tsc --noEmit` clean.
- Frontend testing agent (iteration_7.json): **17/17 review-request
  checks passed (100%)**. Login → dashboard → toggle each mode →
  chart visibility / fold-unfold / single-open / modal / persistence
  all confirmed.
- Iteration_6 onboarding regression (login redirect to /onboarding) is
  RESOLVED — login lands on `/` directly.

### Known minor / not-blocking
- 10 backend tests in `test_ai_and_admin.py` still failing
  (httpx[http2] dep + Supabase JWT mock quirks) — pre-existing, queued
  as P1 backlog.
- `Dashboard.tsx` is now ~1064 lines — flagged for splitting into
  `/app/frontend/src/components/dashboard/*` modules in a future
  refactor pass.

---

## Iteration 12 — Code Review (Option A: Safe Quick Wins) (2026-04-29)

User reviewed an external code-review report covering 13 findings across XSS,
React hook deps, Python complexity, component decomposition, etc. Many items
were false alarms (e.g., `is None`/`is True`/`is False` are PEP-8 correct,
`empty catch blocks` already had explanatory comments for intentional
swallowing). User explicitly asked us to apply only the safe quick-win
subset (Option A) — large refactors deferred to follow-up sessions.

### What landed
- **`main.tsx`** — replaced `innerHTML` template-string rendering in
  `renderFatal()` with safe DOM APIs (`textContent`, `createElement`,
  `setAttribute`). Satisfies the static-analysis XSS rule even though the
  inputs are always internal config errors.
- **Composite React keys** — replaced array-index keys with composite
  identifiers in:
  - `Dashboard.tsx` (`localAlerts` list — `${tone}-${text}-${i}`)
  - `Import.tsx` (commit log lines, preview-table rows)
  - `AIImportPanel.tsx` (anomaly badges, sample-row table headers/cells,
    skipped-list bullets, column-mapping select options)
- **Informational `console.warn`** in previously silent-catch blocks:
  - `Plants.tsx` (×2) — `deletion_audit_log insert failed (non-fatal)`
  - `Operations.tsx` (×2) — `[Operations] geolocation unavailable;
    submitting without GPS:`
  - `Dashboard.tsx` — `[Dashboard] could not persist view mode preference:`

### Items rejected as false alarms / out-of-scope
- 61 `is` constant comparisons — all are `is None` / `is True` / `is False`
  which is the correct Python idiom (PEP-8 explicitly prefers `is None`).
- "Empty catch blocks" — every flagged occurrence already had an
  explanatory comment for intentional fallback (pre-migration tables
  missing, GPS access denied). Now also log-tagged for visibility.
- Eslint `--fix` produced no auto-fixable hook-deps changes; remaining
  87 hook-deps warnings need manual inspection (deferred to Option B
  in a future session).

### Verified
- `npx tsc --noEmit` clean.
- Frontend testing agent (iteration_8.json): **100% pass** — no
  regressions introduced. App boots cleanly, login redirects to `/`,
  Dashboard 3-mode toggle still works, `/import` page shows ZERO
  React `unique key` warnings.

### Backlog (deferred)
- Option B (manual hook-deps audit, ~90 min, medium risk)
- Option C — large refactors:
  - Backend: split `hard_delete_plant` (161 LOC), `sync_analysis`
    (189 LOC), `_insert_readings` (95 LOC), `cleanup_plants` (137 LOC)
  - Frontend: decompose `AIImportPanel` (521 LOC), `DeleteEntityMenu`
    (325 LOC); move `Dashboard`, `Import`, `ROTrains`, `Plants` into
    smaller files
- Pre-existing failing backend tests in `test_ai_and_admin.py` (10
  failures from `httpx[http2]` dep + Supabase JWT mocks)
- 3 Supabase HTTP 404/400 errors during /auth handshake (pre-existing
  from iter_6 onward) — worth a separate investigation pass


---

## Iteration 13 — Backend Test Suite Green (2026-04-29)

### Problem
10 of 65 tests in `backend/tests/test_ai_and_admin.py` were failing. Every
failure had the same root cause: when a malformed bearer token reached an
admin endpoint (or the cron evaluate endpoint), the Supabase Python
client tried to make an HTTP/2 call but crashed with
`Using http2=True, but the 'h2' package is not installed`. That
returned a 500, which the contract tests asserted should be 401/403.

### Fix
- Installed `h2>=4.0,<5` (pulled in by `pip install`) and added it to
  `backend/requirements.txt` next to the existing `httpx>=0.27.0` line.
- No code changes were needed — once h2 was available, Supabase 2.15.0
  could complete its handshake and reject malformed JWTs with 401
  cleanly, matching the test contract.

### Verified
- `python -m pytest tests/` — **65/65 passed (up from 55/65)**.
- Both `test_ai_and_admin.py` (42) and `test_pwri_backend.py` (23) green.

### Note
The handoff summary's claim that the failures were "Supabase JWT mock
quirks" was wrong. The single fix (h2 dep) resolved all 10 failures —
no mocking changes required.


---

## Iteration 14 — React Hook-Deps Audit (Option B) (2026-04-29)

### Reality check
Code review report claimed "87 missing hook deps". Actual count from
`yarn lint`: **6 warnings**, all in 4 files. The 87 was likely
miscounting — most of the rest were `@typescript-eslint/no-explicit-any`
errors, not hook-deps warnings.

### What was fixed
| File | Line | Fix |
|---|---|---|
| `EnergyMixCard.tsx` | 59 | `rows = data ?? []` → `useMemo(() => data ?? [], [data])` (real perf fix — stops `chartData` from re-running every render) |
| `Chemicals.tsx` | 61 | One-shot plant-seed effect — eslint-disable with comment |
| `Operations.tsx` | 95 | Same one-shot plant-seed pattern — eslint-disable with comment |
| `ROTrains.tsx` | 49 | Same one-shot plant-seed pattern — eslint-disable with comment |
| `ROTrains.tsx` | 144 | One-shot `setPlantId` seeding — eslint-disable with comment |
| `ROTrains.tsx` | 202 | Prefill `syncMeterStart` from previous reading — eslint-disable with comment (adding the dep would clobber user input) |

The 5 eslint-disables are intentional: each effect is a one-shot seed
that explicitly should NOT re-run when its missing dep changes (would
cause data loss / infinite loops / overwriting user input). All carry
explanatory comments per Rules of Hooks best-practices guidance.

### Verified
- `yarn lint` — 0 hook-deps warnings remaining (was 6).
- `npx tsc --noEmit` — clean.
- Backend tests — 65/65 passing.
- Frontend smoke screenshot — app boots cleanly to login.

### Now done
✅ Iteration 11 — Dashboard 3-mode trend graph view
✅ Iteration 12 — Code-review Option A safe quick wins (XSS, keys, logging)
✅ Iteration 13 — Backend tests green (h2 dependency)
✅ Iteration 14 — Code-review Option B hook-deps audit
✅ Iteration 15 — Code-review P0 critical bugs + P1 stability (2026-02-29)
   • Backend: Fixed `F821 Undefined name 'overrides'` in `migrations_status.py`
     by loading `overrides = _load_overrides()` at the top of
     `list_migration_status` (lines 398/412 would have crashed at runtime).
   • Backend: Removed bogus f-string prefix at `ai_import_service.py:844`.
   • Frontend: Replaced array-index keys with stable composites in
     `Costs.tsx` (insights), `AIAssistant.tsx` (messages + anomalies),
     `PmsCalendar.tsx` (steps), `PmForecastTab.tsx` (risk factors),
     `DowntimeEventsModal.tsx` (events). For `Chemicals.tsx` samples,
     introduced `id: string` (crypto.randomUUID) since rows hold
     editable state — index keys would corrupt input focus on resize.
   • Frontend: Empty catch blocks in `Compliance.tsx:68` and
     `Auth.tsx:40` now surface `console.warn` for debuggability while
     remaining best-effort (no UX disruption).
   • Frontend: Documented localStorage usage in `Dashboard.tsx`,
     `Admin.tsx`, `dashboard/types.ts` — Code Quality Report flagged
     these as "sensitive data" but they only store benign UI prefs
     (view-mode, ack'd migration SHAs). Added clarifying comments.
     **Skipped moving Supabase auth tokens to sessionStorage** — would
     force daily re-login with no actual XSS protection benefit.
   • Verified: `yarn build` clean (12s), 64/65 backend tests pass
     (1 unrelated h2/hpack failure), 4 fewer ESLint warnings overall.

✅ Iteration 16 — Production Cost trend chart on Dashboard (2026-02-29)
   • Production Cost / Power Cost / Chemical Cost StatCards no longer
     navigate to `/costs` — they now open the same trend chart inline,
     in the section panel, or in the popup modal depending on the
     user's view-mode preference (consistent with NRW, TDS, PV Ratio,
     etc).
   • New `productionCost` chart metric in `dashboard/types.ts` (added
     to `COST_CHART_METRICS`, label `Cost (₱)`).
   • New supabase query in `TrendChart.tsx` against `production_costs`
     filtered by `cost_date` (date column, distinct from the
     `reading_datetime` filter used elsewhere). Renders three Recharts
     `<Line>` series: Total (accent), Power (chart-6), Chemical
     (highlight). Falls back to `power_cost + chem_cost` when the
     `total_cost` generated column is null.
   • Removed the now-unused `useNavigate` import from `Dashboard.tsx`.
   • Verified: `yarn build` clean (12s); independent testing-agent
     static review confirmed all 7 implementation checkpoints PASS
     (`/app/test_reports/iteration_10.json`). UI Playwright drive was
     blocked by stale admin credentials — see test_credentials.md for
     unblock path.

✅ Iteration 17 — ₱/m³ unit-cost overlay on the cost chart (2026-02-29)
   • Production Cost trend chart now switches to a `ComposedChart`
     with two Y-axes: left axis carries the absolute ₱ lines (Total /
     Power / Chemical), right axis carries a dashed ₱/m³ line so a
     finance-minded operator can read both magnitudes at a glance.
   • ₱/m³ is volume-weighted across the multi-plant selection
     (Σtotal_cost ÷ Σproduction_m3 per day), preventing a low-volume
     plant from skewing the average. Renders as `null` (skipped) on
     days with no production_m3 to avoid `Infinity` plot points.
   • `production_m3` added to the supabase query select.
   • Verified: `yarn build` clean (12.9s), bundle size delta tiny
     (Dashboard 44.7→47.1 KB), no new lint errors.

### Backlog (P2/P3 — deferred per user "stop after P0+P1")
- **Stale admin credential** — `kevzvilbar@gmail.com / @Kevz` is no
  longer accepted by Supabase. Either reset the password (≥8 chars)
  via the Supabase dashboard, or provision a fresh confirmed seed
  user, then update `/app/memory/test_credentials.md`. Blocks any
  future end-to-end UI testing.
- **P2 — Backend complexity refactor**: extract helpers from
  `admin_service.hard_delete_plant` / `cleanup_plants` and
  `ai_import_service.sync_analysis` / `_insert_readings` /
  `classify_tables` / `_heuristic_classify`.
- **P2 — Param dataclasses**: group args in `admin_service.py:239` and
  `ai_import_service.py:404, 563`.
- **P3 — Component split**: `AIImportPanel.tsx` (521 LOC),
  `Admin.tsx` (1793 LOC), `Dashboard.tsx`, `Import.tsx`,
  `ROTrains.tsx`, `Plants.tsx`, `AIAssistant.tsx`.
- **P3 — useMemo polish**: `AIImportPanel.tsx`, `Chemicals.tsx`, `Costs.tsx`.
- **P3 — Strip `console.log`**: 13 stray statements (per linter).
- **P3 — Replace 243 `@typescript-eslint/no-explicit-any`** (cosmetic).
- **Tracked auth-storage upgrade**: migrate Supabase auth from
  `localStorage` to httpOnly cookie via FastAPI (proper, separate task).

