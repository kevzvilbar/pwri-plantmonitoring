# PWRI Plant Monitoring — Deployment Guide

Architecture (since 2026-08-03): a **Vercel-hosted React SPA + Supabase** —
Postgres (schema in `supabase/migrations/`), Auth, Row-Level Security,
Realtime, and three Edge Functions. There is **no application server**. The
retired FastAPI backend is reference-only
(`docs/archive/backend-retired-2026-08-03/`); the previous version of this
guide, including the MongoDB/Railway migration history, is preserved verbatim
at `docs/archive/DEPLOYMENT-retired-2026-09-19.md`.

---

## 1. Database — apply migrations

Migrations live in `supabase/migrations/` (one consolidated baseline
`20260911044610_baseline_schema.sql`, verified 1:1 against production during
the 2026-09 squash — see `docs/MIGRATION-SQUASH.md`) and are applied in
filename order:

- **Preferred:** `supabase link --project-ref <ref>` then `supabase db push`
  (applies in order and records history in `supabase_migrations`).
- **Dashboard:** Supabase → SQL Editor, running each file in filename order;
  afterwards use `supabase migration repair` if the history table and files
  drift out of alignment.
- **Check:** the in-app **Admin → Migrations** panel lists exactly which
  migrations are pending against your database.
- **Drift guard:** `.github/workflows/migration-drift-check.yml` runs
  `supabase db diff --linked` daily and fails the moment production contains
  anything `supabase/migrations/` doesn't. It needs repo secrets
  `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`. **No out-of-band schema
  changes** — 41 of those caused the squash (see `docs/MIGRATION-SQUASH.md`).

Enable the **pg_net** extension (Database → Extensions) — the notification
triggers below depend on it.

## 2. Edge Functions

Three functions, all under `supabase/functions/`:

```
supabase functions deploy compute-production-costs
supabase functions deploy notify-train-offline
supabase functions deploy send-push-notification
```

Deploy with the CLI (it bundles `_shared/webpush.ts`); pasting into the
dashboard editor will not work for functions with shared imports.


## 3. Frontend configuration

All variables are Vite **build-time** (`VITE_*`); changing a value requires a
rebuild/redeploy. `frontend/.env.example` is the canonical list:

| Variable | Required | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | ✅ | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | ✅ | Supabase anon key (safe in browser) |
| `VITE_SUPABASE_PROJECT_ID` | – | project ref, dashboard deep-links + `types:gen` |
| `VITE_VAPID_PUBLIC_KEY` | for push | Web Push public key (see 5b) |
| `VITE_SENTRY_DSN` / `VITE_SENTRY_ENV` | – | error monitoring |
| `VITE_LOG_LEVEL` | – | client log verbosity |
| `VITE_AUDIT_LOG_ENDPOINT` | – | optional remote audit-log sink |

Build: `cd frontend && npm ci && npm run build`.

## 4. Deploy the SPA

- **Vercel (primary):** import the repo, root directory `frontend`, framework
  Vite; `frontend/vercel.json` already contains the SPA rewrite. Set env vars
  per environment scope (staging vs production use the *same names*, different
  values — see `docs/STAGING.md`, `docs/STAGING_SETUP.md`).
- **GitHub Pages (secondary):** `.github/workflows/jekyll-gh-pages.yml` builds
  and publishes on push to `main` (env values come from repo secrets — see
  that workflow). The PWA manifest and Vite `base` are deliberately relative
  so one codebase serves both `/` (Vercel) and `/pwri-plantmonitoring/`
  (Pages).

## 5. Optional integrations

### 5a. Train-offline email alerts (Resend)

Fires from a DB trigger on `train_status_log` INSERTs with status `'Offline'`
(migration `20260916000004_train_offline_email_notify.sql` + edge function
`notify-train-offline`). Deliberately inert until configured:
1. Apply the migration (§1).
2. Database-level settings (SQL Editor, once per project):
   ```
   ALTER DATABASE postgres SET app.supabase_url = 'https://<project-ref>.supabase.co';
   ALTER DATABASE postgres SET app.supabase_service_role_key = '<service_role key>';
   ```
3. Function secrets: `RESEND_API_KEY` (`re_…`) and `NOTIFY_FROM_EMAIL`
   (a verified domain is needed for real deliveries; free tier is fine —
   volume is low).
4. Smoke test (deploy §2 first):
   ```
   curl -X POST 'https://<project-ref>.supabase.co/functions/v1/notify-train-offline' \
     -H 'Authorization: Bearer <service_role_key>' -H 'Content-Type: application/json' \
     -d '{"train_id":"<uuid>","plant_id":"<uuid>","reason":"test","confirmed_at":"<iso>","confirmed_by":"<uuid>","row_id":"<uuid>"}'
   ```
   Unset `RESEND_API_KEY` → `{ skipped: true }`, nothing sends. To disable,
   remove the secrets (the trigger stays but the function no-ops). Full
   teardown + history: see the retired guide.

### 5b. Web Push notifications (VAPID)

Same trigger source as email, independent pipeline
(`20260918000001_push_subscriptions.sql` +
`20260918000002_train_offline_push_notify.sql` +
`send-push-notification`):

1. Generate keys: `node scripts/generate-vapid-keys.mjs`.
2. Function secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
   (a `mailto:` or `https:` URI you control).
3. Set `VITE_VAPID_PUBLIC_KEY` (the same public key) in the frontend env and
   rebuild — the private key never leaves the server.
4. In-app status lives at **Profile → Push Notifications**
   (Active / Not Configured / Blocked). "Send Test Alert" is a local preview
   only and does not prove server delivery.
5. Smoke test mirrors 5a against `/functions/v1/send-push-notification` with
   `{"plant_id":"<uuid>","title":"…","message":"…","severity":"critical"}`. A
   non-zero `failed` with HTTP **401/403** diagnostics means the frontend
   public key doesn't match `VAPID_PRIVATE_KEY`.

### 5c. Sentry

`VITE_SENTRY_DSN` at runtime; production builds additionally upload
sourcemaps via `@sentry/vite-plugin` when `SENTRY_ORG` / `SENTRY_PROJECT` /
`SENTRY_AUTH_TOKEN` are present in the build environment.

## 6. Local development & tests

```bash
cd frontend && npm install && npm run dev     # SPA against your Supabase env
npx supabase start                            # local stack (Docker), applies migrations
psql "$DB_URL" -f supabase/e2e-seed.sql       # seed users/data for Playwright
npx supabase test db                          # pgTAP suite (supabase/tests/database/)
```

`supabase test db` discovers tests recursively under `supabase/tests/`, and
every test file is self-contained with its own fixture + `ROLLBACK`. Verified
green locally on 2026-09-19 (9 files against a local `supabase start` stack).
CI (`.github/workflows/ci.yml`) gates every PR on: baseline-migration
existence, types-sync, `tsc --noEmit -p tsconfig.app.json`, vitest, lint
ceiling, font-size/contrast checks, production build, bundle-size baseline,
Playwright smoke **and** authenticated E2E (against disposable local
Supabase), the pgTAP RLS suite, `npm audit --audit-level=high`, and CodeQL.

## 7. Known gotchas

- `VITE_*` values are baked at build time — a scope change without a redeploy
  silently keeps the old value.
- pg_net must be enabled per project or the notification triggers no-op.
- `app.supabase_service_role_key` is a database-level setting holding the
  **service role** key — never put it in frontend code or repo files.
- Applying migrations out of order historically broke (some files assumed
  functions/constraints created in later files). Prefer `supabase db push`
  over hand-pasting, and read `docs/MIGRATION-SQUASH.md` before touching the
  baseline.
- Two deploy targets share one build config; keep manifest paths relative and
  test both hosts after any service-worker/scope change.
