# PWRI Monitoring — Product Requirements (PRD)

_Last updated: 2026-04-24_

## 1. Problem Statement (verbatim)
> "Check for possible error and improve pls the app pls"
> + incorporate the data from 4 attached XLSX files (override existing if
>   different), fix missing clickable items, keep mobile-friendly,
>   Dashboard Downtime should be a list of issues that cause operation
>   stops + how long it takes, and keep the app friendly with Vercel.

## 2. Personas
- **Plant operator**: enters meter/locator readings on mobile, scans
  anomalies, reviews daily downtime.
- **Compliance officer**: reviews NRW/TDS/downtime violations, receives
  daily compliance snapshots (cron).
- **Maintenance planner**: consumes AI PM forecasts per equipment.
- **Analyst / management**: runs AI queries, exports CSVs.

## 3. Tech stack
- Frontend: React + Vite + Tailwind + shadcn + Supabase JS client (auth +
  DB) + TanStack Query.
- Backend: FastAPI + Motor/MongoDB + `emergentintegrations` LLM SDK +
  `supabase-py` (for backend-side writes/queries when a user JWT is
  forwarded).
- Serverless: deployed on Vercel — cron jobs are exposed as plain HTTP
  `POST /api/cron/*` endpoints and scheduled via `vercel.json`
  (no background threads).

## 4. Core Requirements

### 4.1 Data ingestion
- [x] XLSX parser for well-meter readings (tri-block monthly layout).
- [x] One-click "Seed attached samples" on `/import` → ingests the 4
  provided XLSX files (Mambaling Q1 + Q2, SRP, Umapad). Existing
  `well_readings` rows for the same (plant, well, date) are UPDATED;
  missing rows are INSERTED.
- [x] Backend endpoint `POST /api/import/seed-from-url` orchestrates the
  ingest. Uses the signed-in user's Supabase JWT via
  `Authorization: Bearer …` so RLS applies.
- [x] `Downtime` worksheet parsed into Mongo `downtime_events`
  (date, subsystem, duration_hrs, cause). 300 events extracted from the
  Mambaling Q2 file end-to-end.

### 4.2 Dashboard
- [x] Tiles laid out in ascending-date responsive grids.
- [x] Downtime tile clickable → opens a modal listing each shutdown
  event with date, subsystem (RO #3, Well #1, MCWD Supply…),
  duration, cause, and filter chips per subsystem.
- [x] Calc badges mark computed metrics (NRW, PV ratio, production cost).
- [x] Clickable production/consumption/NRW/PV/Product-TDS tiles.
- [x] Raw turbidity / feed TDS / recovery / power / cost tiles render.

### 4.3 AI Agent
- [x] `/api/ai/chat` — multi-turn conversational Q&A (OpenAI gpt-5.1 via
  Emergent LLM key).
- [x] `/api/ai/anomalies` — batch anomaly detection on reading payloads.
- [x] `/api/ai/pm-forecast` — single-equipment PM next-date suggestion.
- [x] `/api/ai/chat-tools` — tool-calling chat: LLM plans a whitelisted
  Supabase query → `safe_select()` executes → LLM answers using the
  real rows. Whitelist lives in `supa_client.py::READ_WHITELIST`.
- [x] Frontend `/ai` page: session list, anomaly scan builder.

### 4.4 Compliance & scheduling
- [x] `/api/compliance/thresholds` GET/PUT (10 default limits).
- [x] `/api/compliance/evaluate?summarize=true|false` — violations[] +
  optional AI narrative.
- [x] `/api/cron/compliance-evaluate` and `/api/cron/pm-forecast-sweep`
  — serverless HTTP endpoints, gated by `X-Cron-Secret` header when
  `CRON_SECRET` env var is set. Wired to Vercel Cron via `vercel.json`
  (`0 16 * * *` and `30 17 * * *` UTC).

### 4.5 Nav & polish
- [x] `/exports` route wired to `Exports.tsx` (previously a dead link in
  the sidebar / mobile sheet).
- [x] Mobile bottom nav + "More" side sheet untouched; still covers all
  pages.
- [x] Error boundary, toast on query/mutation errors globally.

## 5. Code layout
```
/app
├── vercel.json                     ← cron schedule
├── backend
│   ├── server.py                   ← FastAPI routes (api_router)
│   ├── ai_service.py               ← chat + anomalies + PM forecast
│   ├── ai_tools.py                 ← planner + safe_select + answer chain
│   ├── compliance_service.py       ← thresholds, violations, PM
│   ├── cron_service.py             ← serverless cron helpers
│   ├── downtime_parser.py          ← Downtime-sheet remark splitter
│   ├── import_parser.py            ← XLSX meter parser
│   ├── seed_service.py             ← URL → Supabase+Mongo seeder
│   ├── supa_client.py              ← supabase-py wrapper, JWT aware
│   └── tests/test_pwri_backend.py  ← pytest regression suite
└── frontend
    ├── src/components/DowntimeEventsModal.tsx  ← new
    ├── src/pages/Import.tsx                    ← + Seed button
    ├── src/pages/Dashboard.tsx                 ← Downtime tile clickable
    └── src/App.tsx                             ← /exports route wired
```

## 6. Prioritized backlog
### P0 (this cycle — ✅ done)
- [x] Wire `/api/ai/chat-tools` for data-grounded AI queries.
- [x] Add bulk seed endpoint + Import page button for the 4 samples.
- [x] Downtime parser + dashboard modal.
- [x] Remove APScheduler, add serverless cron endpoints + vercel.json.
- [x] Fix missing `/exports` route.
- [x] Add httpx to requirements.

### P1 (next)
- [ ] Add per-plant compliance badge to the sidebar (count of open
      violations from `compliance_snapshots`).
- [ ] Strip remaining "Auto" prefixes from Operations/Costs tabs.
- [ ] Uniform input vs. computed colour coding via `ComputedInput`.
- [ ] PM Scheduling DB migration (waiting for user's SQL) → frequency
      enum + checklist popups.
- [ ] Show the parsed `Downtime` remarks from Mambaling Q2 in a
      per-plant timeline widget on `/plants/:id`.

### P2 (backlog)
- [ ] Email / push alerts for high-severity compliance snapshots
      (Resend or SendGrid — requires user API key).
- [ ] Per-RO train detailed parser for "MAMBALING RO DATA" sheet
      (feed/permeate/recovery per train).
- [ ] Chemical consumption XLSX parser + inventory reconciliation.

## 7. Testing
- Backend: `pytest backend/tests/test_pwri_backend.py -v` (13 tests, all
  green as of 2026-04-24).
- Testing protocol/history → `/app/test_result.md`.
- `/app/test_reports/iteration_1.json` — latest run.

## 8. Deployment (Vercel)
- `vercel.json` schedules the two cron endpoints.
- The FastAPI backend expects to run via `uvicorn server:app` with the
  `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `EMERGENT_LLM_KEY`,
  `MONGO_URL`, `DB_NAME`, and optional `CRON_SECRET` env vars.
- No APScheduler / background daemons. All jobs are HTTP-triggered.
