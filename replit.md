# PWRI Monitoring

Multi-plant water operations monitoring app.

## Project Structure

- `frontend/` — Vite + React + TypeScript SPA (shadcn/ui, Tailwind, Supabase client). Talks to Supabase directly for most reads, and to the FastAPI backend (`/api/*`) for compliance, AI, admin (soft/hard delete + audit log), import, and cron features.
- `backend/` — FastAPI service. Uses Supabase for relational data, MongoDB for compliance thresholds / AI sessions / downtime events.
- `supabase/` — Supabase project config + migrations (deletion audit log, admin approval, plant cleanup, etc.).

## Replit Setup

### Frontend workflow
- `cd frontend && npm run dev -- --host 0.0.0.0 --port 5000`
- Vite serves on `0.0.0.0:5000`, `allowedHosts: true` for the Replit iframe proxy.
- Vite **proxies `/api/*` to `http://127.0.0.1:8000`** so the frontend reaches the FastAPI backend without needing `REACT_APP_BACKEND_URL`.
- Env: `frontend/.env` (copied from root `.env`) has `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY`.

### Backend workflow
- `cd backend && python -m uvicorn server:app --host 127.0.0.1 --port 8000 --reload`
- Bound to `127.0.0.1:8000` (not exposed; reached only via the Vite proxy).
- Env: `backend/.env` has `DB_NAME`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `CORS_ORIGINS`.
- **MongoDB fallback:** if `MONGO_URL` is unset, the server falls back to an in-memory `mongomock_motor` client (compliance thresholds and AI session history work but reset on restart). Set `MONGO_URL` for persistence.
- The optional `emergentintegrations` package is imported lazily — AI chat endpoints will return errors if the package and `EMERGENT_LLM_KEY` are not present, but the rest of the API runs fine.

## Deployment

Configured as a static deployment of the frontend only:
- Build: `cd frontend && npm install && npm run build`
- Public dir: `frontend/dist`

For production, the frontend expects to talk to a hosted FastAPI backend (set `REACT_APP_BACKEND_URL` at build time, or proxy `/api` at the host level).

## Dashboard layout

`frontend/src/pages/Dashboard.tsx` is organized into three KPI clusters with section headers:

1. **Production & Consumption** — Production (lg), NRW Water Loss (lg, calc, tone-tinted by `nrwColor`), Locator Consumption, Raw Water (Wells), Bypass → Product. Trend % vs previous day shown on Production and Consumption.
2. **Quality** — Feed TDS, Product TDS, Raw Turbidity, Recovery. Collapsible on mobile (`Radix Collapsible` + `forceMount` + `sm:!block`); always visible on `sm+`.
3. **Energy & Cost** — Power kWh (lg, trend), PV Ratio (calc), Production Cost (calc), Power Cost, Chem Cost.

`StatCard` supports `size: 'default'|'lg'`, `trend: number|null` (% vs yesterday rendered via `TrendBadge`), `tone: 'accent'|'warn'|'danger'` (drives gradient bg + icon color), `calc + calcTooltip` (sky tint + tooltip explaining the formula), `accent` (icon color override), `threshold` (limit hint).

A red **NRW alert banner** appears above the clusters whenever `nrw > 20`, clickable to open the NRW trend modal. Yesterday baselines for trend deltas come from three additional Supabase queries (`yLocators`, `yWells`, `yPower`) bounded by `gte(yesterday) + lt(today)`. KPI pinning/customization was intentionally not implemented (would require user-scoped storage).

## Admin → Plants tab

`PlantsPanel` in `frontend/src/pages/Admin.tsx` renders:
- `BadImportCleanupCard` (admin-only) — multi-select cleanup of plants imported by mistake. Has 5 `REASON_TEMPLATES` chips (Smart import error, Duplicate entry, Test data, Wrong region, User request) above a compact reason field that toggles between `rows={1}` and `rows={4}` via Expand/Compact button. A live "audit log preview" block shows one row per selected plant in the form `<plant> → reason: [CLEANUP] <reason>`, mirroring the backend contract (`/api/admin/plants/cleanup` writes one audit row per plant with `reason="[CLEANUP] <reason>"` against `entity_label=<plant>`). The same preview renders inside the `AlertDialog` confirm screen.
- A **sticky search** bar (`sticky top-0 z-20` with `backdrop-blur`) with a "filtered/total" counter when a query is active.
- Plant cards with **status color coding**: emerald `border-l-4` + subtle gradient for `Active`, muted gray + `bg-muted/20` for `Inactive`. Per-row delete still goes through `DeleteEntityMenu` (soft+hard with audit). Bulk-delete on the entire plants list was intentionally NOT added — destructive multi-select on every plant would be a foot-gun; the cleanup card already covers the smart-import-mistake case.

## Smart Import — AI Universal pipeline

`frontend/src/pages/Import.tsx` now has a top-level mode toggle:

- **AI Universal (default)** — `frontend/src/components/AIImportPanel.tsx` calls `POST /api/import/ai-analyze` with the file, then `POST /api/import/ai-sync/{analysis_id}` with per-table decisions. UI shows confidence bars (high/medium/low), editable target dropdown, editable entity name, sync/reject toggle, and a column-mapping editor (`our_field → source_header`). A `[IMPORT] / [IMPORT-REJECT]` audit-log preview mirrors the rows the backend will write. Reason field has 5 templates (Routine import / Onboarding / Backfill / Correction / Test upload).
- **Wellmeter Parser (legacy)** — preserves the original `/api/import/parse-wellmeter` flow verbatim. If the AI detects a wellmeter file (`wellmeter_detected: true`) it shows a one-click "Open in Wellmeter Parser" hand-off button.

`backend/ai_import_service.py` (~600 lines) does:
1. **extract_tables** — handles `.xlsx`/`.xlsm` (openpyxl, scans for blank-line table breaks per sheet), `.docx` (python-docx tables), `.csv`/`.tsv`/`.txt` (csv.Sniffer auto-delimiter). `.doc` (binary Word) is rejected.
2. **classify_tables** — calls OpenAI `gpt-4o-mini` (`OPENAI_API_KEY` required) with a strict JSON schema: `{ target, entity_name, confidence, column_mapping, anomalies, rationale }`. On failure / no-key, falls back to `_rule_based_classify` heuristics.
3. **looks_like_wellmeter** — header-text match for the canonical `Date Initial Final Volume Status` columns.
4. **sync_analysis** — for each `action=='sync'` decision: `_ensure_entity` (get-or-create by name under `plant_id` for `wells`/`locators`/`ro_trains`) then `_insert_readings` against `well_readings`/`locator_readings`/`ro_train_readings`/`power_readings`. Each decision writes one `[IMPORT] <source> → <target>` (or `[IMPORT-REJECT]`) row to `deletion_audit_log` (re-uses the table with `kind='plant'`, `entity_id=analysis_id`).

**Persistence:** `supabase/migrations/20260425_import_analysis.sql` creates the `import_analysis` table (RLS, status `pending|synced|rejected|partial`, jsonb `tables / decisions / sync_summary`). Sample rows are capped at `MAX_SAMPLE_ROWS=25` per table to bound payload. **The user must run this migration before the AI flow works end-to-end.**

**Limits:** `MAX_FILE_BYTES = 25 MiB`. Auth helpers (`_bearer_token`, `_caller_identity`, `_user_scoped_client`, `_require_roles`, `_write_audit`) reused from `admin_service.py`.
