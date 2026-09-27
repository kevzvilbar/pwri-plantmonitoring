# PWA + IndexedDB Plan

Status as of 2026-09-27. Companion to `EGRESS-REDUCTION-PLAN.md` and
`LOG-QUOTA-REMEDIATION-PLAN.md`, which this plan deliberately does not
duplicate — see "What's already built" below.

## Scope — three goals, three different mechanisms

The trigger for this doc bundled three things together. They don't move
together, and treating them as one initiative is how a plan like this
quietly ends up "done" on paper while only one of the three actually
shipped:

| Goal | Mechanism | Does IndexedDB move it? |
|---|---|---|
| Egress / Log Ingestion (REST request count + bytes) | Persisted TanStack Query cache | **Yes** — the real, meaningful lever (Phase 1) |
| Log Query (Logs Explorer scan volume) | Narrow time windows on `query_logs` pulls | **No** — this is Supabase-side observability usage, driven by how *we* query the logs, not by client traffic. Already owned by `LOG-QUOTA-REMEDIATION-PLAN.md`. Nothing in this plan touches that number — don't expect it to move. |
| Offline field use (writes surviving a dropped connection) | IndexedDB-backed mutation outbox, scoped to specific write paths | **Yes, but only for the paths audited safe** — Phase 3 |

## What's already built (don't duplicate this)

- **`vite-plugin-pwa` / Workbox** is already configured (`vite.config.ts`):
  app shell (JS/CSS/HTML/icons) precaches, `registerType: "autoUpdate"`,
  and — deliberately — **no** `runtimeCaching` for the Supabase API. The
  existing comment is explicit: reads/writes stay network-only "so this
  makes the *shell* installable and loadable with zero connectivity; it
  deliberately does not paper over stale or unavailable data." The
  installable/offline-shell half of "PWA" is done. This plan is about the
  data layer on top of it, not about replacing this.
- **`QueryClient`** (`App.tsx`) is 100% in-memory: `staleTime: 300_000`,
  `gcTime: 900_000`, nothing persisted anywhere. Every reload or PWA
  reopen starts from zero and re-fetches every active query.
- **`OfflineBanner.tsx`** currently tells the operator *"New readings and
  modifications will be queued locally until connection is restored"* —
  but its own code comment says this isn't built: *"Deliberately not a
  queue-and-retry mechanism... see the mobile UX audit for why the
  write-side half... is a separate, materially larger piece of work than
  this component."* (That referenced audit doesn't exist anywhere in the
  repo — dangling reference.) Right now this banner is a promise with
  nothing behind it. Phase 0 fixes that immediately; Phase 3 is what
  eventually makes the copy true.
- **`useBackgroundSync` / `SyncIndicator` / `syncStore`** is a *read*
  loop — silently refetches stale active queries every 15 minutes and
  reports status. Despite the name, it is not a sync/queue mechanism and
  this plan doesn't change it, beyond wiring `SyncIndicator` to also show
  outbox state in Phase 3.
- **`useDraft`** (`hooks/useDraft.ts`) already persists *unsaved* form
  input to `localStorage` per form key, restored on mount, cleared on
  successful save. This plan's outbox is the natural next stage of the
  same idea, not a competing mechanism: `useDraft` protects what an
  operator typed *before* they hit Save; the outbox (Phase 3) protects
  what they saved *after* Save but before the network confirmed it.
- **`useOnlineStatus`** already gives a connectivity signal
  (`navigator.onLine` + `online`/`offline` events) — this is what Phase 3
  hooks into rather than inventing a new one.

## The complication Phase 3 has to design around: two parallel write layers

There's a "Roadmap Phase 3" data-access layer already in the codebase —
`data/mutations/*.ts` (`readings.ts`, `staff.ts`, `auth.ts`,
`compliance.ts`, `readingHistory.ts`, `corrections.ts`,
`plantTopology.ts`), each carrying a comment like *"pure mutation
functions... Components wrap them with React Query via the hooks in
`src/data/hooks/`."* It's a clean, testable target.

**It's not where the field-critical writes actually happen.** Verified by
reading the real save paths:

- `features/wells/components/WellRow/useWellRowActions.ts` — the actual
  well-reading save handler — calls `supabase.from('well_readings')
  .insert(payload)` **directly**, inline, in a 533-line hook. It does
  *not* call `insertWellReading()` from `data/mutations/readings.ts`.
  That function is only reachable via `useInsertWellReading()` in
  `features/wells/hooks/useWellReadings.ts`, which appears to be
  scaffolding from the same roadmap effort, not the operator-facing save
  path.
- `features/operations/components/locators/LocatorRow/useLocatorReading.ts`
  — same pattern: `supabase.from('locator_readings').insert(...)` inline.
- `features/ro-trains/pretreatment/hooks/usePretreatmentActions.ts` —
  same pattern: `opts.supabase.from('ro_pretreatment_readings').insert(...)`
  inline.
- `features/operations/components/power/hooks/usePowerFormState.ts` —
  same pattern for `plant_power_config` / `plant_meter_config`.

So: **an outbox built by wrapping `data/mutations/*.ts` would miss the
actual field write paths.** Phase 3 has to intercept the real call sites
inside these UI-action hooks, not the roadmap layer. This also means each
of these hooks carries its own inline, state-dependent guard logic —
`useWellRowActions.ts` checks `atLimit` (today's reading count against
`WELL_MAX_READINGS_PER_DAY`) and runs `evaluateReadingGuard` (spike
detection against `previousMeter`) at submit time, computed from data
fetched when the form loaded. That's the crux of the Phase 2/3 risk this
plan was asked to scope carefully.

## Phase 0 — Stop promising something that doesn't exist (do this first, ~1 hour)

- [ ] Either soften `OfflineBanner.tsx`'s copy to something true today
      (e.g. "You're offline. New entries will not be saved until
      connection is restored.") or gate the current "queued locally"
      copy behind a flag that only flips on once Phase 3 ships. Shipping
      a false safety promise to field operators is worse than shipping
      no promise.
- [ ] Pull a baseline cold-load request count (see Verification recipe)
      before Phase 1 starts, so its win is measured, not claimed — the
      same discipline `EGRESS-REDUCTION-PLAN.md` had to learn the hard
      way after four unmeasured "fixes."

## Phase 1 — Persist the read cache to IndexedDB (the egress win)

**Goal:** a cold load (reopening the PWA, a new tab, a phone that killed
the background tab) hydrates reference/config data from IndexedDB instead
of re-fetching it, and makes zero network calls if the persisted entry is
still within its `staleTime`.

**Why this specifically, and not Workbox `runtimeCaching`:** PostgREST
responses vary by query string (`select=`, `range=`, embedded resource
joins), which generic HTTP caching handles poorly and would need custom
matching logic to do safely. TanStack Query's persister caches by the
query key you already designed, so it sidesteps that — one caching layer
at the data level, not a second one at the HTTP level competing with the
first.

**Libraries** (checked against the registry 2026-09-27; your
`@tanstack/react-query` is `^5.83.0`, same major as all of these):

| Package | Version | Why |
|---|---|---|
| `@tanstack/query-persist-client-core` | ^5.104 | Core persist/restore logic |
| `@tanstack/query-async-storage-persister` | ^5.104 | **Async** variant — not `query-sync-storage-persister` (that one's for `localStorage`/`sessionStorage` and reads/writes synchronously, which you don't want blocking the main thread against an IndexedDB-scale dataset on a phone) |
| `@tanstack/react-query-persist-client` | ^5.104 | `PersistQueryClientProvider` — swaps in for your existing `QueryClientProvider` in `App.tsx` |
| `idb-keyval` | ^6.3 | Minimal promise-based `get`/`set`/`del` — matches the `AsyncStorage` interface the persister expects. No need for a heavier ORM like Dexie for this phase; revisit only if Phase 3+ wants a real local read model for browsing historical data offline. |

**Persist selectively — reference/config data only, never hot telemetry.**
Looking at your own top-20 table in `EGRESS-REDUCTION-PLAN.md`, several
entries are reference/config data that rarely changes and isn't in
`APP_REALTIME_TABLES`, so it gets *zero* benefit from the realtime work
already done — it's purely refetch-on-mount today:

| Table | Requests/24h |
|---|---|
| `ro_trains` | 3,812 |
| `wells` | 2,101 |
| `user_profiles` | 2,016 |
| `compliance_thresholds` | 1,733 |
| `locators` | 1,276 |
| `plant_meter_config` | 986 |

That's ~12k/day — about a third of the top-20 total — on tables that
change a handful of times per shift at most.

Allowlist (actual query-key prefixes found in the codebase — build the
`shouldDehydrateQuery` filter from this list, don't guess new ones):

- `['wells', ...]`
- `['locators', ...]`
- `['ro-trains', ...]` and `['trains', ...]`
- `['plant-meter-config', ...]` and `['plant-meter-config-permeate', ...]`
- `['dash-compliance-thresholds', ...]`
- the `get_dashboard_aggregates`-backed dashboard-stat query keys

**Explicitly excluded — must stay network-only / always-stale-until-fetched:**
`well_readings`, `locator_readings`, `ro_train_readings`, `power_readings`,
`product_meter_readings`, and the alert/downtime/blending event queries —
everything `APP_REALTIME_TABLES` already covers. These already get
realtime invalidation; persisting them risks an operator reopening the
app after a few hours and mistaking a plausible-looking cached number for
a current one. That's a correctness/safety regression this plan should
not introduce for a request-count win.

**Known gap this phase does *not* close:** `user_profiles` (2,016
req/day) is fetched directly inside `useAuth.tsx`'s `loadProfileAndRoles`,
triggered by `supabase.auth.onAuthStateChange` — **outside React Query
entirely**, not behind a `useQuery` hook. The persister can't touch a
fetch that was never in the query cache. Closing this needs a separate,
smaller fix:
- (a) move this fetch into a real `useQuery` hook so it's covered by the
  persister (bigger refactor, touches auth-critical code — do carefully,
  not as part of this phase), or
- (b) add a short-TTL guard directly in `AuthProvider` (skip the refetch
  if the same `uid` loaded within, say, the last 5 minutes) — **recommended
  for this phase**, with (a) as later cleanup once the pattern is proven
  elsewhere.

**Checklist:**
- [ ] Add the four packages above.
- [ ] Build the `asyncStoragePersister` on `idb-keyval`, wrap `App.tsx`'s
      provider with `PersistQueryClientProvider`, set `persistOptions:
      { maxAge, buster, dehydrateOptions: { shouldDehydrateQuery } }` —
      `buster` tied to a build id (e.g. the git SHA already available to
      the Sentry release config) so a deploy that changes a cached
      shape invalidates old persisted data instead of hydrating into it.
- [ ] Add the short-TTL guard to `loadProfileAndRoles` in `useAuth.tsx`.
- [ ] Re-pull the top-20 table after a week (see Verification recipe).
      Expect `wells` / `locators` / `ro-trains` / `plant-meter-config` /
      `dash-compliance-thresholds` to drop; expect `well_readings` /
      `ro_train_readings` / etc. to be **unchanged** — this phase
      deliberately doesn't touch them, and a drop there would actually
      mean something's wrong (e.g. a query put on the allowlist that
      shouldn't be).

## Phase 2 — Mutation / write-path audit

No code in this phase — classification only, so Phase 3 knows exactly
what it's allowed to queue automatically versus what needs a human in
the loop. This table is a best-effort pass based on reading each file;
treat the "needs full audit" rows as exactly that, not as cleared.

### In scope for the offline outbox (Phase 3) — field write paths

| Call site | What it does | Auto-replay safe? | Why |
|---|---|---|---|
| `useWellRowActions.ts` — reading save | Inline insert/update on `well_readings`, gated by `atLimit` (today's count vs. `WELL_MAX_READINGS_PER_DAY`) and `evaluateReadingGuard` (spike detection vs. `previousMeter`) | **No — needs review** | Both guards are computed from data fetched when the form loaded (`todayReadings`, `previousMeter`). If replayed hours later against a stale snapshot, a spike guard could wrongly pass (missing a real anomaly) or the daily cap could be silently exceeded/blocked incorrectly. The outbox must re-run the guard against freshly-fetched state at replay time, not trust the value captured offline. |
| Same file — TDS / NTU / pressure spot readings | Simple insert/update by `lastToday.id` | **Conditionally safe** | No spike/cap guard on these specifically, but still depends on `lastToday` being the correct row — re-resolve `lastToday` at replay rather than replaying a captured id. |
| `useLocatorReading.ts` — reading save | Same shape as WellRow | **No — needs review** | Same reasoning as above; confirm whether locators carry an equivalent daily-cap/spike guard before assuming otherwise. |
| `usePretreatmentActions.ts` — RO train pretreatment reading | Insert on `ro_pretreatment_readings`, writes to `train_status_log` alongside it | **No — needs review** | Multi-table write in one handler; needs its own read before deciding replay is safe to do as one atomic-feeling unit vs. two separate queued items. |
| `usePowerFormState.ts` — power reading / config save | Insert/update on `power_readings`, `plant_power_config`, `plant_meter_config` | **No — needs review** | Config tables here are closer to admin data than a spot reading; confirm whether the power reading path alone (not the config-edit path) is the one that needs offline support. |
| `shiftDuty.ts` — `recordShiftDuty` / `endShiftDuty` | Plain insert / update by id, no pre-check inside the function itself | **Likely safe**, pending one check | The *caller* likely checks `fetchActiveShiftDuty` first to decide which to call — confirm that decision doesn't need to be re-made against fresh state before queuing the write. If the caller's branch logic is simple (declare vs. end, chosen by a button the operator taps), this is a good first candidate for auto-replay. |
| `readings.ts` — `insertWellReading` | Simple insert, no dedup logic in the function | **Safe in isolation** | But per the write-path finding above, this function is *not* the one the real WellRow save flow calls — confirm whether anything actually depends on it before building the outbox around it. |

### Needs review, but lower priority — desk/admin actions, not field entry

| Call site | Why it's lower priority for Phase 3 | Notes |
|---|---|---|
| `meterMultiplier.ts` — `submitMeterMultiplierWorkflow` | Admin action (meter replacement), not routine field entry | Three sequential writes (audit event → entity update → read-check-then-insert/update reading) with **no rollback** if a later step fails after an earlier one succeeds — already a partial-failure risk *online*. Do not queue this for auto-replay without redesigning it as a single server-side transaction (an RPC, matching the pattern `fn_blending_upsert_reading` and `fn_approve_correction_request` already use elsewhere in this codebase) — replaying it piecemeal offline would make the existing partial-failure risk worse, not better. |
| `corrections.ts` — `approveCorrectionRequest` / `rejectCorrectionRequest` / `bulkApproveReadings` / `bulkRetractReadings` | Supervisor review workflow, typically done at a desk | The approve/reject RPCs are atomic server-side, which helps, but bulk-by-id-list updates can blindly overwrite a request someone else already resolved while you were offline. `createCorrectionRequest` and `insertReadingNormalization` (plain inserts, no pre-check) are fine to queue if this surface ever needs offline support. |

### Out of scope — keep online-only (Phase 4 makes this explicit)

`wells.ts` / `blending.ts` / `locators.ts` (`insertLocatorReadings`) /
`power.ts` (`insertPowerReadings`) / `imports.ts` (`batchImportRows`) —
all CSV bulk-import flows. Each does its own read-before-write dedup
(`resolveImportDuplicate`, an interactive prompt that can't run
unattended during a background replay), multi-row chunked inserts, and in
`blending.ts`'s case a `localStorage`-tracked running "previous reading"
whose staleness at replay time would silently produce wrong deltas. These
are desk-based, already require a stable connection to upload a file of
any size, and the value of making them offline-capable is low. `auth.ts`,
`staff.ts`, `compliance.ts`, `plantTopology.ts` are all similarly
desk/admin surfaces — leave them requiring connectivity.

## Phase 3 — Build the outbox for the audited-safe writes

- **Queue at the call site, not through `data/mutations/`.** Per the
  write-path finding above, wrap the actual `supabase.from(...)` calls
  inside `useWellRowActions.ts`, `useLocatorReading.ts`,
  `usePretreatmentActions.ts`, etc. — not a proxy in front of the
  lightly-used roadmap layer.
- **Queue intent + inputs, not a frozen payload.** For any write with a
  guard that depends on server state (WellRow's spike/cap check being the
  clearest example), replaying a payload captured offline against
  whatever the guard computed *then* defeats the guard. Replay should
  re-run the fetch-then-validate-then-write sequence, not just re-POST a
  stored object.
- **TanStack Query's built-in offline-mutation support is the right
  primitive here** rather than a bespoke queue: under the default
  `networkMode`, a mutation attempted while `onlineManager` reports
  offline is automatically paused rather than firing and failing; what's
  currently missing is (a) persisting that paused queue across a reload
  or closed tab — your mutations config today is just `{ retry: 0 }`, no
  persistence — and (b) calling `queryClient.resumePausedMutations()` on
  reconnect (wire this to the existing `useOnlineStatus` hook's `online`
  event). **Verify the exact current behavior against the installed
  `@tanstack/react-query` version's own docs before implementing** — this
  corner of the API has shifted across minor versions and this plan
  shouldn't be trusted over the live source, same principle
  `EGRESS-REDUCTION-PLAN.md` applies to migrations ("trust the database,
  not the file").
- **Conflict/guard-failure UX:** when a replay's re-run guard fails
  (spike detected against now-current data, daily cap now actually
  exceeded, a duplicate-window hit), don't silently drop or silently
  force it through — surface it to a review queue the operator or a
  supervisor resolves explicitly. The codebase already has UI vocabulary
  for exactly this shape of decision (`CorrectionReasonField`,
  `resolveReason`, the existing correction-request flow) — reuse it
  rather than inventing a second "explain yourself" pattern.
- [ ] Ship for `useWellRowActions.ts` reading save first (highest
      request volume per `EGRESS-REDUCTION-PLAN.md`, and the guard logic
      is already the best-understood of the group from this audit).
- [ ] Extend to TDS/NTU/pressure spot readings in the same file.
- [ ] Extend to `useLocatorReading.ts`, confirming its guard shape first.
- [ ] Extend to `usePretreatmentActions.ts` and `usePowerFormState.ts`
      once their multi-table write shape is understood (Phase 2's "needs
      review" items above).
- [ ] `shiftDuty.ts` declare/end, once the caller's pre-check logic is
      confirmed safe to skip on replay.
- [ ] Wire `OfflineBanner.tsx` to real outbox state — this is what
      finally makes its copy true instead of aspirational.
- [ ] Add a pending-count badge to `SyncIndicator` reading from the
      outbox, so "3 readings waiting to sync" is visible without opening
      dev tools.

## Phase 4 — Explicitly out of scope (write it down so it stays a decision, not a gap)

Restating Phase 2's "out of scope" table as an explicit decision: CSV
bulk imports, `staff.ts`, `compliance.ts`, `plantTopology.ts`,
`meterMultiplier.ts`, correction approve/reject, and all of `auth.ts`
stay online-only. If a future feature wants offline support for any of
these, it needs its own pass through the same audit shape as Phase 2 —
don't assume the Phase 3 outbox mechanism makes them automatically safe
to include.

## Phase 5 — Optional hardening: Background Sync API

Without this, the outbox only flushes while the app tab is open and an
`online` event fires — a phone that regains signal with the app fully
closed won't sync until it's reopened. The Background Sync API
(`registration.sync.register(...)` from within the service worker) lets
the browser attempt replay even with the tab closed.

Two things to weigh before taking this on:
- It requires switching `vite-plugin-pwa` from its current `generateSW`
  usage (the `workbox: { globPatterns, navigateFallback, importScripts }`
  shape in `vite.config.ts` today, which is how `sw-push.js` already gets
  merged in for Web Push) to `injectManifest` mode, or otherwise
  authoring a custom service worker with a `sync` event listener.
- **Background Sync is not supported in Safari/iOS.** If any field
  operators use iPhones, this phase would only help the Android/desktop
  portion of the fleet — worth checking device mix before prioritizing
  this over Phase 3's app-open-and-online path, and worth re-checking
  current browser support (e.g. caniuse.com/background-sync) since this
  changes over time.

Treat this as a later phase, not a blocker for Phase 3 shipping.

## Phase 6 — Verification, so this doesn't join the four unmeasured egress "fixes"

- [ ] Re-pull the top-20 request table a week after Phase 1 ships (see
      recipe below) and paste before/after numbers into this doc or the
      closing commit, the same discipline `EGRESS-REDUCTION-PLAN.md`
      calls for.
- [ ] Manual offline test per Phase-3 write path: DevTools → Network →
      Offline, submit, confirm it queues (not fails silently), go back
      online, confirm it lands, and confirm the audit trail / triggers
      that depend on write order (e.g. the chain-sync cascade
      `readings.ts`'s own comment describes) still produce correct
      results when the write arrives late rather than at the original
      timestamp.
- [ ] Confirm `resumePausedMutations()` behavior against the *installed*
      package version, not this doc, before relying on it in the field.
- [ ] Add a lint/review checklist item (or, matching the pattern of
      `scripts/check-log-quota.mjs` + its weekly Action, a small script)
      so a new field-entry hook that writes directly to Supabase gets
      routed through the Phase 3 outbox — or is deliberately added to
      Phase 4's out-of-scope list — rather than silently bypassing both.

## Verification recipe

Reuses `EGRESS-REDUCTION-PLAN.md`'s existing recipe — no new tooling
needed to check this plan's Phase 1 impact:

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

Per `LOG-QUOTA-REMEDIATION-PLAN.md`, keep this to a narrow window (1 hour)
when pulling it ad hoc from the Logs Explorer rather than the full 24h —
that guidance doesn't change just because this plan exists.

## Appendix: package versions checked (2026-09-27, against npm registry)

| Package | Latest at time of writing |
|---|---|
| `@tanstack/query-persist-client-core` | 5.104.0 |
| `@tanstack/query-async-storage-persister` | 5.104.0 |
| `@tanstack/query-sync-storage-persister` | 5.104.0 (not used — see Phase 1) |
| `@tanstack/react-query-persist-client` | 5.104.0 |
| `idb-keyval` | 6.3.0 |

All same-major as the installed `@tanstack/react-query@^5.83.0` — re-check
before installing if time has passed since this doc was written.
