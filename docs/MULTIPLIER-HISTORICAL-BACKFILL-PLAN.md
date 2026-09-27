# Multiplier Historical Backfill — Correction Plan

| | |
|---|---|
| Repo | `kevzvilbar/pwri-plantmonitoring` |
| Baseline | actual repo, current `main` (re-cloned live for this revision) |
| Trigger | Readings recorded before `20260926000001_meter_multiplier_feature.sql` (e.g. "UHRI (8)"'s Jan 1 – Sept 26, 2026 window) carry `multiplier_at_reading = 1` from that column's `DEFAULT`, not from any real multiplier logic — see `METER-REPLACE-MULTIPLIER-WIRING-PLAN.md` §Q&A |
| Scope | One-off data correction: retroactively set the correct `multiplier_at_reading`/`daily_volume` on pre-migration reading rows. Not a UI/feature change. |
| Target path | `docs/MULTIPLIER-HISTORICAL-BACKFILL-PLAN.md` (script bodies land in `supabase/runbooks/` and `supabase/migrations_archive/`, per this repo's own convention — see §1) |
| Status | **Decisions locked in §2 — ready for Phase 0 pilot** |

---

## 0. Governing principle (confirmed this revision)

> The raw dial reading must always be retained. Any entered multiplier is applied to that raw value — when a new multiplier is entered, the original reading is never rewritten; only the multiplier is updated, replacing the previous one.

This is not a new rule invented for this plan — it's how the codebase **already** handles multiplier changes on the power side, and it settles the one real open risk from the last revision (whether some historical readings might be hand-multiplied already). It doesn't apply here: **the water-side raw reading is retained the same way — always the actual dial/register value — and `multiplier_at_reading` is a separate, replaceable field layered on top.** So there is no double-apply risk: correcting `multiplier_at_reading` from `1` (the bug) to `10` (the truth) and recomputing `daily_volume = Δraw × multiplier` is exactly the right operation, on every affected row.

### Precedent: how the power-meter side already does this

`plant_power_config.grid_meter_multipliers` (an array, one slot per grid meter) is this system's other live "current multiplier" — and it already enforces the rule above:

- `frontend/src/features/plants/components/config/sections/PowerMeterChangeForm.tsx` — the "Change Power Meter" form. On submit, it **never touches a previously stored `grid_meter_readings` value.** It writes the new multiplier into `grid_meter_multipliers[meterIndex]` (`upsert` on `plant_power_config`), replacing whatever was there, and separately logs an audit row to `power_meter_changes` (`old_multiplier`, `new_multiplier`, `old_meter_final_reading`, `new_meter_initial_reading`, `notes`, `changed_by`). The raw meter reading for the *new* meter starts fresh at the entered initial value; nothing upstream of that boundary is rewritten.
- `frontend/src/data/mutations/power.ts` (`getPerMeterMult`, used inside `insertPowerReadings`) computes `daily_consumption_kwh = Σ Δraw × grid_meter_multipliers[meterIndex]` — always against the raw delta, using whatever multiplier is *currently* configured. The raw values themselves (`grid_meter_readings`, `meter_reading_kwh`) are the permanent record; the multiplier is the only thing that ever gets swapped out.

One real difference worth naming, so it doesn't get silently assumed: **the power side's multiplier is not time-boxed** — `getPerMeterMult` always reads the live config, so if the multiplier changes today, the *next* computed delta uses the new value regardless of which two calendar dates it spans. The water side is actually more capable here, because `multiplier_at_reading` is stored **per reading row**, not as one live per-entity value — which is exactly why a per-row backfill is possible (and necessary) for water, where it wouldn't even be expressible for power without a schema change. This plan leans on that per-row column rather than trying to mirror power's single-live-value model.

### What this resolves from the last revision

- **"Past Readings Convention" (from the `MeterMultiplierWorkflowModal` screenshot) is `raw`, not `pre_multiplied`, for this correction.** The stored `current_reading` values on `locator_readings` for "UHRI (8)"'s Jan 1–Sept 26 window are the actual dial values, never hand-multiplied before entry. The backfill script's premise (§1 below, unchanged from the prior revision) stands as originally written.
- The `multiplier_cutover` event you showed me (effective `01/01/2026 06:26 AM`) is the *administrative* record of when ×10 became the correct multiplier — not a physical meter/register swap (that's the separate `physical_replacement` event type in the same modal, `isPhysical` branch). Nothing in the schema or the reading history suggests "UHRI (8)" ever had a different, *legitimate* non-1 multiplier before that — the prior `1` was always the column default, i.e. the bug this plan exists to fix, not a real prior era. **Combined with the principle above ("new multiplier replaces the previous one," full stop, no split ranges) — the whole Jan 1–Sept 26 window gets corrected to a single constant ×10.** No mid-window boundary is needed for "UHRI (8)."

---

## 1. The problem, grounded in the actual code

- `20260926000001_meter_multiplier_feature.sql` lines 22–29 add `multiplier_at_reading numeric DEFAULT 1 NOT NULL` to `locator_readings`/`well_readings`/`product_meter_readings`. A `NOT NULL` column added with a `DEFAULT` backfills every pre-existing row to that default — so every reading recorded before this migration ran (all of Jan 1–Sept 26 for an entity like "UHRI (8)") already has `multiplier_at_reading = 1` on file, and a `daily_volume` computed with no multiplier factor at all (the multiplier-aware trigger branches didn't exist before this migration).
- **This repo already has an established convention for exactly this class of fix** — I found it rather than invented one:
  - `supabase/runbooks/reading_chain_drift_audit.sql` — a **read-only** SQL file, run by hand in the Supabase Dashboard SQL editor, that compares *stored* vs. *recomputed* values and surfaces a `drift` column for a human to review. No writes.
  - `supabase/migrations_archive/20260806000002_meter_rollover_backfill.sql` — the write side of the same pattern: STEP 1 is a read-only candidate audit; STEP 2 is a **guarded `UPDATE` keyed to an explicit, hand-reviewed allow-list of ids** (`target_ids`/`target_corrections`), never a blanket `WHERE reading_datetime < ...`. Its own header calls this "a two-step, human-reviewed process, NOT a blind auto-backfill," for the same reason it matters here: a backward jump (or, in our case, a below-expected volume) can be the genuine article, not always the bug.
  - This plan follows that exact two-step shape rather than a single clever migration, because that's what this codebase already trusts for irreversible historical corrections.
- **A real landmine in the trigger logic** (this is the part worth being careful about): `fn_locator_reading_integrity` (lines 117–125), `fn_well_reading_integrity` (lines 391–399), and `fn_product_meter_reading_integrity` (lines 234–242) — all three BEFORE triggers — contain:
  ```sql
  IF (NEW.multiplier_at_reading IS NULL OR NEW.multiplier_at_reading = 1) THEN
    SELECT COALESCE(meter_multiplier, 1) INTO v_mult FROM <entity> WHERE id = NEW.<fk> AND multiplier_enabled = true;
    IF v_mult IS NOT NULL THEN NEW.multiplier_at_reading := v_mult; END IF;
  END IF;
  ```
  This means: **any plain `UPDATE` that tries to set a historical row's `multiplier_at_reading` back to exactly `1` will get silently overwritten** by the entity's *current* live multiplier, as long as `multiplier_enabled = true` on that entity today. Setting it to a non-`1` value (e.g. `10`) is unaffected — the check only fires on exactly `1`. This no longer matters for "UHRI (8)" itself now that §0 has ruled out a real "pre-multiplier era" inside the window, but it stays relevant once Phase 0's pilot expands to *other* entities (§2, Decision 1) — some of those may have a genuine boundary where `1` really is the correct value for part of their history, and that's exactly the case this landmine bites.
- The entity types are **not symmetric** here, which changes what the correction script has to do per table:
  - **Locators & wells**: the auto-populate check lives in a *separate* BEFORE trigger (`trg_locator_reading_integrity` / `trg_well_reading_integrity`) from the one that computes `daily_volume` (`trg_locator_readings_set_daily_volume` / `trg_well_readings_daily_volume`, both unconditional `BEFORE INSERT OR UPDATE`, no column restriction). So disabling only the `*_integrity` trigger during the correction is enough — the daily-volume trigger stays on, fires anyway, and recomputes `daily_volume` correctly from whatever `multiplier_at_reading` the correction just set. No manual math needed.
  - **Product meters**: `fn_product_meter_reading_integrity` does *both* jobs in one function (auto-populate **and** the `daily_volume` computation, lines 234–268). Disabling it to dodge the auto-populate override also switches off the only thing that would have recomputed `daily_volume` — so the product-meter correction has to compute `daily_volume` itself, replicating that function's exact formula (including the `is_meter_replacement` → `0` and `is_meter_rollover` branches).
  - (Trigger names/timing confirmed against `baseline_schema.sql` lines 8068–8212; the `*_readings_delta`/chain-sync AFTER triggers are all restricted to `UPDATE OF current_reading`, so they never fire for a correction that only touches `multiplier_at_reading` — nothing to worry about there.)
- **Why not route this through the app's existing correction workflow**: `correction_requests` / `fn_approve_correction_request` (`frontend/src/data/mutations/corrections.ts`) is a real, audited data-correction path — but it's built for one flagged reading at a time, with a human reviewer approving each request individually. Running potentially hundreds of rows across nine months through that UI one-by-one isn't practical, and it's not what it's for. `regressionCorrection.ts`'s OLS/reset-anomaly detector is also the wrong tool — it's for finding statistical outliers and mis-keyed values, not applying a known, deterministic multiplier across a known window.
- **Why not route this through `MeterMultiplierWorkflowModal` / `submitMeterMultiplierWorkflow` either** (the "Multiplier Cutover" UI from the screenshot): that mutation is built for a *forward-looking* configuration change — it updates the entity's live `meter_multiplier`/`multiplier_enabled` (already done for "UHRI (8)") and writes **one** reset-boundary reading row at `effective_at` with `daily_volume` forced to `0`, either updating a row within ±1 minute of that timestamp or inserting a brand-new synthetic one. That's the right behavior for a real go-forward cutover or physical replacement, where you *want* a zeroed anchor point. It is the wrong tool for correcting rows that already exist and already hold a real reading — running it wouldn't touch the other hundreds of already-recorded rows in the window at all, and its reset-boundary write could clobber or duplicate a real data point if pointed at a backfill date. It's a config-and-anchor tool, not a bulk-correction tool. Phase 3 (§4) borrows its `meter_events` audit shape without invoking the mutation itself.
- **Checked, and it's a non-issue**: `get_dashboard_aggregates` (`20260924000001_egress_aggregates_and_realtime.sql`) is a plain SQL function that `SUM`s `daily_volume` live from the reading tables via CTEs — there's no materialized view or cached snapshot table sitting in front of it. Once the base rows are corrected, every dashboard/report call downstream reflects it automatically. No separate refresh step needed.

---

## 2. Decisions (were open questions — now resolved)

These were previously framed as open questions needing your input; each is now a locked decision, with the reasoning that closed it.

**Decision 1 — Scope: pilot on "UHRI (8)" first, then expand to every `multiplier_enabled` entity.**
Running Phase 0's audit unscoped from the start risks surfacing a large, unreviewed candidate list before the mechanics are proven on one known entity. So: Phase 0 runs once with the commented-out `WHERE l.id = '<UHRI (8)'s id>'` filter *enabled* (pilot), Phase 2 corrects only that entity, Phase 4 verifies it — and only after that succeeds does Phase 0 re-run with the filter removed, scanning every locator/well/product meter that is currently `multiplier_enabled = true` and has pre-migration readings. The mechanics are identical either way; this only changes when the `WHERE` clause gets widened, and the pilot means the first real production `UPDATE` (Phase 2) touches the smallest possible blast radius before the same script runs against everything else.

**Decision 2 — Multiplier window: constant ×10 across the entire Jan 1 – Sept 26 window for "UHRI (8)."**
Per §0: the `multiplier_cutover` event you have for "UHRI (8)" is dated `01/01/2026 06:26 AM` — essentially the first morning of the window, not a mid-year date — and per the governing principle, a multiplier change replaces the previous value outright rather than implying two legitimately-different eras inside the correction window. There's no evidence (and no plausible mechanism, since `multiplier_enabled` defaults to `false` and `meter_multiplier` defaults to `1` for every entity — see line 10–11 of the migration) of a real prior non-1 multiplier for "UHRI (8)" before that cutover. So the allow-list for "UHRI (8)" is simple: every pre-migration row → `multiplier_at_reading = 10`.
This decision is **entity-specific to "UHRI (8)."** When Decision 1's expansion phase runs, Phase 0's audit output should still be eyeballed per-entity for a `drift_m3` pattern that would suggest a genuine mid-window change for some *other* entity, and cross-referenced against `locator_meter_replacements`/`well_meter_replacements`/`product_meter_replacements` (pre-existing replacement-history tables) and `meter_events` for a serial-number change or an earlier `multiplier_cutover`/`physical_replacement` row in that entity's window — not assumed away by default the way it now safely can be for "UHRI (8)" itself.

**Decision 3 — Audit trail: a `meter_events` row per corrected entity, no schema change needed.**
The "heavier" option from the prior revision — `meter_events` — turns out to need **no migration at all**: `event_type CHECK (event_type IN ('physical_replacement', 'multiplier_cutover'))` already exists (migration lines 33–40), built for precisely this. So Phase 3 is one `INSERT` per corrected entity using the existing `multiplier_cutover` type, `old_reading_convention = 'raw'` (§0), and `effective_at` set to the run date of the correction (not backdated to the reading window) — modeled directly on `submitMeterMultiplierWorkflow`'s own `meter_events.insert()` shape, minus the entity-config update and reset-boundary reading write that mutation also performs (those don't apply here — see the "why not route through the modal" note in §1). A lighter `remarks`-only trail is no longer the fallback; there's nothing left making the heavier option costly.

**Decision 4 — Trigger-disable step: staged, reviewed, and guarded before it ever touches production. This sequence is mandatory, not a recommendation to weigh against schedule pressure.**
`DISABLE TRIGGER`/`ENABLE TRIGGER` has no prior example in this repo's migration history for this specific technique — that novelty is exactly why the extra review isn't overkill here. P2-1 (§3) requires, in this order, with no step skippable: (a) the transaction drafted with explicit rollback notes; (b) a full dry run against **staging**, with the Phase 0 audit re-run afterward as its own verification, output captured and attached to the review; (c) a **second reviewer** signing off on the reviewed diff before it runs against production — this is a hard gate, not a courtesy ping; (d) the transaction itself wrapped with the guard clause in P2-1's SQL, which aborts if the number of rows touched doesn't match the allow-list's row count, so an unexpectedly broad match fails closed instead of silently correcting (or corrupting) more than intended. Whoever runs the script in production needs to have read the inline comment above the guard clause first, so a "division by zero" in the output reads as the safeguard firing, not as something to panic over or work around.

---

## 3. Implementation Checklist

### Phase 0 — Step 1: read-only audit (no writes)
- [ ] **P0-1** New `supabase/runbooks/meter_multiplier_historical_backfill_audit.sql`, modeled on `reading_chain_drift_audit.sql`'s shape (stored vs. recomputed, `drift` column, `UNION ALL` across the three tables):
  ```sql
  -- READ-ONLY. Finds locator_readings / well_readings / product_meter_readings
  -- rows that predate 20260926000001_meter_multiplier_feature.sql and therefore
  -- carry multiplier_at_reading = 1 from the column's DEFAULT rather than any
  -- real multiplier logic, for entities that are currently multiplier_enabled.
  WITH locator_candidates AS (
    SELECT 'locator' AS source, lr.id, l.name AS entity_name,
           l.meter_multiplier AS live_multiplier, l.multiplier_enabled AS live_enabled,
           lr.reading_datetime, lr.current_reading, lr.previous_reading,
           lr.multiplier_at_reading AS stored_multiplier, lr.daily_volume AS stored_daily_volume,
           GREATEST(0, (lr.current_reading - COALESCE(lr.previous_reading, 0)) * l.meter_multiplier)
             AS recomputed_daily_volume
    FROM public.locator_readings lr
    JOIN public.locators l ON l.id = lr.locator_id
    WHERE lr.multiplier_at_reading = 1
      AND l.multiplier_enabled = true
      AND l.meter_multiplier <> 1
      AND NOT COALESCE(lr.is_meter_replacement, false)
      AND l.id = '<UHRI (8)'s id>'   -- PILOT (Decision 1): keep this line for the first run;
                                      -- remove it only after Phase 4 signs off on the pilot
  )
  -- (well_candidates / product_candidates: identical shape, swap table/fk names)
  SELECT *, (recomputed_daily_volume - stored_daily_volume) AS drift_m3
  FROM locator_candidates
  -- UNION ALL well_candidates, product_candidates
  ORDER BY source, entity_name, reading_datetime;
  ```
- [ ] **P0-2** Run it in the Supabase Dashboard SQL editor. Per Decision 2, "UHRI (8)" doesn't need a mid-window eyeball — but once the `l.id` filter is removed for the expansion pass (Decision 1), eyeball each *other* entity's `drift_m3` pattern for a point where it would suggest a genuine mid-window change, cross-referenced against `*_meter_replacements` and `meter_events`, before treating any entity's whole range as one constant multiplier.
- [ ] **P0-3** From the reviewed output, build the `(id, corrected_multiplier)` allow-list for Phase 2 — for "UHRI (8)," this is every candidate row → `10`; for other entities in the expansion pass, grouped by entity and, only if evidence turns up, by sub-range within an entity too.

### Phase 1 — Pilot, then expand (Decision 1)
- [ ] **P1-1** Run Phases 0/2/4 end-to-end for "UHRI (8)" alone first.
- [ ] **P1-2** Only after P4 signs off clean for "UHRI (8)": remove the `l.id` filter from P0-1 and re-run the audit unscoped.
- [ ] **P1-3** Decision 2's "constant ×10, no split" is proven **only for "UHRI (8)."** Do not carry it forward as a blanket assumption. For **every other entity** the expanded audit surfaces, before it goes into Phase 2's allow-list:
  - [ ] Eyeball that entity's own `drift_m3` series for a break point (a run of rows where the recomputed-vs-stored gap changes shape partway through the window) rather than assuming it looks like "UHRI (8)"'s.
  - [ ] Cross-reference `locator_meter_replacements`/`well_meter_replacements`/`product_meter_replacements` for a serial-number change inside that entity's window.
  - [ ] Cross-reference `meter_events` for an earlier `multiplier_cutover` or `physical_replacement` row for that entity — if one exists mid-window, that's the split boundary, and rows on either side of it get different `corrected_multiplier` values in the allow-list, not one constant.
  - [ ] Only once all three come back clean (no break point, no replacement, no earlier event) does that entity get the single-constant treatment "UHRI (8)" got.
- [ ] **P1-4** Repeat Phase 0→Phase 4 per entity (or per batch of entities that passed P1-3 with the same outcome), rather than one all-entity run — a split-boundary entity needs a different allow-list shape than a constant one, and batching them together risks the constant assumption leaking into a row that needed splitting.

### Phase 2 — Step 2: guarded correction
- [ ] **P2-1** New `supabase/migrations_archive/<run-date>_meter_multiplier_historical_backfill.sql`, following `meter_rollover_backfill.sql`'s allow-list pattern — a single transaction, run by hand as Admin, not part of the normal CI-applied migration chain. Per Decision 4: draft on staging first, second reviewer signs off on the reviewed diff, then run against production.
  ```sql
  BEGIN;

  -- Bypass the auto-populate override (see §1) — it would otherwise re-derive
  -- previous_reading/norm_status and, for any row we want to leave at exactly 1,
  -- silently overwrite it back to today's live multiplier.
  ALTER TABLE public.locator_readings DISABLE TRIGGER trg_locator_reading_integrity;
  ALTER TABLE public.well_readings DISABLE TRIGGER trg_well_reading_integrity;
  ALTER TABLE public.product_meter_readings DISABLE TRIGGER trg_product_meter_reading_integrity;

  -- Locators & wells: the separate *_daily_volume trigger stays ENABLED (it's
  -- unconditional and has no auto-populate logic) — it recomputes daily_volume
  -- for us from whatever multiplier_at_reading we set below. No manual math.
  WITH target_corrections (id, corrected_multiplier) AS (
    VALUES
      -- Paste confirmed (id, multiplier) pairs from Phase 0's reviewed audit here.
      ('00000000-0000-0000-0000-000000000000'::uuid, 10)
  ),
  updated AS (
    UPDATE public.locator_readings lr
       SET multiplier_at_reading = tc.corrected_multiplier
      FROM target_corrections tc
     WHERE lr.id = tc.id
       AND lr.multiplier_at_reading IS DISTINCT FROM tc.corrected_multiplier -- idempotent
     RETURNING lr.id
  )
  -- Guard clause (Decision 4): fail the whole transaction if the update touched
  -- a different number of rows than the allow-list expects, rather than
  -- silently committing a broader (or narrower) correction than reviewed.
  --
  -- >>> READ THIS BEFORE YOU RUN THIS SCRIPT <<<
  -- If you see a "division by zero" error in the SQL editor output below,
  -- that is this guard clause WORKING AS DESIGNED, not a bug in the script.
  -- It means the UPDATE above touched a different number of rows than the
  -- target_corrections allow-list expected, so the whole transaction was
  -- rolled back automatically and NOTHING was committed. Do not retry by
  -- editing around the error — go back to Phase 0's audit output and figure
  -- out why the row count didn't match before re-running.
  SELECT CASE WHEN (SELECT count(*) FROM updated) NOT IN (0, (SELECT count(*) FROM target_corrections))
    THEN (SELECT 1/0) -- deliberate divide-by-zero: aborts the transaction
  END;

  -- (identical block + guard for well_readings / target well ids)

  -- Product meters: fn_product_meter_reading_integrity computed daily_volume
  -- itself, so disabling it means we compute it here, mirroring its formula.
  WITH target_corrections (id, corrected_multiplier) AS (
    VALUES ('00000000-0000-0000-0000-000000000000'::uuid, 10)
  )
  UPDATE public.product_meter_readings pmr
     SET multiplier_at_reading = tc.corrected_multiplier,
         daily_volume = CASE
           WHEN COALESCE(pmr.is_meter_replacement, false) THEN 0
           WHEN COALESCE(pmr.is_meter_rollover, false) AND pmr.meter_rollover_max IS NOT NULL
             THEN GREATEST(0, (pmr.meter_rollover_max - COALESCE(pmr.previous_reading, 0) + pmr.current_reading) * tc.corrected_multiplier)
           ELSE GREATEST(0, (pmr.current_reading - COALESCE(pmr.previous_reading, 0)) * tc.corrected_multiplier)
         END
    FROM target_corrections tc
   WHERE pmr.id = tc.id;

  ALTER TABLE public.locator_readings ENABLE TRIGGER trg_locator_reading_integrity;
  ALTER TABLE public.well_readings ENABLE TRIGGER trg_well_reading_integrity;
  ALTER TABLE public.product_meter_readings ENABLE TRIGGER trg_product_meter_reading_integrity;

  COMMIT;
  ```
- [ ] **P2-2** Append a `remarks` note to each corrected row (e.g. `[Multiplier Backfill <run-date>] corrected from ×1 to ×10 — see docs/MULTIPLIER-HISTORICAL-BACKFILL-PLAN.md`) — kept regardless of Decision 3's outcome, since it's cheap and makes the row self-explanatory without a join.
- [ ] **P2-3** Re-run Phase 0's audit script afterward — `drift_m3` should now read `0` for every corrected row, and it's safe to re-run any time since the `IS DISTINCT FROM` guard makes it a no-op on rows already corrected.

### Phase 3 — Audit trail (Decision 3 — no migration required)
- [ ] **P3-1** One `meter_events` insert per corrected entity, in the same transaction as its Phase 2 correction (or immediately after, same run):
  ```sql
  INSERT INTO public.meter_events (
    entity_type, entity_id, plant_id, event_type, effective_at,
    old_reading_convention, new_multiplier, new_multiplier_enabled,
    performed_by, notes
  ) VALUES (
    'locator', '<UHRI (8)'s id>', '<plant id>', 'multiplier_cutover', now(),
    'raw', 10, true,
    '<performing user id>',
    'Historical backfill: corrected multiplier_at_reading from column default (1) to true value (10) '
    || 'for pre-20260926000001 readings, Jan 1 - Sept 26 2026. See docs/MULTIPLIER-HISTORICAL-BACKFILL-PLAN.md.'
  );
  ```
  `effective_at` is the *run date* of this correction, not backdated into the reading window — it's logging when the data was fixed, not re-asserting a historical cutover moment that already has its own `meter_events` row from when ×10 was first configured.

### Phase 4 — Verification
- [ ] **P4-1** Spot-check "UHRI (8)"'s reading history via the **dashboard/report path** (`get_dashboard_aggregates`, §1) — **not** the reading-history dialog (History → 30D/60D/Custom table). That dialog's Δ column, for the `locator`/`well` modules, is computed client-side as a plain `current − previous` with no multiplier term, and doesn't render `multiplier_at_reading` at all — so it will show no visible change before/after this backfill even once "UHRI (8)" is corrected, and isn't a valid check either way. The dashboard/report path sums the real, multiplier-aware `daily_volume` column the DB trigger computes, so numbers should jump by the multiplier factor for the corrected window and nowhere else.
- [ ] **P4-2** Confirm nothing after Sept 26 changed (it shouldn't have — the allow-list only ever contains pre-migration ids).
- [ ] **P4-3** Confirm the Phase 3 `meter_events` row is visible in whatever UI/query already lists these (`frontend/src/data/queries/meterEvents.ts`), since that's presumably how this gets reviewed going forward.
- [ ] **P4-4 (follow-up, not a blocker for this backfill)** The reading-history dialog's missing multiplier column and unmultiplied Δ, found while working out P4-1, is a real gap independent of this backfill — flagged and scoped separately in `docs/HISTORY-TABLE-MULTIPLIER-DISPLAY-PLAN.md`. It doesn't need to land before or with this correction; it's here so it isn't lost.

---

## 4. Explicitly out of scope

- Automatically detecting *when* a mid-window multiplier change happened for entities beyond "UHRI (8)" — Decision 2's per-entity caveat means this plan surfaces the data for a human to judge on expansion; it doesn't guess.
- Anything dated on/after `20260926000001`'s run — those rows already compute `multiplier_at_reading` correctly via the live trigger logic and don't need touching.
- Routing this through `correction_requests` / the Data Corrections UI, or through `MeterMultiplierWorkflowModal` / `submitMeterMultiplierWorkflow` — established in §1 as the wrong tools for a bulk, deterministic, pre-reviewed correction of rows that already exist.
- RO-train meters and power/grid meters — no `meter_multiplier`/`multiplier_at_reading` concept exists on those entities; they use the separate `plant_power_config.grid_meter_multipliers` model described in §0, which is a live current-value config, not a per-row historical field, and isn't affected by this bug in the first place (it was never wired through the Sept 26 migration's `DEFAULT`).
- Rewriting or "correcting" any `current_reading` value. Per §0, the raw reading is never in question and is never touched — only `multiplier_at_reading` and the `daily_volume` derived from it.

## 5. Non-negotiables, restated

Three things from §2/§3 that are easy to skim past in a checklist but shouldn't be treated as optional in practice:

- **Scope**: Decision 2's "constant ×10, no split" is proven for "UHRI (8)" only. Phase 1 (P1-3) now makes the per-entity `drift_m3` + replacement-table + `meter_events` check a required gate before any other entity gets the same constant treatment — not a suggestion to eyeball if time allows.
- **Guard clause**: the `1/0` in P2-1 is deliberate and stays as written. The inline comment directly above it in the script is there so whoever runs it in the Supabase SQL editor recognizes a "division by zero" as the safeguard doing its job — not something to debug around.
- **Trigger disable**: staging dry-run and a second reviewer's sign-off (Decision 4) are both required before P2-1 runs against production, precisely because this technique has no precedent elsewhere in this repo's migration history.
