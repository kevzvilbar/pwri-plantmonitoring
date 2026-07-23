# PWRI Plant Monitoring — v2 Deployment Guide

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
```

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

## Step 2 — Update Environment Variables

Remove MongoDB/Railway variables and ensure these are set:

### Backend (`.env` or hosting provider)
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...   ← required for admin ops + regression
CORS_ORIGINS=https://your-frontend.netlify.app,http://localhost:5173
EMERGENT_LLM_KEY=...               ← optional, enables AI chat
CRON_SECRET=...                    ← optional, secures /api/cron/* endpoints
```

**Remove these** (no longer needed):
```
MONGO_URL        ← DELETE
DB_NAME          ← DELETE
```

### Frontend (Netlify / Vite)
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJ...
VITE_BACKEND_URL=https://your-backend.fly.dev
```

---

## Step 3 — Install Dependencies

MongoDB packages (`motor`, `pymongo`, `mongomock-motor`) are removed.
`scipy` is added for regression.

```bash
cd backend
pip install -r requirements.txt
# or with uv:
uv sync
```

---

## Step 4 — Deploy Backend

The backend is now a plain FastAPI app with no external database dependency
beyond Supabase. You can deploy to any platform:

**Fly.io**
```bash
fly launch --name pwri-backend
fly secrets set SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
fly deploy
```

**Render / Railway (still works, just no special config needed)**
```
Start command: cd backend && uvicorn server:app --host 0.0.0.0 --port $PORT
```

---

## Step 5 — Assign Data Analyst Role

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
