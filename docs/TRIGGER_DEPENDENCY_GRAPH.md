# Trigger Dependency Graph Documentation
## Phase 4: Database Hardening

**Generated:** 2026-09-09
**Purpose:** Document all trigger chains for audit, debugging, and consolidation planning.

---

## Overview

The database has **~40 triggers** that form cascading chains. A single INSERT can fire 10+ triggers within the same transaction, causing:
- Performance degradation (locks held longer)
- Debugging difficulty (errors surface from deep in the chain)
- Data corruption risk (bugs in downstream triggers "fix" upstream data incorrectly)

---

## Trigger Chains by Category

### 1. Reading Chain Sync (Water Flow)
| Trigger | Table | Function | Fires On | Cascades To |
|---------|-------|----------|----------|-------------|
| `trg_locator_readings_delta` | `locator_readings` | `fn_sync_locator_reading_chain()` | AFTER INSERT/UPDATE | Updates `previous_reading` on next reading |
| `trg_well_readings_delta` | `well_readings` | `fn_sync_well_reading_chain()` | AFTER INSERT/UPDATE | Updates `previous_reading` on next reading |
| `trg_product_meter_readings_delta` | `product_meter_readings` | `fn_sync_product_meter_reading_chain()` | AFTER INSERT/UPDATE | Updates `previous_reading` on next reading |
| `trg_blending_readings_chain` | `blending_events` | `fn_sync_blending_reading_chain()` | AFTER INSERT/UPDATE | Updates `previous_reading` on next blending event |

**Chain depth:** 2-3 (reading → next reading's previous_reading)

---

### 2. Derived Meter Mirroring (HAMAS System)
| Trigger | Table | Function | Fires On | Purpose |
|---------|-------|----------|----------|---------|
| `trg_sync_derived_locator_mirror` | `locator_readings` | `fn_sync_derived_locator_mirror()` | AFTER INSERT/UPDATE | Mirrors locator → product meter for "derived" meters |
| `trg_sync_product_meter_mirror` | `product_meter_readings` | `fn_sync_product_meter_mirror()` | AFTER INSERT/UPDATE | Mirrors product meter → locator for derived flow |

**Chain depth:** 2 (source → derived mirror)

---

### 3. Meter Replacement Wiring
| Trigger | Table | Function | Fires On | Purpose |
|---------|-------|----------|----------|---------|
| `trg_sync_well_reading_meter_replacement` | `well_readings` | `fn_sync_well_reading_meter_replacement()` | AFTER INSERT/UPDATE | Handles rollover on meter replacement |
| `trg_sync_locator_reading_meter_replacement` | `locator_readings` | `fn_sync_locator_reading_meter_replacement()` | AFTER INSERT/UPDATE | Handles rollover on meter replacement |
| `trg_sync_ro_train_reading_meter_replacement` | `ro_train_readings` | `fn_sync_ro_train_reading_meter_replacement()` | AFTER INSERT/UPDATE | Handles rollover on meter replacement |
| `trg_sync_product_meter_reading_meter_replacement` | `product_meter_readings` | `fn_sync_product_meter_reading_meter_replacement()` | AFTER INSERT/UPDATE | Handles rollover on meter replacement |

**Chain depth:** 1 (self-contained)

---

### 4. Cascade Reading Correction (Manual Edits)
| Trigger | Table | Function | Fires On | Purpose |
|---------|-------|----------|----------|---------|
| (Called directly via RPC) | All reading tables | `fn_cascade_reading_correction()` | Manual edit via UI | Recursively fixes downstream `previous_reading` and `daily_volume` |

**Chain depth:** N (recursive, can cascade through entire reading chain)
**Risk:** HIGH - recursive, can cascade through hundreds of readings

---

### 5. Cost Recomputation (Production Costs)
| Trigger | Table | Function | Fires On | Cascades To |
|---------|-------|----------|----------|-------------|
| `trg_chem_cost` | `chemical_dosing_logs` | `fn_sync_chem_cost_to_production_costs()` | AFTER INSERT/UPDATE/DELETE | Updates `production_costs.chem_cost` |
| `trg_power_cost` | `power_readings` | `fn_sync_power_cost_to_production_costs()` | AFTER INSERT/UPDATE/DELETE | Updates `production_costs.power_cost` |
| `trg_well_cost` | `well_readings` | `fn_sync_well_cost_to_production_costs()` | AFTER INSERT/UPDATE/DELETE | Updates `production_costs.power_cost` |
| `trg_filter_replacements_sync_cost` | `filter_replacements` | `fn_sync_filter_cost_to_production_costs()` | AFTER INSERT/UPDATE/DELETE | Updates `production_costs.filter_cost` |
| `trg_pretreatment_sync_filter_cost` | `afm_readings` | `fn_sync_filter_usage_cost()` | AFTER INSERT/UPDATE/DELETE | Updates `production_costs.filter_cost` |
| `trg_sync_dps_production` | `daily_plant_summary` | `fn_sync_dps_production()` | AFTER INSERT/UPDATE | Updates `production_costs` volume |

**Chain depth:** 2 (source → production_costs)

---

### 6. Daily Plant Summary (Aggregation)
| Trigger | Table | Function | Fires On | Purpose |
|---------|-------|----------|----------|---------|
| `trg_dps_updated` | Various reading tables | `fn_refresh_daily_plant_summary()` | AFTER INSERT/UPDATE/DELETE | Recomputes `daily_plant_summary` aggregates |

**Chain depth:** 2 (reading → daily_plant_summary → production_costs via `trg_sync_dps_production`)

---

### 7. Backfill & Anomaly Detection
| Trigger | Table | Function | Fires On | Purpose |
|---------|-------|----------|----------|---------|
| `trg_backfill_missing_readings` | Scheduled/cron | `fn_backfill_missing_readings()` | Manual/scheduled | Fills gaps in reading chains |
| `trg_locator_readings_presence` | `locator_readings` | `fn_track_presence()` | AFTER INSERT | Updates `user_profiles.last_seen_at` |
| `trg_well_readings_presence` | `well_readings` | `fn_track_presence()` | AFTER INSERT | Updates `user_profiles.last_seen_at` |
| ... (similar for each reading table) | | | | |

---

### 8. Audit & Compliance
| Trigger | Table | Function | Fires On | Purpose |
|---------|-------|----------|----------|---------|
| `trg_notify_submitter_on_correction_rejection` | `correction_requests` | `fn_notify_submitter_on_correction_rejection()` | AFTER UPDATE | Sends notification on rejection |
| `trg_user_roles_sync_app_metadata` | `user_roles` | `fn_sync_user_roles_to_app_metadata()` | AFTER INSERT/UPDATE/DELETE | Syncs roles to auth metadata |
| `trg_custom_roles_updated` | `custom_roles` | `fn_custom_roles_updated()` | BEFORE UPDATE | Validates custom role changes |
| `trg_guard_custom_role_override` | `custom_role_overrides` | `fn_guard_custom_role_override()` | BEFORE INSERT/UPDATE | Enforces override limits |

---

## Full Chain Depth Analysis

### Worst Case: Manual Well Reading Edit
```
1. UPDATE well_readings (manual edit)
   ↓
2. trg_well_readings_delta → fn_sync_well_reading_chain()
   → Updates next reading's previous_reading
   ↓
3. fn_cascade_reading_correction() (if invoked via UI)
   → Recursively fixes entire downstream chain
   ↓
4. trg_well_cost → fn_sync_well_cost_to_production_costs()
   → Updates production_costs
   ↓
5. trg_dps_updated → fn_refresh_daily_plant_summary()
   → Recomputes daily_plant_summary
   ↓
6. trg_sync_dps_production → fn_sync_dps_production()
   → Updates production_costs again
```

**Total triggers fired:** 6-10+ in single transaction
**Lock duration:** Significantly increased

---

## Consolidation Opportunities

### High Priority (Reduce Chain Depth)

1. **Combine Chain Sync + Cost Triggers**
   - Current: Separate triggers for chain sync and cost
   - Proposed: Single trigger per table that does both
   - Benefit: Reduces from 2→1 trigger per table per operation

2. **Move Cost Computation to Scheduled Job**
   - Current: Synchronous in same transaction
   - Proposed: Async via `pg_cron` or Edge Function
   - Benefit: Removes cost triggers from hot path entirely

3. **Combine Mirror Triggers**
   - Current: Separate triggers for locator↔product meter mirroring
   - Proposed: Single bidirectional sync function

### Medium Priority

4. **Replace Recursive Cascade with Iterative**
   - Current: `fn_cascade_reading_correction()` uses recursion
   - Proposed: Iterative CTE or scheduled backfill job
   - Benefit: Prevents stack overflow, easier to debug

5. **Column-Restrict All Triggers** (Partially done in 20260909000002)
   - Current: Many triggers fire on ANY column change
   - Proposed: `WHEN` clauses for specific columns only

### Low Priority

6. **Replace Stored `previous_reading`/`daily_volume` with LAG() Views**
   - Current: Stored columns updated by triggers
   - Proposed: Materialized views or computed columns
   - Benefit: Eliminates chain sync triggers entirely

---

## Migration Order for Consolidation

1. **Week 1:** Add missing indexes (20260909000001) + column-restrict cost triggers (20260909000002)
2. **Week 2:** Create trigger dependency test suite (pgTAP)
3. **Week 3:** Combine chain sync + cost triggers per table
4. **Week 4:** Move cost computation to Edge Function + pg_cron
5. **Week 5:** Replace recursive cascade with iterative CTE
6. **Week 6:** Evaluate LAG() view replacement for chain columns

---

## Testing Strategy

Each consolidation step must:
1. Pass existing pgTAP RLS tests
2. Add new pgTAP tests for trigger behavior
3. Verify with load test (1000 concurrent inserts)
4. Compare query plans before/after (EXPLAIN ANALYZE)

---

## Rollback Plan

Each migration is independently reversible:
- Indexes: `DROP INDEX IF EXISTS`
- Triggers: `DROP TRIGGER IF EXISTS ... ON ...`
- Functions: `DROP FUNCTION IF EXISTS ...`

All migrations use `IF EXISTS` guards for idempotency.

---

## Monitoring

Add to observability:
- `pg_stat_user_tables` - trigger fire counts
- `pg_locks` - lock contention during bulk inserts
- Custom metric: `trigger_chain_depth` histogram
- Alert on chain depth > 5