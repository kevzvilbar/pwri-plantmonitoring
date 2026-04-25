# PWRI Monitoring

Multi-plant water operations monitoring app.

## Project Structure

- `frontend/` — Vite + React + TypeScript SPA (shadcn/ui, Tailwind, Supabase client)
- `backend/` — FastAPI + MongoDB service (not run in Replit; original deployment is Netlify static + separate backend)
- `supabase/` — Supabase project config

## Replit Setup

- **Frontend workflow** runs `npm run dev` from `frontend/` on host `0.0.0.0`, port `5000`.
- Vite config already has `allowedHosts: true` for the Replit iframe proxy.
- Frontend env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) are loaded from `frontend/.env` (copied from root `.env`).
- Backend (FastAPI/MongoDB) is not configured to run in this Replit environment — the frontend talks to Supabase directly. Calls to `REACT_APP_BACKEND_URL` will be no-ops unless that variable is set.

## Deployment

Configured as a static deployment:
- Build: `cd frontend && npm install && npm run build`
- Public dir: `frontend/dist`
