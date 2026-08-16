# PWRI Plant Monitoring

A monitoring and compliance system for water treatment / injection plant
operations - wells, RO trains, chemical dosing, downtime, and regulatory
compliance reporting.

## Stack

- **Frontend**: React + TypeScript + Vite, shadcn/ui + Tailwind CSS
- **Backend**: none — Supabase (Postgres, Auth, RLS, Edge Functions) is the
  entire backend. There used to be a FastAPI service; it was fully retired
  on 2026-08-03 once its last few routes were ported to direct, RLS-gated
  Supabase calls (see `docs/archive/backend-retired-2026-08-03/RETIRED.md`
  for the route-by-route mapping).
- **Database**: Supabase Postgres, schema managed via SQL migrations in
  `supabase/migrations/`

## Project layout

```
frontend/                        React/Vite SPA (the entire app)
supabase/migrations/              SQL migrations, applied in filename order
supabase/runbooks/                 Manual DBA SQL (diagnostics, one-off fixes) — never auto-applied, see its README
supabase/functions/                Supabase Edge Functions (e.g. data-analysis)
memory/PRD.md                      Product requirements / design notes
docs/archive/                      Retired code/docs kept for historical reference
  backend-retired-2026-08-03/       The old FastAPI app, kept for reference only
DEPLOYMENT.md                       Deployment notes and known gotchas
```

## Local development

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Required environment variables (Vite build-time):

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase anon/public key |
| `VITE_SUPABASE_PROJECT_ID` | Supabase project ref (used for a couple of dashboard deep-links) |

### Database

Apply the SQL files in `supabase/migrations/` in filename (timestamp) order
against your Supabase project - via the Supabase CLI, the SQL editor, or your
own migration runner. See `DEPLOYMENT.md` for known gotchas around this
(a few past migrations assumed RPC functions or constraints that hadn't been
created yet). Once signed in as Admin, the **Admin → Migrations** panel in
the app will also tell you exactly which migrations are pending against your
specific database.

## Testing & CI

```bash
cd frontend && npm test        # vitest
cd frontend && npm run lint    # eslint
cd frontend && npx tsc --noEmit
```

`.github/workflows/ci.yml` runs lint, type-check, tests, and a production
build on every PR.

## Further reading

- `DEPLOYMENT.md` - deployment steps and known issues
- `memory/PRD.md` - product requirements and feature notes
- `docs/archive/backend-retired-2026-08-03/RETIRED.md` - what the old backend
  did and where each route ended up
