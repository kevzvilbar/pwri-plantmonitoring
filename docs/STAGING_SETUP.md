# Phase 5: Operational Maturity - Staging Environment Setup

## Overview
This document describes the staging environment setup for PWRI Plant Monitoring.
The staging environment must be used for ALL migrations and deployments before production.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        PRODUCTION                                │
│  Supabase Project: sosfbfxovtleuvahxvpm                         │
│  Vercel: pwri-plantmonitoring (main branch)                     │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ Promote after validation
                              │
┌─────────────────────────────────────────────────────────────────┐
│                        STAGING                                   │
│  Supabase Project: [NEW - to be created]                        │
│  Vercel: pwri-plantmonitoring-staging (staging branch)          │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ Auto-deploy on push
                              │
┌─────────────────────────────────────────────────────────────────┐
│                        DEVELOPMENT                               │
│  Local Supabase (supabase start)                                │
│  Vercel Preview Deployments (PR branches)                       │
└─────────────────────────────────────────────────────────────────┘
```

## Staging Supabase Project Setup

### 1. Create New Supabase Project
- Go to https://supabase.com/dashboard
- Click "New Project"
- Name: `pwri-plantmonitoring-staging`
- Region: Same as production (for latency parity)
- Database password: Generate strong password, store in 1Password
- Plan: Pro (for staging, can downgrade to free if cost-sensitive)

### 2. Configure Staging Project
After project creation, run these in Supabase SQL Editor:

```sql
-- Apply baseline migration first
-- Copy contents of supabase/migrations/20260908000000_baseline_schema.sql

-- Then apply subsequent migrations in order:
-- 20260909000001_phase4_missing_indexes.sql
-- 20260909000002_phase4_column_restricted_triggers.sql
-- 20260909000003_phase4_pg_cron_schedule.sql
-- 20260909000004_phase4_cascade_circuit_breaker.sql
-- 20260909000005_phase4_lag_window_views.sql

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Configure pg_net for Edge Function calls
SELECT net.http_post(
  url := 'https://<staging-project-ref>.supabase.co/functions/v1/compute-production-costs',
  headers := jsonb_build_object(
    'Authorization', 'Bearer <service-role-key>',
    'Content-Type', 'application/json'
  ),
  body := '{}'
);
```

### 3. Edge Functions Deployment
Deploy the compute-production-costs Edge Function to staging:

```bash
# In project root
supabase functions deploy compute-production-costs \
  --project-ref <staging-project-ref> \
  --legacy-bundle
```

### 4. Environment Variables
Set these in Vercel staging environment:

```
VITE_SUPABASE_URL=https://<staging-project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<staging-anon-key>
# All other VITE_* vars from .env.example
```

## Vercel Staging Deployment

### 1. Create Staging Branch
```bash
git checkout -b staging
git push origin staging
```

### 2. Configure Vercel Project
- Import repository in Vercel
- Create new project: `pwri-plantmonitoring-staging`
- Git branch: `staging`
- Environment variables: Add all from `.env.example` with staging values
- Build command: `npm run build`
- Output directory: `dist`

### 3. Preview Deployments
- All PRs automatically get preview deployments
- Preview deployments use local Supabase (via `supabase start` in CI)
- Staging branch deploys to staging Vercel project

## Migration Workflow (Staging-First)

### Required Process for ALL Migrations

```
1. Create migration locally
   supabase migration new <name>

2. Test locally
   supabase start
   supabase db reset

3. Apply to staging
   supabase db push --project-ref <staging-ref>

4. Validate in staging
   - Run E2E tests against staging
   - Manual smoke test critical flows
   - Check pgTAP tests pass

5. Promote to production
   supabase db push --project-ref <prod-ref>
   (Only after staging validation passes)

6. Deploy Edge Functions to production
   supabase functions deploy --project-ref <prod-ref>
```

### CI Enforcement
Add to `.github/workflows/ci.yml`:

```yaml
staging-validation:
  name: Staging Validation
  runs-on: ubuntu-latest
  if: github.ref == 'refs/heads/staging'
  steps:
    - uses: actions/checkout@v4
    - uses: supabase/setup-cli@v1
    - name: Push to staging
      run: supabase db push --project-ref ${{ secrets.STAGING_SUPABASE_PROJECT_REF }}
      env:
        SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
    - name: Run E2E against staging
      run: |
        # Run Playwright tests against staging URL
        npx playwright test --project=chromium
      env:
        PLAYWRIGHT_BASE_URL: https://pwri-plantmonitoring-staging.vercel.app
        VITE_SUPABASE_URL: ${{ secrets.STAGING_SUPABASE_URL }}
        VITE_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.STAGING_SUPABASE_ANON_KEY }}
```

## Secrets Management

### GitHub Secrets Required
| Secret | Description |
|--------|-------------|
| `SUPABASE_ACCESS_TOKEN` | Personal access token for Supabase CLI |
| `STAGING_SUPABASE_PROJECT_REF` | Staging project reference ID |
| `STAGING_SUPABASE_URL` | Staging Supabase URL |
| `STAGING_SUPABASE_ANON_KEY` | Staging anon key |
| `STAGING_SUPABASE_SERVICE_ROLE_KEY` | Staging service role key |
| `PROD_SUPABASE_PROJECT_REF` | Production project reference ID |
| `PROD_SUPABASE_SERVICE_ROLE_KEY` | Production service role key |

### Vercel Environment Variables
| Variable | Staging Value | Production Value |
|----------|---------------|------------------|
| `VITE_SUPABASE_URL` | `https://<staging>.supabase.co` | `https://<prod>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `<staging-anon>` | `<prod-anon>` |

## Validation Checklist for Staging

Before promoting any migration to production:

- [ ] Migration applies cleanly to staging
- [ ] All pgTAP RLS tests pass (`supabase test db`)
- [ ] E2E tests pass against staging
- [ ] No new TypeScript errors
- [ ] No new ESLint warnings (or ceiling updated)
- [ ] Bundle size within budget
- [ ] Manual smoke test: login, well reading, RO train reading, correction approval
- [ ] Edge Functions work (cost computation, etc.)
- [ ] pg_cron jobs running (check `cron.job_run_details`)

## Rollback Procedure

If staging validation fails:

```bash
# Revert migration in staging
supabase migration repair --project-ref <staging-ref> --status reverted <migration-id>
supabase db push --project-ref <staging-ref>

# Fix migration locally
# Re-test locally
# Re-apply to staging
```

## Cost Considerations

| Resource | Staging | Production |
|----------|---------|------------|
| Supabase Plan | Pro (or Free) | Pro |
| Vercel | Hobby/Pro | Pro |
| Edge Function Invocations | ~8,640/mo (5min) | ~8,640/mo |
| pg_cron Jobs | 2 | 2 |

Estimated monthly staging cost: ~$25-50 (Supabase Pro + Vercel Pro)

## Timeline

| Week | Milestone |
|------|-----------|
| 1 | Create staging Supabase project, apply baseline |
| 1 | Deploy Edge Functions to staging |
| 2 | Configure Vercel staging project |
| 2 | Set up GitHub secrets and CI |
| 3 | Test full migration workflow |
| 3 | Document runbooks for team |
| 4 | Go live: all migrations go through staging first |

---

*Document version: 1.0*
*Created: 2026-09-09*
*Owner: Platform Team*