# Log Quota Remediation Plan

Status as of 2026-09-26. Companion to `docs/EGRESS-REDUCTION-PLAN.md`, with which it shares a root cause and architecture.

## Metric Summary & Status

| Metric | Usage | % of quota | Verdict / Action |
|---|---|---|---|
| **Log Ingestion** | 5.027 / 1 GB | **503%** | Over quota from pre-fix cumulative polling storm; daily rate dropping with realtime invalidations |
| **Log Query** | 84.615 / 100 GB | **85%** | Near cap; keep log explorer queries narrow (1-hour window) |
| Egress | 3.378 / 5 GB | 68% | Elevated from past polling storm, stabilizing under realtime invalidations |
| Database Size | 0.117 / 0.5 GB | 23% | Healthy |
| Realtime Messages | 86,237 / 2,000,000 | 4% | Healthy |
| Realtime Concurrent Peak Connections | 8 / 200 | 4% | Healthy |
| Monthly Active Users | 8 / 50,000 | <1% | Healthy |
| Edge Function Invocations | 3 / 500,000 | <1% | Healthy |
| Cached Egress | 0 / 5 GB | 0% | Healthy |

---

## Log Ingestion vs. Log Query

- **Log Ingestion**: The volume of log *data written* (API request logs, Postgres logs, Auth, Realtime, Storage) — driven by overall REST/RPC traffic and database logging verbosity.
- **Log Query**: The volume of log data *scanned* when querying the Logs Explorer or `query_logs` — driven by query time window and broad table scans.

---

## Completed Implementations (2026-09-26)

### 1. Plant-Scoped Realtime Subscriptions (`useTrainDataRealtime.ts`)
- Added plant ID scoping support (`plantIdOverride` / `selectedPlantId`) to `useTrainDataRealtime.ts` with `filter: 'plant_id=eq.<id>'` across all 11 telemetry and event tables.
- Added missing query keys to `TABLE_INVALIDATION_KEYS` (`product-readings-latest-v2`, `product-readings-10day`, `product-meter-last-readings`, `product-meter-latest-readings-stat`, `op-power-recent`, `op-power-history-14d`, `op-loc-latest`, `derived-review-flag`, etc.).

### 2. Elimination of Remaining Short Polling Loops
- **Product Section** (`useProductSectionData.ts`): Removed `refetchInterval: 60_000`, switched to event-driven realtime invalidation with 5m `staleTime`.
- **Derived Meter Panel** (`DerivedMeterPanel.tsx`): Removed `refetchInterval: 60_000`, set `staleTime: 5 * 60_000`.
- **Power Form State** (`usePowerFormState.ts`): Removed `refetchInterval: 120_000`, set `staleTime: 5 * 60_000`.
- **Product Meters Config** (`ProductMeters.tsx` & `ProductMetersStat.tsx`): Removed `refetchInterval: 60_000`, switched to realtime invalidations.
- **Pending Approvals Count** (`usePendingApprovalsCount.ts`): Relaxed polling from 60s to 5m.
- **My Corrections** (`useMyCorrections.ts`): Relaxed polling from 60s to 5m.
- **Data Summary Modal** (`useDataSummaryQueries.ts`): Swapped open-modal polling interval to realtime invalidations with 5m staleTime.

### 3. Payload Trimming (Phase 5)
- **`useAuth.tsx`**: Replaced `select('*')` on `user_profiles` with explicit columns (`id, username, first_name, middle_name, last_name, suffix, designation, immediate_head_id, plant_assignments, status, profile_complete, confirmed`).
- **`useProductSectionData.ts`**: Replaced `select('*')` on `product_meter_readings` with explicit fields (`id, plant_id, meter_id, reading_datetime, current_reading, recorded_by, remarks, is_estimated, norm_status`).
- **`staff.ts` (`fetchKpiReadings`)**: Replaced `select('*')` across all 7 reading tables with explicit required columns matching `kpi.ts`.

### 4. Regression Guardrail (Phase 6)
- Created `scripts/check-log-quota.mjs`: Automated audit script querying the 1-hour REST log window via Supabase API and checking codebase for uncoordinated timers.
- Created `.github/workflows/log-quota-guard.yml`: Weekly automated GitHub Action running every Monday at 02:00 UTC.

---

## Log Query Verification Recipe

When checking Supabase Logs Explorer, always use narrow time ranges (e.g. 1 hour) to protect the Log Query quota:

```sql
select
  log_attributes['request.method'] as method,
  log_attributes['request.path'] as path,
  count(*) as requests
from logs
where source = 'edge_logs'
  and log_attributes['request.path'] like '/rest/v1/%'
  and log_attributes['request.method'] != 'OPTIONS'
  and timestamp >= now() - interval '1 hour'
group by method, path
order by requests desc
limit 20;
```

---

## Action Checklist for Supabase Dashboard Settings

- [ ] **Dashboard → Database → Settings**: Verify `log_min_duration_statement` is set to log slow queries only (e.g., 1000ms+ or errors), not every statement.
- [ ] **Project Settings → Billing**: Check the cycle reset date; the 503% ingestion badge is a cumulative metric and will reset at the next billing period.
