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
