# PWRI Monitoring — Product Requirements (PRD)

_Last updated: 2026-04-24 (iteration 6)_

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
> 1. **Energy & Meter Integration** — dedicated electric meters for
>    wells (kWh meter beside the water meter on Well View);
>    Solar + Grid configuration per plant; foldable per-plant
>    Solar/Grid daily kWh entry on Operations → Power; Dashboard
>    EnergyMixCard with KPI tiles (Today Solar/Grid/Total) + 14-day
>    stacked-bar trend.
> 2. **Wells Deletion (Admin)** — multi-select checkboxes on the
>    plant Wells tab + bulk hard-delete with reason + best-effort
>    audit-log row per deleted well (cascade handled by ON DELETE
>    CASCADE on `well_readings`/`well_meter_replacements`/
>    `well_pms_records`).
> 3. **Dashboard / UX polish** — fix TrendModal 7D–90D blank issue
>    (now uses stable `useMemo` cache keys), redesigned Custom date
>    UI (inline From → To beside the range buttons),
>    "Mark as Bypass" small caption above the toggle button,
>    Booster-pump and filter-housing labels middle-aligned in
>    ROTrains.

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
- Backend: `pytest backend/tests/ -v` — **59/59 passing** (iter 6).
  No new tests added — energy / wells deletion logic is purely
  client-side Supabase calls.
- Frontend: `yarn tsc --noEmit -p tsconfig.app.json` clean.

## 8. Deployment & Operational Notes
- Vercel work was explicitly abandoned in iter 4. App is served via
  Emergent preview + supervisor (FastAPI on :8001, Vite on :3000).
- **Required manual SQL steps** (run in Supabase SQL editor):
  1. `/app/supabase/migrations/20260424_deletion_audit_log.sql`
     (audit log table — from iter 5).
  2. `/app/supabase/migrations/20260427_energy_meter_integration.sql`
     (NEW — wells electric meter columns + plants solar/grid flags
     + power_readings solar/grid split + backfill).
  Until #2 runs, the EnergyMixCard reads `daily_consumption_kwh`
  as Grid, AddWell electric-meter inputs are silently dropped,
  and the Plant EnergySourceCard cannot persist `has_solar`/
  `has_grid`.
- Hard-delete of a user removes `user_profiles` + `user_roles` only
  — the `auth.users` row requires the Supabase service-role key.
