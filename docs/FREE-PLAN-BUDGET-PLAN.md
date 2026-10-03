# Free-Plan Budget Plan — Billing Cycle Starting 2026-10-03

Project `sosfbfxovtleuvahxvpm` (PWRI Plant Monitoring). Companion to `docs/EGRESS-REDUCTION-PLAN.md` and `docs/LOG-QUOTA-REMEDIATION-PLAN.md`.

**Goal:** finish this cycle under every Free-plan quota, with the real risk (Log Ingestion) brought under 1 GB.
**Assumption:** the cycle is 30 days (≈ Oct 3 → Nov 2). Confirm the exact reset date on the Supabase billing page.

---

## 1. Day-1 snapshot vs. a 30-day budget

| Metric | Day 1 | Quota | Budget / day | Day-1 pace | Verdict |
|---|---|---|---|---|---|
| **Log Ingestion** *(UPCOMING meter)* | 0.102 GB | 1 GB | 0.033 GB | **≈ 3.1× budget** (≈ 3 GB if sustained) | **Will breach around day 10** |
| Log Query *(UPCOMING meter)* | 0 GB | 100 GB | 3.3 GB | 0 | Safe if we stay disciplined (last cycle hit 84.6 GB) |
| Egress | 0.079 GB | 5 GB | 0.167 GB | 0.47× (Saturday, light use) | Watch — weekday load is unmeasured |
| Database Size | 0.122 GB | 0.5 GB | n/a | n/a | Safe (see §2.4) |
| Realtime messages | 2,244 | 2,000,000 | 66,667 | <1% | Safe |
| Realtime peak connections | 7 | 200 | n/a | 4% | Safe |
| MAU | 1 | 50,000 | n/a | <1% | Safe |
| Cached Egress | 0 | 5 GB | n/a | 0 | Not used by PostgREST; ignore |

**Last cycle for reference:** Log Ingestion 5.027 GB (503%), Log Query 84.6 GB (85%), Egress 3.38 GB (68%). Fixes since then (polling removed, plant-scoped realtime, trimmed selects) helped, but day 1 shows Log Ingestion is still ~3× over pace.

> The two log meters are labelled *UPCOMING*. They are counted but the badge suggests enforcement is not live yet. Check the billing page for current terms before relying on that; treat 1 GB as a hard line.

---

## 2. What the live logs show (measured 2026-10-03, 00:00–14:36 UTC)

### 2.1 Volume

- **≈ 42,200 log rows** in ~14.6 h. `edge_logs` = 36,691 (87%), `postgrest_logs` = 4,080, `postgres_logs` = 805, realtime 339, auth 289.
- Average ≈ 2.4 KB per row (0.102 GB ÷ 42.2k rows; approximate, the billing day and UTC day are offset). **Budget = ≈ 14,000 rows/day.** We need roughly a 3× cut.
- Ingestion is driven by **request count**: every REST call writes one `edge_logs` row (with full headers) plus often a `postgrest_logs` row. CORS `OPTIONS` preflights are logged as separate rows.

### 2.2 Traffic is bursty, which points to page-load fan-out rather than steady polling

- Only 5 browser sessions (3 desktop, 2 Android; GitHub Pages ×4, Vercel ×1) produced almost all of it.
- One Vercel session made **172 requests in one minute (14:04Z), 143 at 14:30Z, 106 at 14:36Z**, with near-silence between.
- Inside one burst, the same reference tables were fetched repeatedly: `locators` 18×, `product_meters` 14×, `ro_trains` 14×, `wells` 12×, `plant_power_config` 6×, `plants` 5×. Those four alone are ≈ 58 of ~172 calls. One call each would do.
- Daily top paths: `ro_train_readings` 2,614 GET + 2,064 OPTIONS, `ro_trains` 1,806, `product_meter_readings` 1,396 + 1,170 OPTIONS, `power_readings` 1,162, `ro_pretreatment_readings` 1,122 + 927 OPTIONS, `well_readings` 1,055, `user_profiles` 1,029, `train_status_log` 975.
- About 1 in 5 of the top-25 rows are `OPTIONS` preflights, concentrated on reading tables whose URLs change per request (date filters).

### 2.3 Noise that costs log rows and delivers nothing

| Signal | Count today | Meaning |
|---|---|---|
| PostgREST `Warp server error: Thread killed by timeout manager` | **3,131 (77% of all PostgREST rows)** | Usually the client dropped the connection before the response finished (queries cancelled on navigation/unmount). Not traced per-request; treat as a symptom of fan-out. |
| `column product_meter_readings.remarks does not exist` | 270 | Frontend selects a column that isn't live. `useProductSectionData.ts:100` `PRODUCT_LATEST_FIELDS` includes `remarks`, which the Sep 26 payload-trimming added. |
| `column power_meter_changes.power_kind does not exist` | 63 | Multiplier-feature code (`MeterMultiplierSection.tsx:88`, `PowerMeterMultiplierModal.tsx`) ahead of the live schema. |
| `column plant_power_config.solar_meter_multipliers does not exist` | 54 | Same feature (`PowerMeters.tsx`, `PowerMeterManageModal.tsx`). |
| `column user_profiles.role does not exist` | 43 | `ShiftHandoverModal.tsx:114` selects `role` from `user_profiles`; roles live in `user_roles`. |

Verified live: those four columns are absent, and repo migrations `20260926000001`, `20260927000001`, `20260927000002`, `20260927003000` (multiplier feature) are not reflected in the live schema. This is the same committed-but-not-applied drift pattern seen before.

### 2.4 Database size is not a risk this cycle

- Real size 102 MB (dashboard shows 0.122 GB). Largest: `ro_pretreatment_readings` 32 MB / 25.5k rows, `ro_train_readings` 18 MB / 26.2k rows, `locator_readings` 8.5 MB, `well_readings` 4 MB.
- Last 30 days of inserts: 5,900 + 5,894 + 1,759 + 899 rows ≈ **14 MB/month**. At that rate the 0.5 GB cap is more than two years away. No retention work needed now.

---

## 3. Plan

Ordered by payoff per effort. Phase 0 can happen today.

### Phase 0 — Stop the failing requests (today, tiny changes)

1. `useProductSectionData.ts:100`: remove `remarks` from `PRODUCT_LATEST_FIELDS` (column doesn't exist on `product_meter_readings`).
2. `ShiftHandoverModal.tsx:114`: remove `role` from the `user_profiles` select; read roles from `user_roles` if the modal needs them.
3. **Decision needed — multiplier feature:** either apply the four pending migrations (feature goes live) or gate/revert the frontend queries that reference `power_kind` and `solar_meter_multipliers`. Until one is done, every visit to the Power meter config page produces 400s (and one retry each, since `retry: 1`).
4. Rule for this cycle: do dev/testing against staging (`docs/STAGING.md`), not the production project, and close idle production tabs. Test sessions count toward the same quota.

Expected effect: ≈ 430 failed attempts/day gone. Small, but it also removes error toasts.

### Phase 1 — Dedupe reference data (biggest single lever)

Reference tables (`plants`, `wells`, `locators`, `product_meters`, `ro_trains`, `plant_meter_config`, `plant_power_config`, `compliance_thresholds`, a minimal `user_profiles` list) are fetched per component with differing query keys, so react-query cannot dedupe them.

1. Create one shared hook per table (e.g. `useWells(plantId)`, `useLocators(plantId)`, `useRoTrains(plantId)`), each with a **single canonical query key** and `staleTime: 30 * 60_000`. Components select from it instead of issuing their own `.from('wells')`.
2. Use `select`/derived data for per-component shapes, not new queries.
3. Invalidate these keys only from the matching realtime table event or after a config mutation.
4. Audit: `grep -rn "from('wells')\|from('locators')\|from('ro_trains')\|from('product_meters')"` and convert call sites one table at a time.

Target: **≤ 40 requests on a cold Operations/Dashboard load, ~0 on revisit within the staleTime** (today ≈ 170 per burst). From the sample burst, the four repeated catalogs alone are ≈ 30% of calls.

### Phase 2 — Persist reference data across reloads

Many sessions reload or reopen the PWA several times a day; each reload re-pays the full cold-load cost.

1. Add the react-query async persister backed by IndexedDB (see `docs/PWA-INDEXEDDB-PLAN.md`).
2. Persist **only reference-data keys** via `shouldDehydrateQuery`; never persist readings.
3. `maxAge` 24 h, `buster` = app version so a deploy invalidates it.

### Phase 3 — Reduce preflight rows (investigate before building)

1. In DevTools → Network, open an `OPTIONS` response from `*.supabase.co` and check `Access-Control-Max-Age`. If absent or tiny, the browser re-preflights nearly every distinct URL.
2. Make reading-table queries use **stable URLs**: bucket date filters to start-of-day PHT instead of `now() - interval`, so repeated queries reuse a cached preflight.
3. Fewer, larger calls beat many small ones: where a screen fires 5+ reading queries, replace with one RPC (follow the existing `get_dashboard_aggregates` pattern).
4. Same-origin proxy via Vercel rewrites would remove preflights entirely for the Vercel deploy, but Vercel rewrites do not proxy WebSockets and supabase-js derives the Realtime URL from the same base URL. Not recommended unless Realtime can be pointed elsewhere. GitHub Pages cannot proxy at all.

### Phase 4 — Trim steady-state background traffic

1. `touch_user_presence`: 578 POSTs/day for ~5 sessions. Raise the heartbeat from 5 to 10 minutes and skip it when the user has not interacted since the last stamp.
2. `usePageViewTracking` flushes every 30 s: confirm `flushPageViews()` returns without a request when its buffer is empty.
3. `ShiftHandoverModal` runs a 30 s timer: confirm `checkShift` does no network call.
4. `usePresence` 10-minute `['staff']` invalidation: keep, it only fires for visible tabs.

### Phase 5 — Guardrails and a kill switch

1. **Daily check, not weekly:** extend `scripts/check-log-quota.mjs` / `.github/workflows/log-quota-guard.yml` to run daily and fail when the 24 h row count exceeds 14,000 or any single path exceeds 1,500 requests/day.
2. **Low-quota mode:** a `VITE_LOW_QUOTA_MODE=1` build flag that turns off background sync, presence heartbeats, page-view telemetry and non-visible-tab realtime invalidation. Flip it only if pacing (below) goes red.
3. Keep Log Explorer queries to 1-hour windows (recipe in §6).

---

## 4. Pacing checkpoints (linear budget over 30 days)

| Day (date) | Log Ingestion ≤ | Egress ≤ | Action if over |
|---|---|---|---|
| 3 (Mon Oct 5, evening) | 0.10 GB | 0.50 GB | First weekday sample. Re-measure; start Phase 1 if not done. |
| 7 (Fri Oct 9) | 0.23 GB | 1.17 GB | Ship Phase 0–2. |
| 14 (Fri Oct 16) | 0.47 GB | 2.33 GB | Ship Phase 3–4; enable low-quota mode if still red. |
| 21 (Fri Oct 23) | 0.70 GB | 3.50 GB | Low-quota mode on. |
| 30 | 1.00 GB | 5.00 GB | n/a |

Hard stop-lines: Log Ingestion > 0.40 GB before day 10, or Egress > 2.5 GB before day 14 means turn on low-quota mode immediately.

Day-1 is already at 0.102 GB, so even a perfect fix leaves ≈ 0.07 GB of headroom against the linear line. The first few days run "in debt"; the plan only works if Phase 1 lands within the first week.

---

## 5. Expected impact (estimates, to be confirmed by measurement)

| Phase | Effect |
|---|---|
| 0 | −430 failed requests/day (≈ 1%) |
| 1 | ≈ −30% requests per cold load from catalogs alone, more once other duplicate queries are found |
| 2 | Removes repeat cold loads on reload/reopen |
| 3–4 | Fewer preflight and heartbeat rows (smaller, but steady) |
| Combined | Aim for 2–3× fewer log rows. If it lands short of 3×, low-quota mode is the fallback. |

Egress should stay inside budget if weekday traffic is under ~3× Saturday's; Phase 1–2 reduce it further as a side effect.

---

## 6. Verification recipes (all 1-hour windows to protect Log Query)

```sql
-- Rows per source (use a recent 1h window)
select source, count(*) n from logs group by source order by n desc;

-- Top request paths
select log_attributes['request.method'] m, log_attributes['request.path'] path, count(*) n
from logs where source='edge_logs'
group by m, path order by n desc limit 25;

-- Burst detection per client per minute
select toStartOfInterval(timestamp, interval 1 minute) minute,
       log_attributes['request.headers.cf_connecting_ip'] ip, count(*) n
from logs where source='edge_logs' and log_attributes['request.method']!='OPTIONS'
group by minute, ip order by n desc limit 20;

-- Error noise
select substring(event_message,1,110) msg, count(*) n
from logs where source in ('postgres_logs','postgrest_logs')
group by msg order by n desc limit 12;
```

Success criteria after Phase 1–2: a cold Operations load shows ≤ 40 non-OPTIONS requests in its one-minute burst, and `Warp server error` rows fall well below 1,000/day.

---

## 7. Decisions needed

1. Multiplier feature: **apply the four pending migrations, or revert the frontend queries?**
2. Confirm the billing reset date (plan assumes Oct 3 → Nov 2).
3. OK to add the `VITE_LOW_QUOTA_MODE` flag and a daily guard workflow?
4. Is production being used for development/testing today? If yes, move that to staging first, since it is the cheapest cut available.

*Nothing in the live database or repo was changed to produce this plan. Measurements were read-only queries against the project's logs and catalog.*

---

## 8. Implementation status (updated 2026-10-04)

| Item | Status | Where |
|---|---|---|
| P0.1 drop `remarks` from product latest select | Done (5f455c87) | `useProductSectionData.ts` |
| P0.2 drop `role` from `user_profiles` select | Done (5f455c87) | `ShiftHandoverModal.tsx` |
| P0.3 multiplier columns missing live | Mitigated: fallbacks existed (5f455c87) but re-sent the failing request every visit; now remembered for 30 min per tab | `lib/schemaCapabilities.ts`, `MeterMultiplierSection.tsx`, `usePlantPowerConfig.ts`. **Still pending decision: apply the migrations, which removes the fallbacks' reason to exist.** |
| P1 shared catalogs | Partly done: `staleTime` 30 min (5f455c87); now one canonical cache entry per catalog and 8 duplicate call sites read through it | `lib/referenceData.ts`, `useWells/useLocators/useROTrains` (exported fetchers), `useQualityStats`, `useTrainHourlyGaps`, `useReadingGaps`, `OperationsPage`, `ShiftRoundProgress`, `ReadingCoverageCard`, `usePretreatmentData` |
| P2 IndexedDB persistence | Already present (`lib/queryPersister.ts`, reference-only allowlist) | n/a |
| P3 preflight / stable URLs | Not done (needs DevTools check of `Access-Control-Max-Age` first) | n/a |
| P4 presence heartbeat 10 min + idle skip | Done (5f455c87) | `usePresence.tsx` |
| P5 daily guard + `VITE_LOW_QUOTA_MODE` | Done (5f455c87): daily workflow, flag covers background sync, presence, telemetry | `log-quota-guard.yml` |

Remaining catalog call sites not yet converted (each selects different columns or embeds, so they need individual review): `useTrendEntityMeta` (multiplier maps), `useDataSummaryQueries`, `DataCompletenessRadarCard` (count HEADs), `useProductionStats`, `MeterConfig`, `AssignLocatorsDialog`, `useTrainAutoOffline` (status-sensitive, deliberately left on its own query).

### 8.1 Follow-up: outage and stale-tab fixes (2026-10-04)

Live logs for 06:00–06:54 PHT on 2026-10-04 showed two things the plan did not cover:

1. **Database restart storm.** 675 HTTP 503s between 06:25 and 06:35 PHT (plus 521/522/525), 850 PGRST002 errors, and single browsers at 340–410 requests/minute (about double the previous worst burst) because every failed query was retried immediately and realtime/background refetches stacked on top.
2. **Stale tabs.** Four GitHub Pages sessions were still sending pre-fix request shapes (`ro_trains?select=*,plants!inner(*)`, the old hourly-gaps and reading-gaps selects) at 07:05 PHT, with zero requests in the new shape. `registerType: "autoUpdate"` plus no registration call means an open tab keeps its bundle until closed.

| Phase | Change | Where |
|---|---|---|
| P6 | Retry only real outages (max 2, exponential backoff with jitter); never retry wrong queries (400/42703/403/404); one shared "server unavailable" toast instead of one per query | `lib/apiHealth.ts`, `lib/queryClient.ts` |
| P6 | Client circuit breaker: after 8 failures in 20 s, REST reads are answered locally with a synthetic 503 (no network, no log row) for 30 s, doubling per failed probe up to 5 min; single-flight probe to close it; writes, auth, storage and realtime are never blocked | `lib/supabaseFetch.ts`, `integrations/supabase/client.ts` (`global.fetch`) |
| P6 | Background sync sweep skipped while the breaker is open | `hooks/useBackgroundSync.ts` |
| P7 | `registerType: "prompt"`; update applied automatically only when the tab has had no input for 10 min and nothing is mid-save, otherwise a persistent "Update now" toast; version re-check every 30 min while visible and on return to foreground | `lib/pwaUpdate.ts`, `main.tsx`, `vite.config.ts` |

Caveats: `integrations/supabase/client.ts` is marked auto-generated, so regeneration would drop the `global.fetch` option and silently disable the breaker (retry policy and PWA updates would still work). Realtime channels are not gated by the breaker; they reconnect on their own backoff.

Verify after deploy: (a) after an operator reopens the app, the `plants%21inner` request shape disappears for that client; (b) during any future 503 window, requests per client per minute stay far below the 340–410 seen on 2026-10-04.
