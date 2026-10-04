# Supabase Advisor Investigation — 2026-10-04

Project `sosfbfxovtleuvahxvpm`. Inputs: six dashboard screenshots (Security Advisor: 0 errors / 57 warnings / 1 info; Performance Advisor: 0 / 304 / 176) plus read-only queries against the live database and logs. Nothing in the live project was changed; every experiment ran inside a rolled-back transaction.

## 1. Headline

**The repo already contains the security fixes; they are not applied to the live database.**
Live `supabase_migrations.schema_migrations` has none of `20260923000001` (alert-status plant access), `20260930000001` (grants + core auth), `20260930000002` (correction + read RPCs), `20260930000003` (RLS hardening) or `20261003000002`. The live function bodies confirm it: `fn_cascade_reading_correction` still takes the caller from a client-supplied argument, `get_alert_statuses` still has no plant check, and 13 `SECURITY DEFINER` functions are still executable by `anon`. This is the same "committed but never applied" pattern as the multiplier migrations. Also, `20261003000001_harden_security_definer_search_paths.sql` is an **empty file** (0 bytes) in the repo.

**The most expensive thing in the database is not a security issue.** Two "latest reading" views account for the largest share of DB time (section 4).

## 2. Security findings (verified against live source/grants)

| ID | Severity | Finding | Fixed by |
|---|---|---|---|
| S-1 | **High** | `fn_cascade_reading_correction(p_table, p_row_id, p_new_current, p_admin_id, p_reason)` is `SECURITY DEFINER`, executable by every signed-in user, and has **no permission check** before it overwrites `locator_readings` / `well_readings` / `product_meter_readings`. `p_admin_id` comes from the client and is written to `raw_edit_log` as `edited_by` with `edited_role = 'Admin'`, so an Operator could rewrite readings and forge the audit trail. Not exercised live (it writes); read from source. | Unapplied `20260930000002` (derives caller from `auth.uid()`, checks role + plant) |
| S-2 | **High** | 5 data-returning `SECURITY DEFINER` RPCs are executable by **anon** and reference neither `auth.uid()` nor any role helper: `get_dashboard_aggregates`, `get_alert_statuses`, `get_train_last_readings`, `latest_power_readings_before`, `uptime_report_covers`. They bypass RLS, and the publishable key ships in the public bundle, so anyone on the internet can read plant operational data and generate request/log load. | Unapplied `20260930000001` + `20260930000002` |
| S-3 | Medium | `get_push_alert_recipient_ids(p_plant_id)` is anon- and authenticated-executable and returns the user ids of active managers/analysts/admins for a plant. Only the edge function needs it. | `20260930000002` (service_role only) |
| S-4 | Medium | `fn_set_product_meter_mirror` and `fn_sweep_derived_meters` have no role check; any signed-in user can re-point a product meter's mirror, or trigger a sweep of up to 30 days (+ up to 90 flagged dates). The sweep is used by operators ("Recalculate now"), so it stays granted, but is a load/integrity lever. | Mirror: `20260930000002`. Sweep: not covered, needs a rate limit or role gate (decision) |
| S-5 | Medium | `production_costs_write` is `ALL` for `auth.role() = 'authenticated'`: any signed-in user can insert/update/delete cost rows. | Unapplied `20260930000003` |
| S-6 | Medium | `ro_train_readings_authenticated_read` is `SELECT true`: every signed-in user reads every plant's RO readings (locator/well readings are plant-scoped). Blocks converting `ro_train_readings_latest` (section 4). | Not covered |
| S-7 | Low | `login_attempts` and `signup_audit` accept unbounded anonymous inserts (`WITH CHECK true`). Intended for pre-login telemetry, but nothing stops a script growing them toward the 0.5 GB cap. Table sizes not measured. | Not covered (add size cap / retention / rate limit) |
| S-8 | Low | 4 trigger functions (`fn_notify_train_offline_push`, `fn_rollup_chemical_dosing_items`, `fn_sync_chemical_delivery_qty_base`, `fn_sync_product_residual_ppm`) show as RPC-callable. Calling them as a function errors ("trigger functions can only be called as triggers"), so risk is low. | New `20261004000002` |
| S-9 | Low | 8 functions with a mutable `search_path` (listed in the screenshot). All are `SECURITY INVOKER`, so limited impact. | New `20261004000002` |
| S-10 | Low | `pg_net` is installed in `public`. Moving it means dropping and re-creating the extension, which breaks train-offline push notifications while it is out. Do in a maintenance window. | Not covered |
| S-11 | Info | Leaked-password protection is off. As far as I know this is a Pro-plan feature, so it cannot be enabled on Free. | n/a |

Checked and **fine**: `admin_set_user_password` (body requires an Admin role row), `approve_user`, `get_all_staff_profiles`, `fn_manager_plant_scorecard`, `touch_user_presence` (role checks present), `complete_onboarding` / `update_own_profile` (scoped to `auth.uid()`), `fn_update_ro_train_em_config` / `fn_update_ro_train_meter_config` (gated by `user_has_ro_write_access`, which returns false for anon; anon grant is still worth revoking). The `has_role` / `is_admin` / `is_manager_*` helpers are executable by signed-in users; that lets a user probe another user's role by uuid, which is low risk and needed by RLS.

**Dashboard vs API count:** the dashboard shows 57 warnings, the API returned 52. The missing 5 are "RLS Policy Always True" (`backfill_sweep_log`, `correction_requests`, `locator_readings`, `login_attempts`, `signup_audit`). Their policies are still present in `pg_policies`, so they are real regardless of which count you trust. Of those, `correction_requests` (`cr_manager_all`, `WITH CHECK true`, role `public`) is the one to fix; `login_attempts` / `signup_audit` are intentional (see S-7); `locator_readings` is a supervisor UPDATE policy whose USING clause is restrictive.

## 3. Performance advisor (304 warnings, 176 suggestions)

| Lint | Count | Reality |
|---|---|---|
| `auth_rls_initplan` | 151 | `auth.uid()` / `has_role(...)` re-evaluated per row. Real, but it only matters on large scans; see section 4 for the one place it dominates. |
| `multiple_permissive_policies` | 146 | Several permissive policies per role/action are OR'ed; heaviest on `correction_requests` (13), `power_meter_changes`, `product_meters`, `production_costs` (9 each). Unapplied `20260930000003` removes some duplicates. |
| `unindexed_foreign_keys` | 89 | INFO. Tables are small (largest: `ro_train_readings` ~27k rows); no action needed now. |
| `unused_index` | 86 | INFO. Do not drop on the strength of one snapshot; stats may have been reset. |
| `duplicate_index` | 7 | Safe wins; 6 handled in `20261004000002` (the 7th backs a unique constraint). |
| `no_primary_key` | 1 | `ro_train_readings_pre_remediation_zero_reject` is a backup table (RLS on, no policies). Drop it once you no longer need the backup. |

## 4. The real performance problem: the `*_readings_latest` views

`pg_stat_statements` (since last reset, which I could not determine):

| View | Calls | Mean | Max | Total DB time |
|---|---|---|---|---|
| `locator_readings_latest` | 184 | 1,948 ms | 4,822 ms | 358 s |
| `well_readings_latest` | 192 | ~1,220 ms | 2,729 ms | ~235 s |
| `ro_train_readings_latest` | 184 | 460 ms | 5,537 ms | 85 s |

Cause: each view is `SELECT DISTINCT ON (entity_id) ... ORDER BY entity_id, reading_datetime DESC`. A `plant_id` filter cannot be pushed below `DISTINCT ON`, so every call walks the whole readings table (12,349 locator rows) and runs the RLS functions per row.

`EXPLAIN ANALYZE` as an Operator: **1,400 ms and 55,778 buffer hits** for the current view versus **27 ms and 1,592 buffer hits** for a per-entity `LATERAL` rewrite, with identical rows (verified as Admin, Manager, Data Analyst and Operator; `EXCEPT` both ways = 0).

Hypothesis, not proven: slow queries like these are a plausible contributor to the 3,131 "Thread killed by timeout manager" rows on 2026-10-03 and to load around the 06:25 PHT restart. Measure it by re-reading `pg_stat_statements` and the PGRST002 count after applying `20261004000001`.

`ro_train_readings_latest` is **not** converted: driving it from `ro_trains` changes what an Operator sees (27 trains -> 11) because of S-6. Fix S-6, then convert.

## 5. Recommended order

1. **Stage first** (`docs/STAGING.md`): apply `20260930000001` -> `20260930000003`, `20260923000001`, `20261003000002`, then `20261004000002`, and run the app as Operator, Manager and Admin. I have not reviewed those migrations line by line or run them; the headers describe what they intend, the live checks above confirm the holes they target. `20260930000001` revokes grants broadly, so expect to find any client RPC that was relying on an anon/PUBLIC grant.
2. Apply `20261004000001` (views). Lowest risk, biggest measured effect.
3. Decisions: gate or rate-limit `fn_sweep_derived_meters` (S-4); scope `ro_train_readings` reads by plant (S-6); retention/size cap for `login_attempts` and `signup_audit` (S-7).
4. Fill or delete the empty `20261003000001_harden_security_definer_search_paths.sql` so migration history is honest (its intended content is in `20261004000002`).
5. Process: add a CI check that fails on 0-byte migration files, and a post-deploy job that compares repo migrations against `supabase_migrations.schema_migrations` — both the empty files and the unapplied security migrations were invisible until now.
