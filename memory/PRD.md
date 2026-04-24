# PWRI Monitoring — Product Requirements (PRD)

_Last updated: 2026-04-24 (iteration 3)_

## 1. Problem Statement (verbatim — consolidated across 3 iterations)
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

## 2. Personas
- Plant operator — mobile-first reading entry, GPS capture, tag bypass
  wells.
- Compliance officer — reviews unified alerts (downtime, bypass,
  recovery).
- Maintenance planner — AI PM forecast per equipment.
- Analyst / management — AI queries, CSV exports.

## 3. Tech stack
- Frontend: React + Vite + Tailwind + shadcn/ui + TanStack Query +
  Supabase JS.
- Backend: FastAPI + Motor (Mongo) + emergentintegrations LLM SDK +
  supabase-py (user-JWT-aware).
- Serverless: all cron jobs are plain HTTP `POST /api/cron/*`, scheduled
  via `vercel.json`. No background daemons.

## 4. Core Requirements status

### 4.1 Data ingestion
- [x] XLSX parser for well-meter readings (tri-block monthly layout).
- [x] File picker now accepts `.xlsx, .xlsm, .txt, .doc, .docx`.
- [x] **"Seed attached samples" card removed** per latest UX direction —
  the endpoint `/api/import/seed-from-url` still exists for CI / cron use.
- [x] Mambaling Q2 & Umapad Q2 Downtime sheets → Mongo `downtime_events`.

### 4.2 Dashboard
- [x] Tiles in ascending-date responsive grids.
- [x] Standalone Downtime tile removed; downtime surfaces in the
  unified Alerts card.
- [x] Unified Alerts engine `GET /api/alerts/feed` (downtime, bypass,
  recovery deviations) + live-computed RO/chem/train-gap alerts.
- [x] Trends pop-up: **axis-label paragraph removed**, range buttons
  7D/14D/30D/60D/90D + Custom re-run the query; Raw Water Trendline &
  Recovery Trendline wired.
- [x] Calc badges on derived metrics.
- [x] Tile labels in Title Case (e.g. "Production Trend", "Bypass →
  Product").

### 4.3 AI Agent
- [x] `/api/ai/chat` conversational.
- [x] `/api/ai/chat-tools` planner → Supabase whitelisted queries →
  answer.
- [x] `/api/ai/anomalies` batch anomaly detection.
- [x] `/api/ai/pm-forecast` single-equipment PM next-date.

### 4.4 Bypass wells (was: Blending)
- [x] `/api/blending/{toggle,wells,audit}` endpoints (kept name for
  backward-compat; UI copy is "Mark As Bypass Well").
- [x] Frontend: `Waves` button with text **"Mark As Bypass"** on each
  well row; `Bypass` badge on tagged wells; UI enforces a prior meter
  reading before a well can be marked bypass.
- [x] Saving a reading for a bypass well auto-logs an event →
  Dashboard Alerts ("Bypass · Well X — injected N m³").
- [x] Optional Supabase migration file
  `/app/frontend/supabase/migrations/20260424_blending_well_flag.sql`.

### 4.5 Locators & Wells GPS
- [x] `AddLocatorDialog` has GPS Lat/Lng + **Use My Location** button.
- [x] New `AddWellDialog` with Diameter/Depth/Meter fields + GPS
  Lat/Lng + **Use My Location** (`data-testid="add-well-btn"`,
  `add-well-lat`, `add-well-lng`, `use-my-location-btn`).
- [x] Locator + Well detail cards show `GPS: lat, lng` with a MapPin
  icon; Well list inline badge shows truncated coords.

### 4.6 Compliance & scheduling
- [x] `/api/compliance/thresholds` GET/PUT with 10 defaults.
- [x] `/api/compliance/evaluate?summarize=`.
- [x] `/api/cron/compliance-evaluate` + `/api/cron/pm-forecast-sweep`
  serverless endpoints, `X-Cron-Secret` gated; scheduled in
  `vercel.json`.

### 4.7 Error handling
- [x] **"Load failed (ro-last): … data is undefined"** fixed — `queryFn`
  now returns `?? null` explicitly.
- [x] Error boundary + toast on global query/mutation errors.

### 4.8 Nav & polish
- [x] `/exports` route wired.
- [x] Mobile bottom nav + sheet untouched.
- [x] Title Case across main views, Notes remain free-form.

## 5. Endpoints
| Endpoint | Method |
|---|---|
| `/api/import/seed-from-url` | POST |
| `/api/import/parse-wellmeter` | POST |
| `/api/downtime/events` | GET |
| `/api/alerts/feed` | GET |
| `/api/blending/wells` | GET |
| `/api/blending/toggle` | POST |
| `/api/blending/audit` | POST |
| `/api/ai/chat`, `/api/ai/chat-tools`, `/api/ai/anomalies`, `/api/ai/pm-forecast` | POST |
| `/api/compliance/thresholds` | GET/PUT |
| `/api/compliance/evaluate` | GET |
| `/api/cron/compliance-evaluate`, `/api/cron/pm-forecast-sweep` | POST |

## 6. Prioritized backlog
### P0 (shipped)
All three cycles of user asks — see sections 4.1 → 4.8.

### P1 (next)
- [ ] Sidebar compliance badge (open-violation count).
- [ ] Strip residual "Auto" prefixes in Operations/Costs tabs.
- [ ] Uniform computed-field colouring via `ComputedInput`.
- [ ] PM Scheduling DB migration (waiting on user's SQL) → frequency
      enum + checklist popups.
- [ ] Per-RO-train parser for MAMBALING/UMAPAD RO DATA sheets.
- [ ] Chemical Consumption XLSX parser + inventory reconciliation.

### P2 (backlog)
- [ ] Email / push alerts (Resend or SendGrid) — user explicitly
      skipped; in-app Alerts card only.

## 7. Testing
- Backend: `pytest backend/tests/test_pwri_backend.py -v` —
  **23/23 passing** including new "Bypass ·" title assertion (iter 3).
- Frontend: source-verified in iter 3 (testing agent blocked by
  Supabase "Confirm email" — no service-role key available). User can
  self-verify interactively.

## 8. Deployment (Vercel)
- `vercel.json` valid (Python 3.11 runtime + cron schedule). User has
  unlinked the repo for now.
- For CI / future e2e automation, either disable
  "Confirm email" on the Supabase project OR seed a pre-confirmed user
  + record credentials in `/app/memory/test_credentials.md`.
