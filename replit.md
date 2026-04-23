# Project

Vite + React + TypeScript + shadcn/ui frontend imported from Lovable.

## Backend
Uses Supabase (project `lreqxclzoxmswglvdstv`) for database, auth, RLS policies, and edge functions. SQL migrations live under `supabase/migrations/`. Frontend client is in `src/integrations/supabase`.

## Replit setup
- Vite dev server runs on `0.0.0.0:5000` with `allowedHosts: true` and HMR `clientPort: 443` so the Replit iframe proxy works.
- Workflow: `Start application` → `npm run dev` (port 5000, webview).
- Deployment: autoscale, build `npm run build`, run via `vite preview` static output.

## Env vars
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_PROJECT_ID` in Replit Secrets. App now runs on **Next.js 14 (App Router)** — see `app/` directory and `next.config.cjs`.
