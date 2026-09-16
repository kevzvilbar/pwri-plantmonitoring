# PWRI Plant Monitoring — Deployment Guide

> **Update (2026-08-03):** the FastAPI backend described in "Step 4 — Deploy
> Backend" below no longer exists — it was fully retired (see
> `docs/archive/backend-retired-2026-08-03/RETIRED.md`). This app now runs as
> **Vercel (frontend) + Supabase (data/auth/Edge Functions) only**, with no
> server to deploy anywhere. Skip Steps 2–4's backend portions; see
> "Deploy Frontend" near the bottom instead.

## What Changed in This Update

### ✅ 100% Supabase — MongoDB Completely Removed
All MongoDB/Railway dependencies have been eliminated. Every collection that
previously lived in MongoDB now lives in Supabase:

| Was (MongoDB)          | Now (Supabase table)         |
|------------------------|------------------------------|
| `status_checks`        | `status_checks`              |
| `downtime_events`      | `downtime_events`            |
| `blending_wells`       | `blending_wells`             |
| `blending_events`      | `blending_events`            |
| `compliance_thresholds`| `compliance_thresholds`      |
| `compliance_snapshots` | `compliance_snapshots`       |
| `operator_switch_log`  | `operator_switch_log`        |
| `ai_conversations`     | `ai_chat_sessions`           |
| *(new)*                | `regression_results`         |
| *(new)*                | `raw_edit_log`               |

### ✅ Railway Removed
- Deleted `backend/railway.json`
- Deleted `backend/railway.toml`
- Deleted `backend/nixpacks.toml`
- No Railway environment variables required.

### ✅ 2026-08-03: the backend itself is gone
Not just Railway — the whole FastAPI app. The last routes still in live use
(blending/downtime/alerts reads, the admin plants-cleanup tool, the audit
log, and the migrations-status tool) were ported to direct, RLS-gated
Supabase calls. See `docs/archive/backend-retired-2026-08-03/RETIRED.md`
for the full route-by-route mapping.

### ✅ New: Data Analysis & Review Page
A centralised editing and normalization hub for Admin and Data Analyst roles.

---

## Step 1 — Run the New Migrations

Open **Supabase Dashboard → SQL Editor** and run these files in order:

```
frontend/supabase/migrations/20260514_normalization.sql          (if not yet applied)
frontend/supabase/migrations/20260515_supabase_only_and_data_analysis.sql   ← NEW
frontend/supabase/migrations/20260718_pending_review_and_cascade_correction.sql   ← NEW
frontend/supabase/migrations/20260719_offline_reason_tracking.sql   ← NEW
supabase/migrations/20260802_migration_state.sql   ← NEW (replaces the backend's local override/history JSON files)
```

Once you're signed in as Admin, the **Admin → Migrations** panel in the app
itself will tell you exactly which of these (and every other file in
`supabase/migrations/`) are still pending against your specific database —
you don't have to track this by hand.

The third migration fixes two bugs: it adds the missing `pending_review`
value to the `norm_status` check constraint (readingGuards.ts saves backward/
spike readings with this status, but the constraint never allowed it), and it
creates `fn_cascade_reading_correction`, the RPC function the Data Corrections
page calls to apply and cascade a reading correction (this function did not
exist anywhere in the database, so those actions always failed).

The fourth migration adds "why is there no data" reason tracking for Wells,
Locators, and RO Trains, shown in the Data Summary popup instead of a plain
"—". It creates `entity_status_audit_log` (never existed as a real table
before — only ever written through a defensive try/catch) with new
`reason_category`/`reason_detail` columns for offline/inactive status
changes, and a new `reading_gap_reasons` table for logging why a specific
day has no reading even though the entity is still Active/Running.

The second migration creates all the tables that replace MongoDB collections,
plus `regression_results` and `raw_edit_log` for the new Data Analysis page.

---

## Step 2 — Environment Variables

There's no backend `.env` anymore — only the frontend build needs vars:

### Frontend (Vercel / GitHub Pages / Vite)
Both deployment stores must use these exact values:
```
VITE_SUPABASE_URL=https://sosfbfxovtleuvahxvpm.supabase.co
VITE_SUPABASE_PROJECT_ID=sosfbfxovtleuvahxvpm
VITE_SUPABASE_PUBLISHABLE_KEY=eyJ...   # same publishable key for this project
```

Vercel Project Settings → Environment Variables and GitHub repository Settings → Secrets and variables → Actions are separate stores; update both together. GitHub Pages now fails its build when the URL or project ID differs from the canonical project, and the frontend shows a configuration error instead of silently querying another database.

**Remove these** (no longer needed — MongoDB was removed earlier, and the
backend itself is gone as of 2026-08-03):
```
MONGO_URL            ← DELETE
DB_NAME              ← DELETE
VITE_BACKEND_URL     ← DELETE
```

---

## Step 3 — Deploy Frontend

**Vercel**
1. Project Settings → General → **Root Directory** → `frontend` (lets Vercel
   auto-detect Vite and find `dist` without the old `cd frontend` build-script
   workaround)
2. Project Settings → Environment Variables → add the three `VITE_*` vars above
3. `frontend/vite.config.ts`'s `base` and `frontend/src/App.tsx`'s router
   `basename` are both environment-aware (checked via Vercel's built-in
   `VERCEL` env var), so the same build works unmodified on GitHub Pages too
4. `frontend/vercel.json` provides the SPA rewrite React Router needs

**GitHub Pages** — unchanged, still driven by
`.github/workflows/jekyll-gh-pages.yml` (the `VITE_BACKEND_URL` secret was
removed from it in this same pass; nothing depends on it anymore).

---

## Step 4 — Assign Data Analyst Role

Go to **Admin Console → Users**, find the relevant user, and assign the
`Data Analyst` role. They will then see the **Data Analysis & Review** page
in the sidebar.

---

## Step 5 — Train Offline Email Notifications (new)

When an RO Train is marked **Offline** in the Operator Log, managers and admins
assigned to that train's plant receive an email. This is the same audience the
existing user-presence/activity notification precedent targets.

The notification fires from the database, not from whoever happens to have the
app open — that matters because the auto-offline flagger runs in browser tabs.
The consolidated writer (`lib/trainStatusLogWriter.ts`) guarantees every genuine
transition lands as exactly one `train_status_log` INSERT, so one INSERT = one
notification. There is no alert/dedupe table — zero added storage.

### What changed

Two new files:

- **SQL migration** — `supabase/migrations/20260916000004_train_offline_email_notify.sql`
  - Adds `get_offline_alert_recipients(plant_id)` (SQL SECURITY DEFINER; reads
    `auth.users.email` + `user_profiles.plant_assignments`, filters to Active
    Manager/Analyst/Admin profiles).
  - Adds trigger `trg_train_status_log_notify_offline` — fires after every
    `train_status_log` INSERT whose `status` is `'Offline'`, calling the edge
    function using the app-scoped DB settings
    `app.supabase_url` / `app.supabase_service_role_key`.
- **Edge function** — `supabase/functions/notify-train-offline/index.ts`
  - Auth: only the service-role key can call it.
  - Recipients: resolved by `get_offline_alert_recipients` for the train's
    plant.
  - Delivery: Resend via `fetch` to `https://api.resend.com/emails`, one email
    per recipient with the *same* subject/body.
  - No-op guarantees: `RESEND_API_KEY` unset → 200 `{ skipped: true }`;
    recipients empty → 200 `{ sent: 0, skipped: true, reason: 'no recipients' }`;
    any network failure → logged as `failed`, never blocks the status-log write.

No frontend code changed for this feature — the app already writes
`train_status_log` rows. The confirm-dialog ("Report Running", "Fix timings",
meter edits, gap reasons) already audit-logs every operator action; this just
reacts to the resulting Offline rows.

### Required setup (per Supabase project)

This feature is **deliberately off until you configure it** — an unconfigured
project just silently skips every notification, so there is no half-alert state.

#### 1. Enable the migration

Run the migration in **Supabase Dashboard → SQL Editor** (Step 1 of DEPLOYMENT.md,
in order):

- `20260916000004_train_offline_email_notify.sql`

#### 2. Set the app-scoped database settings

These are read by the DB trigger (`fn_notify_train_offline`), not by the frontend.
Run each once per environment:

```
ALTER DATABASE postgres SET app.supabase_url = 'https://<project-ref>.supabase.co';
ALTER DATABASE postgres SET app.supabase_service_role_key = '<service_role_key>';
```

The `service_role_key` is the **service role key** from the Supabase Dashboard
API settings — not an anon key. It lets the trigger call the project's own edge
function as an admin. Keep it out of app code; the DB setting is the only place
that needs it.

#### 3. Set the edge-function secrets

In **Supabase Dashboard → Edge Functions → Settings → Secrets**, add:

- `RESEND_API_KEY` = your Resend API key (starts with `re_`)
- `NOTIFY_FROM_EMAIL` = the "From" address for the alert emails
  (defaults to `PWRI Monitoring <onboarding@resend.dev>` if unset, but a real
  domain is needed for production deliveries)

Resend has a free tier — see https://resend.com. The function sends one email per
recipient, so alert volume is low (one per genuine Offline transition, per plant,
per week or less).

#### 4. Install the `pg_net` extension (if not present)

The trigger depends on `pg_net`. It is created `IF NOT EXISTS` inside the
migration, but Supabase only exposes extensions that have been enabled on the
project. In **Supabase Dashboard → Database → Extensions**, enable **pg_net**.

### What the email says

**Subject:** `RO Train N — <train name> marked Offline — <plant name>`

Body includes:

- The train label (number + name if present)
- The plant name
- When it went offline (confirmed_at, formatted local time — or "just now" if
  the timestamp is absent)
- The reason if one was recorded
- A pointer back to the Operator Log so a manager can confirm the train back
  online if it was a false positive

### Testing

The function is callable directly via `curl` (or the Supabase dashboard's "Execute
function" UI) for a smoke test. Example:

```
curl -X POST \
  'https://<project-ref>.supabase.co/functions/v1/notify-train-offline' \
  -H 'Authorization: Bearer <service_role_key>' \
  -H 'Content-Type: application/json' \
  -d '{"train_id":"<uuid>","plant_id":"<uuid>","reason":"test alert","confirmed_at":"2026-09-16T10:30:00Z","confirmed_by":"<uuid>","row_id":"<uuid>"}'
```

A successful run returns `{"sent": <n>, "failed": 0, ...}`. A run without
`RESEND_API_KEY` set returns `{"skipped": true, "reason": "RESEND_API_KEY not
configured"}` and does **not** send email.

For a real end-to-end test: mark a test train Offline in the Operator Log
(wrongly, on a test plant), confirm it back online, and check that:

- the alert arrived (or was skipped, if Resend isn't configured yet)
- the train's record was not otherwise changed

**Do not** leave a real plant's train in Offline state during testing — the alert
goes to managers, and it is best to clean up after a smoke test by confirming the
train back Online so the timeline is accurate.

### Turning it off

Remove the edge-function secrets (`RESEND_API_KEY`, `NOTIFY_FROM_EMAIL`) to stop
emails while keeping the trigger (`trg_train_status_log_notify_offline`) present
— the function will return `skipped: true` for every call. To fully remove:

1. Drop the trigger: `DROP TRIGGER trg_train_status_log_notify_offline ON public.train_status_log;`
2. Drop the helper: `DROP FUNCTION IF EXISTS public.fn_notify_train_offline;`
3. Drop the recipient function: `DROP FUNCTION IF EXISTS public.get_offline_alert_recipients;`
4. Remove the migration and edge-function files from the repo (no secret needed
   once the trigger can't reach the function).

---


| Role          | Raw Data | Run Regression | Edit Values | Apply/Retract |
|---------------|----------|---------------|-------------|---------------|
| Admin         | ✅       | ✅            | ✅          | ✅            |
| Data Analyst  | ✅       | ✅            | ✅          | ✅            |
| Manager       | ✅       | ❌            | ❌          | ❌            |
| Others        | ❌       | ❌            | ❌          | ❌            |

### Workflow
1. Select source table + column + optional plant + date range
2. Click **Run Regression** → OLS fit, Z-score outlier detection
3. Review the right-side table: `corrected_value` + notes
4. Click **Apply** → writes corrected values + `reading_normalizations` rows
5. Or **Retract** to undo an applied run
6. Dashboard symbols: ⚠️ erroneous · 🔄 normalized · ⏪ retracted

### Rule Migration
All normalization logic previously scattered across tables is now centralized
here. Other tables (Operations, ROTrains, Plants, etc.) remain read-only;
all edits flow exclusively through this page.
