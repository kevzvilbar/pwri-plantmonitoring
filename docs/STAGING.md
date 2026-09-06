# Staging & Preview Environments

Roadmap Phase 1 — decouple preview environments from production.

## Why this exists

Vercel preview deployments used to inherit the production environment
variables. That meant every `git push` to an open PR — from any
collaborator — pointed a shareable, passwordless URL at the **production**
Supabase project: real plant data, real accounts, one accidental destructive
query away from an incident. Previews must always talk to a disposable
staging project instead.

## One-time setup: the staging Supabase project

1. Create a second Supabase project (e.g. `pwri-staging`) in the same
   organization. Free tier is fine — it stays idle between QA sessions.
2. Apply the migrations to it (they are the single source of truth; the
   stray-per-environment practice that caused the 2026-07 drift is gone):

   ```bash
   supabase link --project-ref <staging-project-ref>
   supabase db push          # applies every supabase/migrations/*.sql in order
   ```

3. Create at least one admin user through the app's normal sign-up flow,
   then promote it (or seed it via `auth.users` + `user_roles`) exactly as
   on production. Staging gets the same RLS as production because it runs
   the same migrations — that's the point.
4. Optional but recommended: enable a scheduled backup on staging too, so
   QA sessions that write test data are cheap to reset.

## Vercel: point previews at staging

In the Vercel dashboard:
**Project → Settings → Environment Variables**, and for each of the three
vars below choose the **Preview** scope (and optionally *Development* for
local-simulating builds), setting them to the **staging** project's values:

| Variable | Value source |
| --- | --- |
| `VITE_SUPABASE_URL` | Staging project → Settings → API |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Staging project → Settings → API (anon key) |
| `VITE_SUPABASE_PROJECT_ID` | Staging project ref |

Production keeps its own values in the *Production* scope, untouched.

Notes:

- The variable **names** are the same everywhere; only the values differ
  per scope. Nothing in the codebase reads a separate `STAGING_*` variable —
  `.env.example`'s "Staging" block documents this convention, it doesn't
  introduce new vars.
- `VITE_SENTRY_DSN` (see `frontend/src/lib/monitoring.ts`) can point at the
  same Sentry project for staging previews — set an environment filter or
  just accept preview noise; it's a safe no-op when unset.
- After changing scope values, redeploy the preview (or push a new commit)
  for the change to take effect — env vars are baked at build time, they
  are not hot-swapped.

## Verifying a preview is really on staging

Open the deployed preview URL and check the network tab: requests should
target `<staging-project-ref>.supabase.co`, never the production ref.
Doing this once after setup is the cheapest way to catch a scope typo —
a preview that talks to production defeats the entire setup.

## Keeping staging fresh

Migrations drift the moment someone edits the production schema directly
(it has happened before — see migration `20260729000007`'s header and the
filter-usage reconciliation in `20260729000008`). The rule is now:
**no out-of-band schema changes**; everything goes through
`supabase/migrations/` and gets pushed to both projects. When staging
falls behind:

```bash
supabase link --project-ref <staging-project-ref>
supabase db push
supabase gen types typescript --project-id <staging-ref> \
  > frontend/src/integrations/supabase/types.ts
```

## pgTAP / RLS tests

`supabase/tests/database/*.sql` run only against disposable local instances
(`supabase test db`, or the `rls-tests` CI job). They never touch staging
or production — don't wire them to either.
