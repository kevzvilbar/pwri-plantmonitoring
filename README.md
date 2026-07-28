# PWRI Plant Monitoring

A monitoring and compliance system for water treatment / injection plant
operations - wells, RO trains, chemical dosing, downtime, and regulatory
compliance reporting.

## Stack

- **Frontend**: React + TypeScript + Vite, shadcn/ui + Tailwind CSS
- **Backend**: FastAPI (Python), Supabase (Postgres) as the data layer
- **Database**: Supabase Postgres, schema managed via SQL migrations in
  `supabase/migrations/`

## Project layout

```
backend/              FastAPI app (backend/server.py is the entry point)
frontend/              React/Vite SPA
supabase/migrations/   SQL migrations, applied in filename order
memory/PRD.md           Product requirements / design notes
docs/archive/           Retired code/docs kept for historical reference
main.py                 Convenience entry point: `python main.py` runs the API
DEPLOYMENT.md            Deployment notes and known gotchas
```

## Local development

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

Required environment variables (see `backend/server.py` / `backend/supa_client.py`):

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (server-side only) |
| `EMERGENT_LLM_KEY` | Key for the AI assistant / smart-import features |
| `CRON_SECRET` | Shared secret for scheduled/cron-triggered endpoints |

Run the API from the repo root with `python main.py`, or directly with:

```bash
uvicorn backend.server:app --reload --port 8000
```

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

### Database

Apply the SQL files in `supabase/migrations/` in filename (timestamp) order
against your Supabase project - via the Supabase CLI, the SQL editor, or your
own migration runner. See `DEPLOYMENT.md` for known gotchas around this
(a few past migrations assumed RPC functions or constraints that hadn't been
created yet).

## Testing & CI

```bash
# Backend
cd backend && pytest

# Frontend
cd frontend && npm test        # vitest
cd frontend && npm run lint    # eslint
cd frontend && npx tsc --noEmit
```

`.github/workflows/ci.yml` runs lint, type-check, tests, and a production
build for both stacks on every PR.

## Further reading

- `DEPLOYMENT.md` - deployment steps and known issues
- `memory/PRD.md` - product requirements and feature notes
