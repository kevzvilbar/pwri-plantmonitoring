# PWRI Monitoring — Product Requirements (PRD)

_Last updated: 2026-04-24 (iteration 2)_

## 1. Problem Statement (verbatim)
> "Check for possible error and improve pls the app pls" + pre-load 8 real
> XLSX files (Mambaling Q1+Q2, SRP×2, Umapad×2, SRP MCWD, Guizo); remove
> the standalone Downtime field and fold downtime into unified Alerts;
> fix Dashboard Trends pop-up (X=Date, Y=Value, ascending; add Raw Water
> Trendline and Recovery Trendline); add Blending-well tagging with audit
> trail; keep app mobile-friendly and Vercel-compatible.

## 2. Personas
- Plant operator — mobile-first reading entry, tag blending wells.
- Compliance officer — reviews NRW/TDS/downtime violations; unified
  alerts card.
- Maintenance planner — AI PM forecast per equipment.
- Analyst / management — AI queries, CSV exports.

## 3. Tech stack
- Frontend: React + Vite + Tailwind + shadcn/ui + TanStack Query +
  Supabase JS (auth + DB).
- Backend: FastAPI + Motor (Mongo) + `emergentintegrations` LLM SDK +
  `supabase-py` (user-JWT-aware).
- Serverless-ready: all cron jobs are plain HTTP `POST /api/cron/*`
  endpoints wired through `vercel.json`. No background daemons.

## 4. Core Requirements status

### 4.1 Data ingestion
- [x] XLSX parser for well-meter readings (tri-block monthly layout).
- [x] **Seed 8 attached samples** one-click button on `/import`:
  Mambaling 3 (Q1+Q2), SRP (x2), Umapad (x2), SRP MCWD, Guizo.
  - Existing `well_readings` for the same (plant,well,date) are
    overridden; missing rows inserted. Signed-in user JWT forwarded.
- [x] Mambaling Q2 & Umapad Q2 `Downtime` sheets parsed into Mongo
  `downtime_events` (300+ events extracted end-to-end).

### 4.2 Dashboard
- [x] Tiles in ascending-date responsive grids.
- [x] **Standalone Downtime tile removed** — downtime surfaces in the
  unified Alerts card instead.
- [x] **Unified Alerts engine** (`GET /api/alerts/feed`) combines:
  - Prolonged shutdown (≥12 h) & abnormal patterns (≥3 events, ≥6 h)
  - Blending audit events (well tagged → volume > 0 today)
  - Recovery deviations (`recovery_pct_under` in latest compliance
    snapshots)
  Plus live-computed RO / chem / train-gap alerts (RO DP, TDS, pH,
  low-stock chemicals).
- [x] Clicking a downtime alert opens the drill-down modal.
- [x] **Trends pop-up fixes**: X-axis labelled "Date (ascending · start →
  end)", Y-axis labelled per metric. New lines for **Raw Water
  Trendline** and **Recovery Trendline**.
- [x] Calc badges on derived metrics (NRW, PV, Production Cost).

### 4.3 AI Agent
- [x] `/api/ai/chat`, `/api/ai/chat-tools` (planner → Supabase
  whitelisted queries → answer), `/api/ai/anomalies`, `/api/ai/pm-forecast`.

### 4.4 Blending wells
- [x] Mongo-backed `blending_wells` collection; `blending_events`
  collection for audit history.
- [x] Frontend: toggle icon on each well row (Operations → Well tab) —
  `Waves` icon, Blending badge when tagged.
- [x] Saving a well reading from a blending well logs a blending event
  so it appears under Dashboard → Alerts.
- [x] Optional Supabase migration file
  `/app/frontend/supabase/migrations/20260424_blending_well_flag.sql` so
  the column can later live on `wells` too.

### 4.5 Compliance & scheduling
- [x] `/api/compliance/thresholds` GET/PUT with 10 defaults.
- [x] `/api/compliance/evaluate?summarize=true|false`.
- [x] `/api/cron/compliance-evaluate` and `/api/cron/pm-forecast-sweep`
  (serverless, `X-Cron-Secret` gated), `vercel.json` schedule.

### 4.6 Nav & polish
- [x] `/exports` route wired (dead link fixed).
- [x] Mobile bottom nav + side sheet untouched.
- [x] Proper capitalization ("Raw Water Trendline", "Active Alerts",
  "Blending", etc.).

## 5. Endpoints (new in this iteration)
| Endpoint | Method | Purpose |
|---|---|---|
| `/api/alerts/feed` | GET | Unified alerts feed (downtime/blending/recovery) |
| `/api/blending/wells` | GET | List tagged blending wells |
| `/api/blending/toggle` | POST | Tag/untag a well as blending |
| `/api/blending/audit` | POST | Record blending injection (well, date, m³) |

## 6. Prioritized backlog
### P0 (shipped in this cycle ✅)
- [x] 8-file bulk seeder, override semantics
- [x] Downtime removed from tiles → unified Alerts feed
- [x] Raw Water + Recovery trendlines with labelled axes
- [x] Blending well tagging + audit events
- [x] Unified Alerts engine

### P1 (next)
- [ ] Sidebar compliance badge (count of open violations from
      `compliance_snapshots`).
- [ ] Strip residual "Auto" prefixes from Operations/Costs tabs.
- [ ] Uniform computed-field colouring via `ComputedInput`.
- [ ] PM Scheduling DB migration (waiting for SQL) → frequency enum +
      checklist popups.
- [ ] Per-RO-train detailed parser for "MAMBALING/UMAPAD RO DATA" sheets.
- [ ] Chemical consumption XLSX parser + inventory reconciliation.

### P2 (backlog)
- [ ] Email / push alerts (Resend or SendGrid) — **user skipped for now**.

## 7. Testing
- Backend: `pytest backend/tests/test_pwri_backend.py -v` — **23/23
  passing** as of iteration 2.
- `/app/test_result.md` + `/app/test_reports/iteration_2.json`.

## 8. Deployment (Vercel — user has unlinked repo for now)
- `vercel.json` still valid; app architecture is serverless-friendly.
- When re-linking, ensure env vars are set and the Python runtime is
  `python3.11`.
