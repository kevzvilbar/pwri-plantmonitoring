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

## Data Analysis & Review — Feature Overview

### Access
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
