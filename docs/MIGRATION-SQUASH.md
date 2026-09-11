# Migration Squash — Runbook

Roadmap Phase 1 (critique 2026-09-06, item 11: "116 Unsquashed Migrations").

> [!NOTE]
> **COMPLETED (2026-09-11)**: The migration squash has been executed and verified against live production (`sosfbfxovtleuvahxvpm`).
> The live schema was extracted via `supabase db dump --linked`, reconciled via `supabase db pull`, and squashed into a single verified baseline: `supabase/migrations/20260911044610_baseline_schema.sql`.
> `supabase db diff --linked` reports **0 differences** (No schema changes found).
> All 41 out-of-band migrations and 14 production tables are incorporated. All previous migration files are preserved in `supabase/migrations_archive/`.

## Historical Context: the files were not what was actually live

Before squashing, a check against the live project
(`sosfbfxovtleuvahxvpm`) via `supabase_migrations.schema_migrations` turned
up something the critique didn't have visibility into: **the migrations
directory does not fully describe production.**

- `supabase/migrations/` currently has **121** files (116 at the time of
  the critique + 5 added since).
- The project's own remote history table tracks **68** applied migrations.
- Of those 68, **41 (60%)** have a version + name that has never existed
  anywhere in this repo's git history — not as a current file, not as a
  since-deleted or renamed one (`git log --all -S"<name>"` on the
  migrations path returns nothing for any of them).

In other words: something has been running SQL directly against production
— outside `supabase/migrations/` entirely — for months. `docs/STAGING.md`
already names this exact failure mode ("Migrations drift the moment
someone edits the production schema directly... The rule is now: no
out-of-band schema changes") and cites one past instance
(`20260729000007`/`20260729000008`). This is the same problem, 41 more
times, still ongoing — the most recent orphaned change
(`security_fix_revoke_anon_latest_views_and_harden_search_path`,
`20260908044326`) landed the same day as this check.

A representative sample of the 41 (full list at the bottom of this file):

| version | name | why it matters |
|---|---|---|
| `20260523231952` | `security_fix_revoke_anon_execute_on_secdef_functions` | security fix, no file |
| `20260524041835` | `security_fix_qualify_all_table_refs_set_empty_search_path` | security fix, no file |
| `20260901061127` | `presence_rpc_privilege_scope_fix` | the privilege-escalation fix from the 2026-09-01 session — delivered as a patch but apparently never merged |
| `20260908044326` | `security_fix_revoke_anon_latest_views_and_harden_search_path` | applied **today**, not in the repo at all |

### Why this blocks a naive squash

`supabase migration squash` (and hand-concatenating the 121 files, which
amounts to the same thing) only knows about what's in
`supabase/migrations/`. Run today, the resulting baseline would **omit all
41 of the changes above** — several of them security hardening that's
currently protecting production. Anyone bootstrapping staging, a preview
database, or a fresh local environment from that baseline would get a
schema that's *measurably less secure* than what's actually running,
silently. That's a worse outcome than the current 121-file sprawl, not a
fix for it.

### Why Claude can't just generate the baseline directly

Producing a baseline that's guaranteed byte-for-byte correct requires
`pg_dump` against the live database, which needs a direct Postgres
connection (`supabase link` + the project's DB password). The Supabase MCP
tools available in this session are scoped to the management API — they
can run SQL and list schema objects, but they don't expose the DB
credentials, and this sandbox's network egress doesn't reach
`*.supabase.co` at all. Hand-reconstructing 70+ tables, their triggers,
and 56+ `SECURITY DEFINER` functions from `information_schema` queries by
hand is possible in principle but is exactly the kind of manual,
unverified process that produced the drift in the first place. This has
to be run from a machine that has the project linked with real
credentials — i.e. locally, by Kevz.

## The correct procedure

Run from a clone with `supabase` CLI installed and network access to
Supabase (the CI runner already uses `supabase/setup-cli@v1` for the
`rls-tests` job — same binary, run locally instead).

**0. Backup first.** Dashboard → Database → Backups → trigger a manual
backup, or `pg_dump` the whole thing yourself. Non-negotiable — steps 3–4
below write to the remote migration history table.

```bash
# 1. Auth + link
supabase login
supabase link --project-ref sosfbfxovtleuvahxvpm

# 2. Reconcile: pull whatever's live but not in supabase/migrations/,
#    and repair the remote history table to match. This is what accounts
#    for the 41 orphaned entries — expect it to generate one new migration
#    file (something like <timestamp>_remote_schema.sql) capturing their
#    net effect on the schema. It will NOT recover the original 41
#    individual changes as separate files — only their current combined
#    result. Read the generated file before committing it; cross-check it
#    against the "what to expect" list at the bottom of this doc.
supabase db pull

# 3. Verify reconciliation actually closed the gap — this must report
#    zero differences before you go anywhere near squashing.
supabase db diff --linked

# 4. Commit the reconciliation migration on its own first, separately
#    from the squash (small, reviewable, easy to revert in isolation if
#    something about it looks wrong):
#    git add supabase/migrations/<new_remote_schema_file>.sql
#    git commit -m "chore(db): reconcile 41 migrations applied directly to prod"

# 5. Now squash everything through that point into one baseline.
#    --version takes the LOCAL version you want to squash up through —
#    use the reconciliation file's own version/timestamp to squash
#    everything (old 121 files + the new reconciliation file) into one.
supabase migration squash --version <reconciliation-file-version>

# 6. Re-verify. This is the real proof the new baseline is equivalent to
#    what's actually running — not just "looks complete."
supabase db diff --linked
# must show NO diff. If it shows anything, stop and investigate before
# committing — do not force through a mismatch here.

# 7. Prove the baseline is also functionally complete, not just textually
#    equivalent: reset local Supabase from ONLY the new baseline and run
#    the existing pgTAP suite against it.
supabase db reset
supabase test db
# same suite the rls-tests CI job runs — if it passes here it'll pass there.

# 8. Commit the squashed baseline, open a PR, merge as usual.
```

## After merging

- The `rls-tests` CI job needs no changes — it already does
  `supabase start` (applies everything in `supabase/migrations/` from
  scratch) before running pgTAP, so it validates the new baseline for
  free on the very next PR.
- Check off "Squash migrations to a single baseline" in the Phase 1
  roadmap list.
- The drift doesn't stay fixed on its own. See
  `.github/workflows/migration-drift-check.yml` (added alongside this
  doc) — it runs `supabase db diff --linked` on a schedule and fails loud
  the next time something gets applied to prod outside a committed
  migration, instead of letting it silently accumulate for another two
  months.
- Figure out *what* has been applying these 41 out-of-band changes
  (dashboard SQL editor sessions, the v0 tool, direct MCP calls in past
  Claude sessions — the presence-privilege fix from 2026-09-01 is one of
  the 41, and it's not clear it was ever actually merged as the patch it
  was delivered as) and close that off. Squashing today just resets the
  counter if the same path stays open.

## Appendix: all 41 orphaned live migrations

Cross-check these against what `supabase db pull` generates in step 2 —
every one of them should be represented in the resulting schema, even
though they won't exist as separate files.

```
20260419060650  b900c2e9-d268-4c41-8b8d-e34cc373bd13
20260419060711  61c71ba1-cb6e-4d13-8c13-6696435e7f09
20260420003032  0ef62b2f-6899-4cfb-bc55-ecfca0dc8179
20260420094243  9b477528-1289-4d67-8e4a-d309b05f680b
20260421020450  ebfb9e45-4fcb-471c-932d-b8e3792db9a4
20260422005939  27940929-1f77-4fb0-822b-d161de4bcdb7
20260424001706  193929a6-c08d-43df-9d6c-ce35bfa423cf
20260424002547  735ac03b-9d91-4a85-8da2-26026e3404b2
20260523231952  security_fix_revoke_anon_execute_on_secdef_functions
20260523232034  security_fix_function_search_path
20260523232054  security_fix_rls_missing_policies_and_permissive_always_true
20260523232110  perf_fix_duplicate_and_unused_indexes
20260523232132  perf_fix_missing_fk_indexes
20260523232154  perf_fix_auth_rls_initplan_wrap_auth_uid
20260523234237  fix_rls_policy_helper_function_grants
20260523234729  fix_rls_grants_and_promote_kevin_admin
20260523235811  fix_user_roles_rls_infinite_recursion
20260524000942  security_fixes_safe_rls_cleanup
20260524041257  fix_search_path_use_public_not_empty
20260524041835  security_fix_qualify_all_table_refs_set_empty_search_path
20260531005216  add_well_id_to_ro_trains
20260723050539  fix_plant_power_config_policy_and_analyst_check_and_search_path
20260723050615  fix_product_meter_readings_manager_update_with_check
20260731220754  add_solar_cost
20260801034649  fix_cost_date_to_local_timezone_functions
20260801034740  rebuild_production_costs_local_dates
20260801092722  fix_power_multiplier_and_consolidate_triggers
20260801142439  fix_meter_replacement_predecessor_bug
20260801142740  rebuild_production_costs_after_multiplier_fix
20260809010254  fix_product_meter_integrity_derived_guard
20260809010311  add_derived_locator_mirror_sync_trigger
20260809010949  fix_derived_locator_mirror_sync_is_estimated_convention
20260810193340  product_meter_readings_pending_review_predecessor_fix
20260812041645  data_corrections_approve_reflag_fix
20260813113642  regression_results_truncated_column
20260813114444  regression_results_delete_rls_policy
20260814035457  data_analysis_review_readings_role_bypass
20260901061127  presence_rpc_privilege_scope_fix
20260902042755  fix_ro_train_status_active_to_running
20260902231006  merge_timezone_fix_with_module_isolation_hardening
20260908044326  security_fix_revoke_anon_latest_views_and_harden_search_path
```
