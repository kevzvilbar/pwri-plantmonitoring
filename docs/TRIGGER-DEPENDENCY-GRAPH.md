# Trigger Dependency Graph

**Roadmap Phase 4** — "Document the full trigger dependency graph", so a
future change can reason about a single `INSERT`'s blast radius instead of
discovering trigger cascades one production incident at a time.

This document is derived from a scan of `supabase/migrations/*.sql`
(2026-09-06). Every row is a `CREATE TRIGGER` with the table it fires on and
the function it calls. Triggers are grouped by purpose, then the *cascade
chains* — the sequences of nested triggers a single write can start — are
spelled out with their depth and the risk each carries.

---

## 1. Inventory by purpose

### 1a. `updated_at` bookkeeping (BEFORE UPDATE — single-statement, no cascade)

| Trigger | Table | Function |
|---|---|---|
| `trg_plants_updated` | plants | `update_updated_at_column` |
| `trg_user_profiles_updated` | user_profiles | `update_updated_at_column` |
| `trg_locators_updated` | locators | `update_updated_at_column` |
| `trg_wells_updated` | wells | `update_updated_at_column` |
| `trg_ro_trains_updated` | ro_trains | `update_updated_at_column` |
| `trg_chem_inv_updated` | chemical_inventory | `update_updated_at_column` |
| `trg_incidents_updated` | incidents | `update_updated_at_column` |
| `trg_electric_bills_updated` | electric_bills | `update_updated_at_column` |
| `trg_production_costs_updated` | production_costs | `update_updated_at_column` |
| `trg_dps_updated` | daily_plant_summary | `update_updated_at_column` |
| `trg_opex_budgets_updated` | opex_budgets | `update_updated_at_column` |
| `trg_migration_state_updated` | migration_state | `update_updated_at_column` |
| `trg_custom_roles_updated` | custom_roles | `update_updated_at_column` |

### 1b. Reading → presence sync (AFTER INSERT / UPDATE OF recorded_by)

| Trigger | Table | Function |
|---|---|---|
| `trg_locator_readings_presence` | locator_readings | `fn_trg_sync_operator_presence` |
| `trg_well_readings_presence` | well_readings | `fn_trg_sync_operator_presence` |
| `trg_ro_train_readings_presence` | ro_train_readings | `fn_trg_sync_operator_presence` |
| `trg_product_meter_readings_presence` | product_meter_readings | `fn_trg_sync_operator_presence` |
| `trg_chemical_dosing_logs_presence` | chemical_dosing_logs | `fn_trg_sync_operator_presence` |
| `trg_power_readings_presence` | power_readings | `fn_trg_sync_operator_presence` |
| `trg_afm_readings_presence` | afm_readings | `fn_trg_sync_operator_presence` |
| `trg_cartridge_readings_presence` | cartridge_readings | `fn_trg_sync_operator_presence` |

(Marks the operator active; writes `user_presence` — depth 1, no further triggers.)

### 1c. Cost recompute (AFTER INSERT/UPDATE/DELETE)

| Trigger | Table | Function |
|---|---|---|
| `trg_well_cost` | well_readings (`UPDATE OF daily_volume, reading_datetime, well_id`) | `trg_recompute_cost` |
| `trg_power_cost` | power_readings (`UPDATE OF total_kwh, total_cost, reading_datetime, plant_id`) | `trg_recompute_cost` |
| `trg_chem_cost` | chemical_dosing_logs (`UPDATE OF amount_used_kg, cost_php, date, plant_id`) | `trg_recompute_cost` |
| `trg_filter_replacements_sync_cost` | filter_replacements | `fn_sync_filter_cost_to_production_costs` |
| `trg_pretreatment_sync_filter_cost` | ro_pretreatment_readings (`UPDATE OF cartridges_changed, bag_filters_changed, train_id, reading_datetime`) | `fn_sync_filter_usage_cost` |

> ⚠ Known coexistence (headers of 20260906000002 / 20260729000008):
> `production_costs.filter_cost` can be written by BOTH
> `trg_filter_replacements_sync_cost` AND `trg_pretreatment_sync_filter_cost`
> — whichever fired last for the day wins. Unification is a product decision
> (which cost basis is canonical) and is left open deliberately.

### 1d. Reading **chain** cascade (the deep ones — see §2)

| Trigger | Table | Function |
|---|---|---|
| `trg_well_readings_delta` | well_readings | `fn_sync_well_reading_chain` |
| `trg_product_meter_readings_delta` | product_meter_readings | `fn_sync_product_meter_reading_chain` |
| `trg_blending_readings_chain` | blending_events | `fn_sync_blending_reading_chain` |
| `trg_blending_set_reading` | blending_events | `fn_blending_set_reading` |
| `trg_sync_derived_locator_mirror` | locator_readings | `fn_sync_derived_locator_mirror` |

### 1e. Guards / enforcement (BEFORE or AFTER)

| Trigger | Table | Function |
|---|---|---|
| `trg_force_direct_mode` | locators | `fn_force_direct_mode_when_derived` |
| `trg_guard_custom_role_override` | custom_role_overrides | `fn_guard_custom_role_override` |
| `trg_incident_ref` | incidents (INSERT) | `generate_incident_ref` |
| `trg_sync_permeate_is_production` | plant_meter_config | `fn_sync_permeate_is_production` |
| `trg_sync_dps_production` | daily_plant_summary | `sync_daily_plant_summary_production` |

### 1f. Sync / denormalization (AFTER, writes elsewhere)

| Trigger | Table | Function |
|---|---|---|
| `trg_sync_ro_train_reading_meter_replacement` | ro_train_readings | `sync_ro_train_reading_meter_replacement_flag` |
| `trg_user_roles_sync_app_metadata` | user_roles | `trg_sync_user_role_to_app_metadata` |
| `trg_notify_submitter_on_correction_rejection` | correction_requests | `fn_notify_submitter_on_correction_rejection` |

### 1g. Auth bootstrap / misc (incl. outside `public`)

| Trigger | Table | Function |
|---|---|---|
| `on_auth_user_created` | `auth.users` (AFTER INSERT) | `handle_new_user` |
| `trg_regression_results_outlier_count` | regression_results | `trg_regression_results_outlier_count` (self) |
| `trg_flag_derived_review_locator` | locator_readings | `fn_flag_derived_review` |
| `trg_flag_derived_review_meter` | product_meter_readings | `fn_flag_derived_review` |

---

## 2. Cascade chains (a single write → every trigger it can start)

### Chain A — a `well_readings` INSERT (depth ≈ 7)

```
INSERT well_readings
 ├─ fn_sync_well_reading_chain      (chain sync: computes daily_volume,
 │    resyncs the previous-reading chain; WRITES well_readings rows)
 │      └─ trg_well_readings_delta  re-fires on those intra-chain updates
 ├─ trg_well_cost                   (writes production_costs)
 ├─ trg_well_readings_presence      (writes user_presence)
 └─ spike-detection / review flags  (writes review_flags / audit log)
```

The intra-chain `UPDATE`s from `fn_sync_well_reading_chain` re-enter the same
trigger (`trg_well_readings_delta`), which is what makes the depth variable —
**not** a fixed count. A bug here historically produced the "fix-the-fix"
migration pattern (see the `20260905000001`–`000007` backfill repairs).

### Chain B — a `locator_readings` INSERT (depth ≈ 6)

```
INSERT locator_readings
 ├─ fn_sync_derived_locator_mirror  (mirrors derived rows)
 ├─ trg_flag_derived_review_locator (flags derived-review rows)
 ├─ trg_locator_readings_presence
 └─ (chain sync writes locator_readings → re-fires)
```

### Chain C — a `product_meter_readings` INSERT

```
INSERT product_meter_readings
 ├─ fn_sync_product_meter_reading_chain (chain sync; re-fires on its own
 │    writes → recursive)
 ├─ trg_flag_derived_review_meter
 ├─ trg_product_meter_readings_presence
 └─ trg_sync_derived_locator_mirror (if mirrored to locators)
```

### Chain D — cost writes (shared by A/B via `trg_recompute_cost`)

```
production_costs
 └─ trg_production_costs_updated  (updated_at)
```

---

## 3. Observations & Phase-4 recommendations

1. **The depth is unbounded by design.** Chains A–C can re-enter their own
   trigger on intra-chain `UPDATE`s. There is **no** circuit breaker today.
2. **No telemetry.** Nothing logs "a single insert caused N nested trigger
   executions", so ops has no way to see which chain dominates write latency.
3. **Two writers to `production_costs.filter_cost`** (1c) — the longest-known
   semantic ambiguity; keep the header notes that document it in the
   migrations referenced above.
4. **Recommendations** (roadmap Phase 4):
   - **Max-cascade-depth circuit breaker**: a session GUC
     (`app.trigger_depth`, incremented in chain-entry functions, `RAISE WARNING`
     when > N) is the least invasive first step; a `trigger_depths` log table
     turns it into real telemetry.
   - **Consolidate** functions that always fire together (chain sync +
     presence + spike-detect for a reading `INSERT`) into one `fn_…_hub` per
     chain. Every new trigger must pass the checklist in
     docs/CODE_REVIEW.md.
   - **Keep this doc in sync**: re-run the trigger-inventory scan after any
     migration that adds/drops triggers, and update the tables above.