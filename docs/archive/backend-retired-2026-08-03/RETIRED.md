# Retired 2026-08-03 — FastAPI backend fully decommissioned

This directory (`backend/`, plus the repo-root `main.py` entry point) is kept
for reference only. It is no longer deployed, no longer imported by
anything, and nothing in `frontend/` calls it.

## Why

The app was migrated to be Supabase-only so it could run entirely on Vercel
(frontend) + Supabase (data, auth, Edge Functions), with no separate server
to host on Fly.io/Render/Railway/etc. The last 11 frontend call sites still
using `VITE_BACKEND_URL` were ported to direct Supabase calls:

| Old route                                   | New home |
|----------------------------------------------|----------|
| `GET /blending/wells`                         | `frontend/src/pages/operations/shared.tsx` (`useBlendingWells`) |
| `GET /blending/volume`                        | `frontend/src/components/BlendingVolumeCard.tsx`, `frontend/src/pages/operations/blending/BlendingSection.tsx` |
| `GET /downtime/events`                        | `frontend/src/components/DowntimeEventsModal.tsx` |
| `GET /alerts/feed`                            | `frontend/src/pages/Dashboard.tsx` |
| `POST /operator/switch-log`                   | `frontend/src/components/OperatorSwitcher.tsx` (already done before this pass) |
| `POST /admin/plants/cleanup`                  | `frontend/src/lib/adminCleanup.ts` |
| `GET /admin/audit-log`                        | `frontend/src/pages/admin/AuditLogPanel.tsx` |
| `GET /admin/migrations/status` + mark/unmark/import-history | `frontend/src/lib/migrationsStatus.ts` (state persisted in `migration_state` table — see `supabase/migrations/20260802_migration_state.sql` — replacing the old local JSON override/history files) |

All of the above ran on a **user-scoped** Supabase client already (the
caller's own JWT, not the service-role key), so none of it actually needed a
server — RLS was always the real authorization boundary. That's what made
this migration possible without standing up any Edge Functions.

## What else lived here (and was already unused before this pass)

A grep across `frontend/src` and `.github/workflows` at retirement time
turned up **zero callers** for every other route this backend exposed:
`/import/parse-wellmeter`, `/ai/*` (chat, sessions, anomalies, pm-forecast,
chat-tools, health), `/compliance/thresholds` + `/compliance/evaluate`,
`/import/seed-from-url`, `/blending/toggle`, `/blending/audit`,
`/admin/users/*` (create/soft-delete/hard-delete/dependencies) and
`/admin/plants/{id}/*` (soft-delete/hard-delete/dependencies — distinct
from `/admin/plants/cleanup`, which *was* live and is ported above),
`/import/ai-analyze` + `/import/ai-sync` + `/import/ai-analyses`,
`/cron/compliance-evaluate`, `/cron/pm-forecast-sweep`.

Some of these were already superseded by direct Supabase calls elsewhere
(e.g. user/plant soft-delete and hard-delete are implemented directly in
`frontend/src/components/DeleteEntityMenu.tsx`). The AI routes
(`/ai/chat`, `/ai/sessions`, `/ai/anomalies`, `/ai/pm-forecast`) backed the
`AIAssistant` page and `PmForecastTab` component, both deleted in this same
pass — they ran on `EMERGENT_LLM_KEY` via the Python-only
`emergentintegrations` library, tied to the Emergent app-builder platform,
and weren't going to work standalone regardless. AI features were dropped
rather than rebuilt on a different LLM provider (a call the project made
explicitly, rather than an oversight).

If any of these turn out to still be needed, this code is the reference
implementation — it just needs a new home to run (this repo no longer has
a `backend` job in CI or a place that deploys it).
