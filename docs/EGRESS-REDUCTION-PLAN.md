# Egress Reduction Plan

Status as of 2026-09-24. Target: cut PostgREST egress 50%+ from the
~2.7 GB/period baseline, and — more importantly — stop it from creeping
back up every few weeks the way it has four times already.

## Why this keeps coming back

Four separate commits already claim an egress fix:

| Date  | Commit    | Claim |
|-------|-----------|-------|
| 09-03 | `a3833a29` | egress-staletime-fix |
| 09-04 | `39a2c0c7` | egress reduction |
| 09-11 | `8a077518` | reduce daily egress by gating fallback queries and relaxing polling intervals |
| 09-18 | `57bb7565` | restore `get_dashboard_aggregates` RPC migration and throttle rapid badge polling |

And it kept climbing anyway. The 09-18 one turned out to be the clearest
example of why: **the migration it added was never applied to the live
database.** `get_dashboard_aggregates` didn't exist in Postgres at all —
confirmed via `pg_proc` — so `useProductionStats.ts`'s RPC call had been
failing with "function does not exist" on every single call since the
commit landed, silently falling back to the 13 raw per-table queries the
RPC was supposed to replace. Nobody noticed because the fallback is
graceful by design. When I applied the migration by hand it turned out to
have a second bug too: the function was marked `STABLE` but its body does
`CREATE TEMP TABLE ... AS SELECT`, which Postgres flatly refuses inside a
`STABLE` function — so even a correctly-applied version would have errored
on its first real call.

That's the actual pattern, not bad luck:

1. **Fixes get committed but not applied.** This repo already has a
   documented history of live/repo drift for schema changes
   (`docs/MIGRATION-SQUASH.md`); this is the same failure mode landing on
   an egress fix instead of a security fix.
2. **Graceful fallbacks hide breakage.** Every "server aggregate, else
   fall back to client computation" pattern in this codebase swallows the
   RPC error and quietly reverts to the expensive path. That's the right
   thing to do for *availability* — a broken RPC shouldn't take down the
   Dashboard — but it means a broken RPC produces no error anyone sees,
   just a slow egress climb weeks later.
3. **Fixes have targeted individual query intervals, not the shape of the
   problem.** `grep refetchInterval` today returns 60+ hits, most with a
   `// FIX (egress): staleTime matched to refetchInterval` comment from a
   past pass. Tuning one hook's interval doesn't help when the next
   feature adds three more hooks with their own fresh 60s timers on the
   same tables.
4. **No one confirms a fix actually reduced traffic.** There's no
   before/after check anywhere in this history — every fix commit message
   is a claim, not a measurement.

This plan is built around real request-log data (via Supabase's
`query_logs`, which is fast to pull and doesn't require deploying
anything to check), specifically to avoid repeating pattern #4.

## Current numbers

24h REST request volume, most recent pull (2026-09-24, post the two most
recent partial fixes below already landed):

| Path | Requests/24h |
|---|---|
| `GET /rest/v1/well_readings` | 8,474 |
| `GET /rest/v1/ro_train_readings` | 6,350 |
| `GET /rest/v1/power_readings` | 5,338 |
| `POST /rpc/get_alert_statuses` | 3,883 |
| `GET /rest/v1/ro_trains` | 3,812 |
| `GET /rest/v1/locator_readings` | 2,720 |
| `GET /rest/v1/ro_pretreatment_readings` | 2,604 |
| `GET /rest/v1/wells` | 2,101 |
| `GET /rest/v1/user_profiles` | 2,016 |
| `POST /rpc/latest_power_readings_before` | 1,933 |
| `GET /rest/v1/train_status_log` | 1,840 |
| `GET /rest/v1/compliance_thresholds` | 1,733 |
| `POST /rpc/touch_user_presence` | 1,679 |
| `GET /rest/v1/blending_events` | 1,528 |
| `GET /rest/v1/ro_train_uptime_reports` | 1,511 |
| `GET /rest/v1/product_meter_readings` | 1,315 |
| `GET /rest/v1/locators` | 1,276 |
| `GET /rest/v1/downtime_events` | 1,196 |
| `GET /rest/v1/compliance_snapshots` | 1,186 |
| `GET /rest/v1/plant_meter_config` | 986 |

Top 20 alone: ~53,000 requests/day, before OPTIONS preflights (roughly
matching volume again) and the long tail. From **13–14 concurrent users**.
That's not usage — that's background polling, continuously, all day.

Two already-fixed items are visible in this table by their *absence*:
`product_meters` and (mostly) `plant_meter_config` dropped off the top-20
entirely once `get_dashboard_aggregates` started actually working
(`f73fafae`), and Kevz's own `3efef50b`/`5e205fa7` RO-trains consolidation
took `ro_train_readings` from 8,232 → 6,350. Both prove the pattern below
works when it's actually applied — the rest of this plan is applying it
everywhere it isn't yet.

## The fix, in one sentence

**Replace "poll a raw table on a timer" with either (a) one server-side
aggregate RPC per view, or (b) realtime-driven invalidation** — this
codebase has working, tested examples of both patterns already
(`get_dashboard_aggregates`, `useTrainDataRealtime.ts`). Almost nothing
below is a new idea; it's applying the two patterns that already exist to
the places that still don't use them.

---

## Phase 1 — Confirm what's already live (do this first, costs nothing)

Given the history above, the first step on *every* phase below is: after
applying a migration, actually query `pg_proc` / call the RPC / check
`has_function_privilege` before moving on. Don't trust the migration
file — trust the database.

- [x] `get_dashboard_aggregates` applied, `STABLE` bug fixed, verified
      against real data (this session).
- [x] `useProductionStats.ts` fallback-query gating fixed
      (`wellIds`/`todayWells`/`plantMeterConfigs` were missing the
      `needsClientFallback` gate every sibling query had) (`f73fafae`).
- [x] RO-trains data-fetching consolidation (`3efef50b`, `5e205fa7`) —
      confirm this is fully landed, not partial: `ro_train_readings` is
      still the #2 offender at 6,350/day.
- [ ] Re-pull the top-20 table above after each phase closes. A phase
      isn't "done" until the number for its target table actually drops.

## Phase 2 — `well_readings` (the #1 offender, 8,474/day)

There are **~30 call sites** for raw `well_readings` in the frontend —
too many to review as a single query change. Split by purpose:

- **Writes** (`WellRow`, `WellDetail`, `data/mutations/wells.ts`,
  correction flows): these are legitimate, low-frequency, user-initiated.
  Not the problem.
- **Polling reads on a `refetchInterval`**: `ReadingCoverageCard.tsx`,
  `useTrendChartQueries.ts`, `WaterBalanceBridgeCard/
  useWaterBalancePeriodTotals.ts`, `EntityHistoryChart*` — these are the
  target. Each independently re-fetches overlapping date ranges of the
  same table on its own 60s–5min timer.

Two complementary fixes:

1. **Extend the realtime pattern.** `useTrainDataRealtime.ts` already
   proves the shape: subscribe once (app-shell-mounted), invalidate query
   keys on `postgres_changes` INSERT, let each consumer's own
   `staleTime` decide whether to actually refetch. Well readings are
   entered by operators a handful of times a day per well — they are
   *not* high-frequency telemetry, which makes them a much better fit for
   "notify on change" than "poll every 60 seconds" regardless of whether
   anything changed. Do the same for `well_readings`, `power_readings`,
   and `locator_readings` in one pass (they're the #1, #3, and #6
   offenders, and share the same shape).
2. **Where realtime isn't practical** (a chart needs a specific
   aggregated range, not just "something changed"), fold the query into a
   `get_dashboard_aggregates`-style RPC that computes the range
   server-side instead of shipping every row over the wire for the client
   to sum. `ReadingCoverageCard` and `useWaterBalancePeriodTotals` are
   good first candidates — they're already summarizing, not displaying,
   raw rows.

## Phase 3 — Consolidate the rest of the Dashboard hooks

`useProductionStats.ts` was the worst offender (11 separate
`refetchInterval` queries) and is now fixed. The siblings are lighter but
still each running their own uncoordinated per-table polling with no
aggregate RPC at all:

| File | Tables polled | Timed queries |
|---|---|---|
| `useQualityStats.ts` | `pump_readings`, `ro_pretreatment_readings`, `ro_train_readings`, `ro_trains`, `wells` | 3 |
| `usePowerStats.ts` | `plant_power_config`, `power_readings` | 2 |
| `useCostStats.ts` | `chemical_dosing_logs`, `chemical_prices`, `power_tariffs`, `production_costs` | 1 |
| `useDashboardAlerts.ts` (+ `useTrainAutoOffline` inside it) | `blending_events`, `chemical_inventory`, `compliance_snapshots`, `compliance_thresholds`, `downtime_events`, `ro_train_readings`, `ro_pretreatment_readings`, `ro_trains`, `ro_train_uptime_reports` | 4 |

`downtime_events` (1,196/day) and `compliance_snapshots` (1,186/day) are
new entrants in the top-20 that weren't there before — nobody has touched
`useDashboardAlerts.ts`'s own polling yet, it's just relatively more
visible now that the bigger offenders shrank.

Extend `get_dashboard_aggregates` (or add 2–3 sibling RPCs — quality,
power+cost, and alerts-relevant aggregates don't all need to be one
function) to cover these four files the same way it now covers
`useProductionStats.ts`. Given the Phase 1 lesson, apply and **verify
each one individually** rather than batching all four into one migration
and hoping.

## Phase 4 — App-wide polls that don't need to be app-wide

- **`get_alert_statuses`** (3,883/day) — called from exactly one hook,
  `useAlertEvents.ts`, on a flat 60s `refetchInterval` with no `enabled`
  gate visible in that file. If this hook is mounted at the app-shell
  level (bell icon, badge), every signed-in user is polling alert status
  every 60 seconds on every page, including pages that have nothing to do
  with alerts. Alert status is event-driven by nature (a reading crosses
  a threshold, an operator resolves a flag) — this is a strong realtime
  candidate, same as Phase 2.
- **`touch_user_presence`** (1,679/day) — `usePresence.tsx` already
  pauses on `visibilityState === 'hidden'`, which is good. The 120s
  heartbeat plus a *separate* 180s `invalidateQueries(['staff'])` "safety
  net" timer are two independent intervals doing related things; worth
  checking whether the safety net is still needed now that presence has
  its own heartbeat, or whether it can be folded into the same timer.
- **`useBackgroundSync`'s global 5-minute sweep** — already has solid
  guards (hidden-tab skip, 15-min idle pause, `stale: true` only). The
  remaining risk is architectural, not a bug: it refetches *all* active
  stale queries as one batch every 5 minutes, which can land in the same
  few seconds as several hooks' own independent 5-minute
  `refetchInterval`s, producing a burst rather than smoothing load. Once
  Phases 2–3 land, re-check whether this sweep is still pulling its
  weight or whether it's now mostly redundant with tighter per-query
  staleness.

## Phase 5 — Payload size, not just request count

Lower priority than 2–4 (request count is the dominant driver right now),
but worth a pass once the big offenders are down:

- `user_profiles` and a few other tables are fetched with `select=*`
  where only a handful of columns are actually used. Trimming to named
  columns is low-risk, file-by-file, and directly cuts bytes-per-request
  on tables that can't be eliminated outright (auth-adjacent lookups).
- Several `refetchInterval`'d queries fetch a full historical window
  (e.g., 30 days) on *every* poll instead of fetching once with a long
  `staleTime` for the closed/historical part and only polling the
  still-open "today" slice frequently. `EntityHistoryChart` and
  `TrendChart` are worth checking specifically for this shape.

## Phase 6 — Don't let this regress a fifth time

- After each phase, re-pull the top-20 table (see verification recipe
  below) and paste the before/after numbers into this doc or the closing
  commit message. A phase that isn't measured isn't done — see "Why this
  keeps coming back" above.
- For any future migration that a hook depends on for its "fast path,"
  confirm live application the same way Phase 1 does — via `pg_proc` /
  `has_function_privilege`, not by reading the migration file and
  assuming.
- Consider a scheduled (weekly, cheap) `query_logs` pull that flags any
  `/rest/v1/<table>` path crossing a request-count threshold, so a new
  feature's unthrottled polling shows up in days, not after a full
  billing period.

---

## Expected impact

Rough, ordered by confidence:

- **Phase 1 (already landed)**: `product_meters` off the top-20 entirely,
  `plant_meter_config` −48%, `ro_train_readings` −23%. Real, measured,
  already in the numbers above.
- **Phase 2** (`well_readings`/`power_readings`/`locator_readings` →
  realtime): these three are ~16,500 of the ~53,000 top-20 requests/day —
  the single biggest remaining lever. Converting polling to
  change-driven invalidation for data that only changes a handful of
  times a day should cut this block by the large majority, not just
  trim it.
- **Phase 3** (remaining Dashboard hooks): smaller individually, but four
  files' worth of currently-uncoordinated polling, cumulatively a similar
  shape to what Phase 1 already fixed once.
- **Phase 4** (`get_alert_statuses`/presence): ~5,500/day between the two,
  concentrated in one hook each — cheap to fix once scoped.

Phases 2–4 alone target more than half of the current top-20 volume.
Combined with Phase 1's already-measured wins, 50%+ off the current
billing period is a realistic, evidence-based target rather than a hopeful
one — provided each phase is verified against real traffic before being
marked done, which is the one step every prior attempt skipped.

## Verification recipe

Pull current top offenders (Supabase MCP `query_logs`, capped at 24h per
call):

```sql
select
  log_attributes['request.method'] as method,
  log_attributes['request.path'] as path,
  count(*) as requests
from logs
where source = 'edge_logs'
  and log_attributes['request.path'] like '/rest/v1/%'
  and log_attributes['request.method'] != 'OPTIONS'
group by method, path
order by requests desc
limit 20;
```

Confirm a migration actually applied (don't trust the file):

```sql
select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.proacl
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = '<function_name>';
```

Then actually call the RPC with realistic arguments and check the result
is sane — not just that it returns 200.
