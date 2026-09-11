-- =============================================================================
-- Migration: 20260908000004_004_custom_roles_and_readings.sql
-- Baseline 004: Custom Roles, Reading Views & Deduping (Aug 2026)
-- Partition of baseline schema covering archived migrations #61 to #96
-- =============================================================================

-- >>>>>>> BEGIN ARCHIVED: 20260802000001_migration_state.sql >>>>>>>
-- =====================================================================
-- Migration state (Admin → Migrations panel)
--
-- The FastAPI backend used to track "mark applied" overrides and apply
-- history in two local JSON files beside the server process
-- (backend/state/migration_overrides.json, migration_apply_history.json).
-- That was already fragile (lost on every backend redeploy) and now that
-- the app is Supabase-only, there's no server filesystem to keep it on
-- at all. This table replaces both files with one persistent, RLS-gated
-- row-per-migration-file store.
--
-- One row per filename; either or both of manual_override / apply_history
-- may be null. A file with no row at all has neither.
-- =====================================================================

create table if not exists public.migration_state (
  filename        text primary key,
  -- { marked_at, by_user_id, by_label, note } | null — "I ran this by hand".
  manual_override jsonb,
  -- { applied_at, by_label, note, source } | null — permanent first-known
  -- apply event, preserved even after manual_override is cleared.
  apply_history   jsonb,
  updated_at      timestamptz not null default now()
);

alter table public.migration_state enable row level security;

-- Admin-only, matching require_roles(caller, {"Admin"}) on every route this
-- table replaces (list/mark/unmark/import-history were all Admin-only,
-- stricter than the Manager-inclusive is_manager_or_admin used elsewhere).
drop policy if exists "migration_state_admin_all" on public.migration_state;
create policy "migration_state_admin_all" on public.migration_state
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop trigger if exists trg_migration_state_updated on public.migration_state;
create trigger trg_migration_state_updated
  before update on public.migration_state
  for each row execute function public.update_updated_at_column();

-- <<<<<<< END ARCHIVED: 20260802000001_migration_state.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260806000001_wells_meter_rollover_max_config.sql >>>>>>>
-- =============================================================================
-- Migration: 20260806143000_wells_meter_rollover_max_config.sql
-- Per-well meter rollover config (gap #2 from the meter-rollover diagnostic
-- alongside 20260720_recursive_cascade_and_meter_rollover.sql and
-- 20260806*_meter_rollover_backfill.sql).
--
-- Context: the "meter rollover" checkbox at reading-entry time
-- (frontend/src/pages/operations/wells/WellSection.tsx) defaults the wrap
-- point to a hardcoded '99999' that the operator has to overtype by hand
-- every time. Nothing records what a given well's meter actually wraps at,
-- so that default is frequently wrong (e.g. Well 9's 6-digit register wraps
-- at 999999.99, not 99999.99) and easy to enter incorrectly under pressure
-- during a live reading.
--
-- This column is a per-well source of truth for that wrap point:
--   - WellSection.tsx's entry-time default reads it instead of the literal.
--   - Admin → Edit Well exposes it so it can be set once and reused.
--   - Data Corrections' "Mark as rollover" action (Pending Review tab) can
--     eventually default to it too, though today it still uses a guessed
--     digit-count heuristic per row, same as the backfill script's Step 1 —
--     wiring the two together is a follow-up, not required for either to work.
--
-- NULL means "not configured yet" — callers keep falling back to the
-- guessed/hardcoded default, so this is purely additive and never required.
-- =============================================================================

ALTER TABLE wells
  ADD COLUMN IF NOT EXISTS meter_rollover_max NUMERIC;

COMMENT ON COLUMN wells.meter_rollover_max IS
  'Physical meter register wrap point for this well (e.g. 999999.99 for a 6-digit odometer). NULL = not configured; callers fall back to a guessed or hardcoded default. Used to pre-fill the rollover checkbox at reading entry (WellSection.tsx) and, going forward, the Data Corrections "Mark as rollover" action.';

-- Per this project's convention (see 20260722_z_pgrst_schema_reload.sql):
-- new columns need this or PostgREST can reject requests referencing them
-- with a misleading "relation does not exist" error until its next
-- periodic cache reload.
NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260806000001_wells_meter_rollover_max_config.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260806000002_meter_rollover_backfill.sql >>>>>>>
-- =============================================================================
-- 20260806153000_meter_rollover_backfill.sql
-- Backfill: mark missed meter rollovers + recompute their daily_volume
-- =============================================================================
-- Context: 20260720_recursive_cascade_and_meter_rollover.sql added
-- is_meter_rollover / meter_rollover_max and rollover-aware daily_volume, but
-- only for readings entered (or corrected) AFTER that migration ran, and only
-- on the path where the operator actually checked "meter rollover" at entry.
-- Rows saved before then — or saved after but without the box checked, then
-- waved through Pending Review — still have is_meter_rollover = false and
-- daily_volume clamped to 0 for that day, silently under-counting
-- production. (The History dialog's negative-Δ display bug and Pending
-- Review's missing "Mark as rollover" action are separate, already-patched
-- frontend issues — this script only touches stored data, and only for rows
-- that predate those fixes or otherwise slipped through before they were
-- classified as genuine rollovers.)
--
-- This is a two-step, human-reviewed process, NOT a blind auto-backfill:
-- a backward reading can also be a genuine data-entry error, and those must
-- NOT be marked as rollovers. Same reasoning as
-- 20260428_cleanup_bad_imports.sql's explicit target_names allow-list.
--
--   STEP 1 (below): read-only. Lists every backward-jump candidate across
--   well_readings / locator_readings / product_meter_readings with a guessed
--   meter_rollover_max (10^digits(previous_reading) - 0.01) and the daily_volume
--   that guess implies. Review each row against the actual meter's register
--   size before trusting the guess.
--
--   STEP 2 (bottom): guarded UPDATE. Copy the id(s) you've confirmed as real
--   rollovers from Step 1 into target_ids per table, double-check
--   confirmed_max against the physical meter, then run. Rows not listed are
--   left untouched. Idempotent — re-running after a row is fixed is a no-op
--   for that id.
--
-- Run this in: Supabase Dashboard → SQL Editor, as an Admin.
-- =============================================================================

-- ── STEP 1: Candidate audit (read-only — run this first, review the output) ──

SELECT
  'well_readings' AS source_table, wr.id, w.name AS entity_name,
  wr.reading_datetime, wr.previous_reading, wr.current_reading,
  wr.current_reading - wr.previous_reading AS naive_delta,
  wr.daily_volume AS stored_daily_volume,
  power(10, length(floor(wr.previous_reading)::text)) - 0.01 AS guessed_meter_max,
  GREATEST(0, round(
    (power(10, length(floor(wr.previous_reading)::text)) - 0.01) - wr.previous_reading + wr.current_reading
  )) AS guessed_daily_volume_if_rollover,
  wr.norm_status
FROM well_readings wr
JOIN wells w ON w.id = wr.well_id
WHERE wr.previous_reading IS NOT NULL
  AND wr.current_reading < wr.previous_reading
  AND wr.is_meter_rollover = false

UNION ALL

SELECT
  'locator_readings', lr.id, l.name,
  lr.reading_datetime, lr.previous_reading, lr.current_reading,
  lr.current_reading - lr.previous_reading,
  lr.daily_volume,
  power(10, length(floor(lr.previous_reading)::text)) - 0.01,
  GREATEST(0, round(
    (power(10, length(floor(lr.previous_reading)::text)) - 0.01) - lr.previous_reading + lr.current_reading
  )),
  lr.norm_status
FROM locator_readings lr
JOIN locators l ON l.id = lr.locator_id
WHERE lr.previous_reading IS NOT NULL
  AND lr.current_reading < lr.previous_reading
  AND lr.is_meter_rollover = false

UNION ALL

SELECT
  'product_meter_readings', pmr.id, pm.name,
  pmr.reading_datetime, pmr.previous_reading, pmr.current_reading,
  pmr.current_reading - pmr.previous_reading,
  pmr.daily_volume,
  power(10, length(floor(pmr.previous_reading)::text)) - 0.01,
  GREATEST(0, round(
    (power(10, length(floor(pmr.previous_reading)::text)) - 0.01) - pmr.previous_reading + pmr.current_reading
  )),
  pmr.norm_status
FROM product_meter_readings pmr
JOIN product_meters pm ON pm.id = pmr.meter_id
WHERE pmr.previous_reading IS NOT NULL
  AND pmr.current_reading < pmr.previous_reading
  AND pmr.is_meter_rollover = false

ORDER BY 1, 4 DESC;

-- Sanity check while reviewing Step 1's output:
--  - A real rollover's current_reading should look like an early reading for
--    that entity (small, near its historical minimum) and previous_reading
--    should sit close under guessed_meter_max.
--  - A data-entry error more often looks like a plausible mid-range value
--    with a digit dropped/transposed — guessed_daily_volume_if_rollover will
--    usually look implausibly large or small for that entity's normal flow.
--    Do NOT include those ids in Step 2.

-- ── STEP 2: Guarded backfill — only runs for ids you've confirmed ──────────
-- Fill in target_ids + confirmed_max per table (empty array = skip that
-- table entirely). confirmed_max should come from the physical meter's
-- actual register size, NOT copy-pasted blindly from Step 1's guess.

DO $$
DECLARE
  -- Example based on the Well 9 case (May 5, 2026): 6-digit register
  -- wrapping at 999999.99. Replace with the real id(s) + confirmed max.
  well_target_ids   CONSTANT UUID[]   := ARRAY[]::UUID[];  -- e.g. ARRAY['00000000-0000-0000-0000-000000000000']
  well_confirmed_max CONSTANT NUMERIC := 999999.99;

  locator_target_ids   CONSTANT UUID[]   := ARRAY[]::UUID[];
  locator_confirmed_max CONSTANT NUMERIC := 999999.99;

  product_target_ids   CONSTANT UUID[]   := ARRAY[]::UUID[];
  product_confirmed_max CONSTANT NUMERIC := 999999.99;

  cnt BIGINT;
BEGIN
  IF array_length(well_target_ids, 1) IS NOT NULL THEN
    UPDATE well_readings
       SET is_meter_rollover  = true,
           meter_rollover_max = well_confirmed_max,
           daily_volume       = GREATEST(0, round(well_confirmed_max - previous_reading + current_reading))
     WHERE id = ANY(well_target_ids)
       AND is_meter_rollover = false;   -- idempotent guard
    GET DIAGNOSTICS cnt = ROW_COUNT; RAISE NOTICE 'well_readings backfilled: %', cnt;
  ELSE
    RAISE NOTICE 'well_readings: no target_ids set — skipped';
  END IF;

  IF array_length(locator_target_ids, 1) IS NOT NULL THEN
    UPDATE locator_readings
       SET is_meter_rollover  = true,
           meter_rollover_max = locator_confirmed_max
           -- daily_volume is GENERATED ALWAYS AS on this table — Postgres
           -- recomputes it automatically from the two columns above.
     WHERE id = ANY(locator_target_ids)
       AND is_meter_rollover = false;
    GET DIAGNOSTICS cnt = ROW_COUNT; RAISE NOTICE 'locator_readings backfilled: %', cnt;
  ELSE
    RAISE NOTICE 'locator_readings: no target_ids set — skipped';
  END IF;

  IF array_length(product_target_ids, 1) IS NOT NULL THEN
    UPDATE product_meter_readings
       SET is_meter_rollover  = true,
           meter_rollover_max = product_confirmed_max,
           daily_volume       = GREATEST(0, round(product_confirmed_max - previous_reading + current_reading))
     WHERE id = ANY(product_target_ids)
       AND is_meter_rollover = false;
    GET DIAGNOSTICS cnt = ROW_COUNT; RAISE NOTICE 'product_meter_readings backfilled: %', cnt;
  ELSE
    RAISE NOTICE 'product_meter_readings: no target_ids set — skipped';
  END IF;
END
$$;

-- Note: none of the three affected rows' downstream neighbors need repair
-- here — current_reading on the corrected row isn't changing, only
-- is_meter_rollover / meter_rollover_max / daily_volume on that single row,
-- so the next reading's previous_reading (already equal to this row's
-- current_reading) is untouched. fn_cascade_reading_correction is only
-- needed when current_reading itself is being changed.

-- <<<<<<< END ARCHIVED: 20260806000002_meter_rollover_backfill.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260806000003_reading_audit_log_add_power_blending_well.sql >>>>>>>
-- Extend reading_edit_audit_log to cover power_readings, blending_events, and
-- well_readings.
--
-- PowerSection.tsx previously had no edit-window gating or audit logging at
-- all (see Design Audit / Critical Issue #3 — the edit path existed but was
-- ungated and unaudited, and delete didn't exist). Investigating that surfaced
-- a bigger issue: the actual edit/delete UI for readings isn't in
-- PowerSection.tsx at all (its local editingId/startEdit are dead code, never
-- called) -- it's the shared ReadingHistoryDialog.tsx, used by all four
-- reading modules (locator, well, power, blending), which had
-- `const canEditDelete = true` hardcoded with no role/ownership/time-window
-- check and no audit logging whatsoever. The frontend fix wires all four
-- modules up to the same canEditEntry/logReadingEdit primitive already used
-- by ro_train_readings/ro_pretreatment_readings/chemical_dosing_logs/
-- locator_readings -- this migration is the DB-side half of that, following
-- the exact same DROP/ADD pattern 20260727_hamas_phase0_roles_and_audit.sql
-- used when locator_readings was added. well_readings is added alongside the
-- other two for the same reason -- it went through this exact dialog too and
-- had no audit coverage despite locator_readings (its closest sibling) having
-- had it since Phase 0.
--
-- blending_events has no recorded_by column (never had per-operator
-- ownership tracking), so canEditEntry naturally degrades to admin/manager/
-- data-analyst-only there -- no schema change needed for the permission
-- check itself, just adding it here so admin-performed blending edits and
-- deletes actually get logged like everywhere else.

ALTER TABLE public.reading_edit_audit_log
  DROP CONSTRAINT IF EXISTS reading_edit_audit_log_table_name_check;

ALTER TABLE public.reading_edit_audit_log
  ADD CONSTRAINT reading_edit_audit_log_table_name_check
  CHECK (table_name IN (
    'ro_train_readings',
    'ro_pretreatment_readings',
    'chemical_dosing_logs',
    'locator_readings',
    'power_readings',
    'blending_events',
    'well_readings'
  ));

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260806000003_reading_audit_log_add_power_blending_well.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260807000001_hamas_phase12_scoped_sweep_protects_overrides_not_dates.sql >>>>>>>
-- =============================================================================
-- Migration: hamas_phase12_scoped_sweep_protects_overrides_not_dates
-- Applied 2026-08-07, found while re-investigating SRP↔Mambaling HAMAS still
-- reading 0 for every day after 2026-08-01 despite the phase9-11 fixes.
--
-- ROOT CAUSE:
--   Phase 7's freshness gate is:
--     IF p_date <> v_today AND NOT EXISTS (open review flag for this date)
--       THEN CONTINUE (skip, leave untouched)
--   i.e. it only ever writes a value for TODAY, or for a past date that has
--   an explicit open review flag. Every other past date is permanently
--   frozen at whatever it last held (0, if it was never swept).
--
--   But .github/workflows/derived-meter-sweep.yml — the routine 3x/day
--   cron — is deliberately written to target YESTERDAY (p_date defaults to
--   "yesterday PHT"; see its own header comment: "a sibling correction made
--   during the day shows up in Hamas within 8h"). Yesterday is, by
--   definition, never v_today. So every scheduled run's whole 3-day
--   lookback window (yesterday-2 .. yesterday) hits the gate and gets
--   skipped, every single time — and fn_sweep_derived_meters() still
--   returns {"ok": true}, so the workflow shows green in GitHub Actions
--   while silently doing nothing. This is why HAMAS goes 0 the moment
--   nobody manually intervenes.
--
--   The only path that ever produced a real value was the "Recalculate now"
--   button (LocatorSection.tsx), which passes p_date = today explicitly —
--   but per this same file's phase 2026-07-26 comment, a day's residual is
--   only accurate once that day has *closed* (mother meter + all siblings
--   read for the full day). Recalculating "today" mid-day computes off an
--   incomplete day and, per the note above, that date can then never be
--   corrected later by the routine sweep once the day *does* close —
--   because by then it's no longer "today" and gets skipped.
--
-- FIX:
--   The gate's real intent (see phase7/phase3's own comments) was "don't
--   let a routine re-sweep silently clobber a value a human set on
--   purpose." That's exactly what is_estimated already encodes: sweep
--   writes always set is_estimated = true; every override path
--   (DerivedMeterOverrideDialog's saveOverride, the CSV bulk-override
--   insertDerivedOverrideRows) always sets is_estimated = false. So: skip
--   a (locator, date) pair only if it already holds a human-set
--   (is_estimated = false) value AND nothing has flagged it for review
--   since. Drop the "date must equal today" condition entirely — a date
--   that's never been swept, or one the sweep itself last wrote, is always
--   fair game for the routine catch-up pass, whether that's today or any
--   day in the lookback window. This also means an override made *today*
--   is now protected the same way a past-date override already was
--   (previously it wasn't, since the old gate always fell through for
--   p_date = today regardless of override status).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_sweep_derived_meters_for_date(p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_day_start       timestamptz := (p_date::timestamp) AT TIME ZONE 'Asia/Manila';
  v_day_end         timestamptz := ((p_date + 1)::timestamp) AT TIME ZONE 'Asia/Manila';
  v_reading_dt      timestamptz := v_day_end - interval '1 second';

  r_loc             RECORD;
  v_mother_vol      numeric;
  v_others_vol      numeric;
  v_residual        numeric;
  v_has_override    boolean;

  v_lr_id           uuid;
  v_old_daily_vol   numeric;
  v_changed         boolean;

  v_mirror                  RECORD;
  v_mirror_id               uuid;
  v_first_mirror_id         uuid;

  v_swept           jsonb := '[]'::jsonb;
  v_skipped         jsonb := '[]'::jsonb;
BEGIN
  FOR r_loc IN
    SELECT id, name, plant_id, product_meter_id, derived_from_meter_id
    FROM public.locators
    WHERE is_derived = true
      AND derived_from_meter_id IS NOT NULL
      AND status = 'Active'
  LOOP
    -- Protect a human-set value (is_estimated = false), not a calendar date.
    -- A date the sweep has never touched, or one it last wrote itself
    -- (is_estimated = true), is always eligible for (re)computation.
    SELECT EXISTS (
      SELECT 1 FROM public.locator_readings
       WHERE locator_id = r_loc.id
         AND reading_datetime >= v_day_start AND reading_datetime < v_day_end
         AND is_estimated = false
    ) INTO v_has_override;

    IF v_has_override AND NOT EXISTS (
      SELECT 1 FROM public.locator_derived_review_flags
       WHERE locator_id = r_loc.id AND date_key = p_date AND resolved_at IS NULL
    ) THEN
      v_skipped := v_skipped || jsonb_build_object(
        'locator_id', r_loc.id, 'locator_name', r_loc.name,
        'reason', 'manually overridden and no open review flag for this date — left untouched'
      );
      CONTINUE;
    END IF;

    SELECT SUM(COALESCE(daily_volume, 0)) INTO v_mother_vol
    FROM public.product_meter_readings
    WHERE meter_id = r_loc.derived_from_meter_id
      AND reading_datetime >= v_day_start AND reading_datetime < v_day_end;

    IF v_mother_vol IS NULL THEN
      v_skipped := v_skipped || jsonb_build_object(
        'locator_id', r_loc.id, 'locator_name', r_loc.name,
        'reason', 'mother meter has no reading for this date'
      );
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(
      CASE
        WHEN lr.previous_reading IS NULL THEN 0
        WHEN sib.default_input_mode = 'direct' THEN GREATEST(0, lr.current_reading)
        ELSE GREATEST(0, lr.current_reading - lr.previous_reading)
      END
    ), 0) INTO v_others_vol
    FROM public.locator_readings lr
    JOIN public.locators sib ON sib.id = lr.locator_id
    WHERE sib.product_meter_id = r_loc.derived_from_meter_id
      AND sib.is_derived = false
      AND lr.reading_datetime >= v_day_start AND lr.reading_datetime < v_day_end;

    v_residual := GREATEST(0, v_mother_vol - v_others_vol);

    SELECT id, daily_volume INTO v_lr_id, v_old_daily_vol
    FROM public.locator_readings
    WHERE locator_id = r_loc.id
      AND reading_datetime >= v_day_start AND reading_datetime < v_day_end
    ORDER BY reading_datetime DESC LIMIT 1;

    IF v_lr_id IS NOT NULL THEN
      UPDATE public.locator_readings
      SET current_reading = v_residual, previous_reading = 0, is_estimated = true
      WHERE id = v_lr_id;
      v_changed := (v_old_daily_vol IS DISTINCT FROM v_residual);
    ELSE
      INSERT INTO public.locator_readings
        (locator_id, plant_id, reading_datetime, current_reading, previous_reading, is_estimated)
      VALUES
        (r_loc.id, r_loc.plant_id, v_reading_dt, v_residual, 0, true)
      RETURNING id INTO v_lr_id;
      v_old_daily_vol := NULL;
      v_changed := true;
    END IF;

    v_first_mirror_id := NULL;
    FOR v_mirror IN
      SELECT id, plant_id FROM public.product_meters
      WHERE derived_from_locator_id = r_loc.id AND is_derived = true
    LOOP
      IF v_first_mirror_id IS NULL THEN v_first_mirror_id := v_mirror.id; END IF;

      SELECT id INTO v_mirror_id
      FROM public.product_meter_readings
      WHERE meter_id = v_mirror.id
        AND reading_datetime >= v_day_start AND reading_datetime < v_day_end
      ORDER BY reading_datetime DESC LIMIT 1;

      IF v_mirror_id IS NOT NULL THEN
        UPDATE public.product_meter_readings
        SET current_reading  = v_residual,
            previous_reading = 0,
            daily_volume     = v_residual,
            is_estimated     = true
        WHERE id = v_mirror_id;
      ELSE
        INSERT INTO public.product_meter_readings
          (meter_id, plant_id, reading_datetime, current_reading, previous_reading, daily_volume, is_estimated)
        VALUES
          (v_mirror.id, v_mirror.plant_id, v_reading_dt, v_residual, 0, v_residual, true);
      END IF;
    END LOOP;

    INSERT INTO public.derived_meter_sweep_log
      (locator_id, date_key, old_value, new_value, changed, mirror_meter_id)
    VALUES
      (r_loc.id, p_date, v_old_daily_vol, v_residual, v_changed, v_first_mirror_id);

    UPDATE public.locator_derived_review_flags
    SET resolved_at = now()
    WHERE locator_id = r_loc.id AND date_key = p_date AND resolved_at IS NULL;

    v_swept := v_swept || jsonb_build_object(
      'locator_id', r_loc.id, 'locator_name', r_loc.name,
      'mother_vol', v_mother_vol, 'others_vol', v_others_vol,
      'residual', v_residual, 'changed', v_changed, 'mirrored', v_first_mirror_id IS NOT NULL
    );
  END LOOP;

  RETURN jsonb_build_object('date', p_date, 'swept', v_swept, 'skipped', v_skipped);
END;
$function$;

-- <<<<<<< END ARCHIVED: 20260807000001_hamas_phase12_scoped_sweep_protects_overrides_not_dates.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260807000002_manager_plant_scorecard.sql >>>>>>>
-- =============================================================================
-- Migration: 20260807_manager_plant_scorecard.sql
--
-- Manager data-quality oversight scorecard.
--
-- Adds one RPC, fn_manager_plant_scorecard(from, to), that rolls up gap
-- coverage, flagged/corrected readings, and open exceptions per plant, and
-- attributes each plant to whichever Manager(s) have it in
-- user_profiles.plant_assignments.
--
-- Deliberately stays at the PLANT/MANAGER grain, not per-operator.
-- DataCompletenessRadarCard.tsx already made this call for the existing
-- completeness radar: recorded_by/completed_by are nullable (imports, shared
-- logins) and there's no shift-roster table, so pinning a *missing* entry on
-- one person would misattribute blame that isn't necessarily theirs. This
-- function measures the same thing this app already asks of a Manager
-- elsewhere -- review flagged readings, log gap reasons, resolve correction
-- requests -- rolled up so it's visible whether that's actually happening
-- for each plant, without trying to fingerprint who caused a given gap.
--
-- Two different kinds of column come back, and they answer different
-- questions:
--   * "_in_window" columns (completeness, flagged/error rate, unexplained
--     gaps) are scoped to [p_from, p_to] -- "how did this period go."
--   * "open_*" columns (pending reviews, open correction requests, and
--     their oldest-open-days) are CURRENT STATE as of right now, not as of
--     p_to. norm_status and correction_requests.status are live columns
--     with nothing behind them recording when they changed, so there's no
--     way to reconstruct "what was open as of a past date" -- only what's
--     open today. If you want a true backlog trend over time, call this on
--     a schedule (the existing vercel.json cron pattern) and INSERT the
--     result into a snapshot table, the same way compliance_snapshots
--     already does for Compliance -- happy to add that as a follow-up
--     migration once the shape of this one is confirmed.
--
-- Authorization happens INSIDE the function, not via a table RLS policy.
-- This has to be SECURITY DEFINER to read across reading_normalizations /
-- correction_requests / other plants' rows the caller's own RLS would
-- otherwise hide, which means it must police plant visibility itself or it
-- becomes a privilege-escalation hole. Admin and Data Analyst see every
-- plant; Manager sees only plants in their own plant_assignments; every
-- other role is rejected outright. This mirrors the access model already
-- used by DataCorrections.tsx / reading_normalizations (Admin, Data
-- Analyst, Manager) rather than the narrower Admin/Manager-only model on
-- reading_edit_audit_log, since this is closer in spirit to the
-- corrections workflow than to the edit log.
--
-- correction_requests is read from here but still isn't defined in any
-- migration in this repo (see the note in
-- 20260723_manager_data_corrections_access.sql) -- it was created directly
-- in the Supabase dashboard. This function reads only the columns
-- DataCorrections.tsx already relies on (plant_id, status, created_at). If
-- its real shape has drifted from that, this migration will fail loudly at
-- CREATE-time rather than silently -- worth codifying that table in its own
-- migration while this area is already being touched.
--
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================================================

-- ── 0. Supporting indexes ────────────────────────────────────────────────────
-- This function (and DataAnalysis/DataCorrections) query norm_status to find
-- exception rows. Only ro_train_readings has an index on it today
-- (20260801_notifications_delete_and_pending_review.sql). 'normal' is the
-- overwhelming majority value on all four tables, so a partial index on the
-- exception rows is both small and exactly what these WHERE clauses need.

CREATE INDEX IF NOT EXISTS idx_well_readings_norm_status
  ON public.well_readings (plant_id, norm_status) WHERE norm_status <> 'normal';
CREATE INDEX IF NOT EXISTS idx_locator_readings_norm_status
  ON public.locator_readings (plant_id, norm_status) WHERE norm_status <> 'normal';
CREATE INDEX IF NOT EXISTS idx_pmr_norm_status
  ON public.product_meter_readings (plant_id, norm_status) WHERE norm_status <> 'normal';

-- ── 1. fn_manager_plant_scorecard ────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.fn_manager_plant_scorecard(date, date);

CREATE OR REPLACE FUNCTION public.fn_manager_plant_scorecard(
  p_from date,
  p_to   date
)
RETURNS TABLE (
  plant_id                         uuid,
  plant_name                       text,
  manager_ids                      uuid[],
  manager_names                    text[],
  wells_completeness_pct           numeric,
  locators_completeness_pct        numeric,
  trains_completeness_pct          numeric,
  meters_completeness_pct          numeric,
  power_completeness_pct           numeric,
  chemicals_completeness_pct       numeric,
  overall_completeness_pct         numeric,
  readings_in_window               integer,
  flagged_in_window                integer,
  error_rate_pct                   numeric,
  unexplained_gaps_in_window       integer,
  open_pending_review_count        integer,
  open_pending_review_oldest_days  integer,
  open_correction_count            integer,
  open_correction_oldest_days      integer,
  status                           text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
-- RETURNS TABLE turns plant_id/status into PL/pgSQL variables visible
-- through the whole function body -- without this, every bare `plant_id`
-- or `status` column reference below (wells.plant_id, wells.status,
-- correction_requests.status, ...) is ambiguous against those OUT
-- parameters and the function fails at call time, not at CREATE time.
-- This pragma tells PL/pgSQL to resolve that ambiguity in favor of the
-- SQL column, which is what every reference in this function actually
-- means. (Confirmed by running this migration against a reconstructed
-- copy of this schema -- see the note at the bottom of this file.)
DECLARE
  v_caller      uuid := auth.uid();
  v_full_access boolean;
  v_days        integer;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'Invalid date range';
  END IF;

  -- Guards against an accidentally (or maliciously) huge range blowing up
  -- the generate_series x entity cross join below -- see "Performance"
  -- note further down.
  IF (p_to - p_from) > 366 THEN
    RAISE EXCEPTION 'Date range too large (max 366 days)';
  END IF;

  v_full_access := public.has_role(v_caller, 'Admin') OR public.has_role(v_caller, 'Data Analyst');

  IF NOT (v_full_access OR public.has_role(v_caller, 'Manager')) THEN
    RAISE EXCEPTION 'Not authorized to view the manager scorecard';
  END IF;

  v_days := (p_to - p_from) + 1;

  RETURN QUERY
  WITH visible_plants AS (
    -- Admin/Data Analyst: every plant. Manager: only plants they're
    -- actually assigned to -- this is the row-level check that would
    -- otherwise live in an RLS policy on a plain table.
    SELECT p.id, p.name
    FROM public.plants p
    WHERE v_full_access
       OR EXISTS (
            SELECT 1 FROM public.user_profiles up
            WHERE up.id = v_caller AND p.id = ANY(up.plant_assignments)
          )
  ),
  plant_managers AS (
    SELECT vp.id AS plant_id,
           array_agg(DISTINCT up.id)
             FILTER (WHERE up.id IS NOT NULL) AS manager_ids,
           array_agg(DISTINCT COALESCE(NULLIF(BTRIM(COALESCE(up.first_name, '') || ' ' || COALESCE(up.last_name, '')), ''), up.username))
             FILTER (WHERE up.id IS NOT NULL) AS manager_names
    FROM visible_plants vp
    LEFT JOIN public.user_profiles up
      ON vp.id = ANY(up.plant_assignments)
     AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = up.id AND ur.role = 'Manager')
    GROUP BY vp.id
  ),

  -- Active-entity pools -- same "Active" filter DataCompletenessRadarCard.tsx
  -- already uses for wells/locators/meters; ro_trains has no status filter
  -- there either (every train counts, Offline included), so this matches it
  -- exactly rather than inventing a stricter definition.
  well_pool    AS (SELECT id AS entity_id, plant_id FROM public.wells    WHERE status = 'Active'),
  locator_pool AS (SELECT id AS entity_id, plant_id FROM public.locators WHERE status = 'Active'),
  train_pool   AS (SELECT id AS entity_id, plant_id FROM public.ro_trains),
  meter_pool   AS (SELECT id AS entity_id, plant_id FROM public.product_meters WHERE status = 'Active'),

  well_pool_n    AS (SELECT plant_id, COUNT(*) AS n FROM well_pool    GROUP BY plant_id),
  locator_pool_n AS (SELECT plant_id, COUNT(*) AS n FROM locator_pool GROUP BY plant_id),
  train_pool_n   AS (SELECT plant_id, COUNT(*) AS n FROM train_pool   GROUP BY plant_id),
  meter_pool_n   AS (SELECT plant_id, COUNT(*) AS n FROM meter_pool   GROUP BY plant_id),

  -- Distinct (entity, day) pairs actually logged in the window.
  well_logged AS (
    SELECT DISTINCT well_id AS entity_id, plant_id, reading_datetime::date AS day
    FROM public.well_readings
    WHERE reading_datetime::date BETWEEN p_from AND p_to
  ),
  locator_logged AS (
    SELECT DISTINCT locator_id AS entity_id, plant_id, reading_datetime::date AS day
    FROM public.locator_readings
    WHERE reading_datetime::date BETWEEN p_from AND p_to
  ),
  train_logged AS (
    SELECT DISTINCT train_id AS entity_id, plant_id, reading_datetime::date AS day
    FROM public.ro_train_readings
    WHERE reading_datetime::date BETWEEN p_from AND p_to
  ),
  meter_logged AS (
    SELECT DISTINCT meter_id AS entity_id, plant_id, reading_datetime::date AS day
    FROM public.product_meter_readings
    WHERE reading_datetime::date BETWEEN p_from AND p_to
  ),
  well_logged_n    AS (SELECT plant_id, COUNT(*) AS n FROM well_logged    GROUP BY plant_id),
  locator_logged_n AS (SELECT plant_id, COUNT(*) AS n FROM locator_logged GROUP BY plant_id),
  train_logged_n   AS (SELECT plant_id, COUNT(*) AS n FROM train_logged   GROUP BY plant_id),
  meter_logged_n   AS (SELECT plant_id, COUNT(*) AS n FROM meter_logged   GROUP BY plant_id),

  -- Power and chemical dosing are logged at the plant level (one entry/day
  -- expected), not per-entity -- same distinction DataCompletenessRadarCard
  -- draws.
  power_logged_n AS (
    SELECT plant_id, COUNT(DISTINCT reading_datetime::date) AS n
    FROM public.power_readings
    WHERE reading_datetime::date BETWEEN p_from AND p_to
    GROUP BY plant_id
  ),
  chem_logged_n AS (
    SELECT plant_id, COUNT(DISTINCT log_datetime::date) AS n
    FROM public.chemical_dosing_logs
    WHERE log_datetime::date BETWEEN p_from AND p_to
    GROUP BY plant_id
  ),

  completeness AS (
    SELECT
      vp.id AS plant_id,
      -- NULL means "this plant has none of this entity type" (not
      -- applicable), distinct from 0 ("has them, nothing logged").
      -- Deliberately NOT written as LEAST(100, ratio-that-may-be-NULL):
      -- Postgres's LEAST/GREATEST skip NULL arguments rather than
      -- propagating them, so LEAST(100, NULL) evaluates to 100, not NULL
      -- -- that would have silently turned "no locators at this plant"
      -- into a false "100% complete." Confirmed by testing against a
      -- reconstructed copy of this schema; see the note at the bottom of
      -- this file.
      CASE WHEN COALESCE(wp.n, 0) = 0 THEN NULL
           ELSE LEAST(100, ROUND(100.0 * COALESCE(wl.n, 0) / (wp.n * v_days), 1)) END AS wells_pct,
      CASE WHEN COALESCE(lp.n, 0) = 0 THEN NULL
           ELSE LEAST(100, ROUND(100.0 * COALESCE(ll.n, 0) / (lp.n * v_days), 1)) END AS locators_pct,
      CASE WHEN COALESCE(tp.n, 0) = 0 THEN NULL
           ELSE LEAST(100, ROUND(100.0 * COALESCE(tl.n, 0) / (tp.n * v_days), 1)) END AS trains_pct,
      CASE WHEN COALESCE(mp.n, 0) = 0 THEN NULL
           ELSE LEAST(100, ROUND(100.0 * COALESCE(ml.n, 0) / (mp.n * v_days), 1)) END AS meters_pct,
      -- Power/chemical dosing are plant-level, not tied to an entity pool
      -- that could be zero, and v_days is already guaranteed >= 1 by the
      -- p_from/p_to validation above -- so these two never hit the same
      -- NULL-vs-0 ambiguity and don't need the CASE wrapper.
      LEAST(100, ROUND(100.0 * COALESCE(pl.n, 0) / v_days, 1)) AS power_pct,
      LEAST(100, ROUND(100.0 * COALESCE(cl.n, 0) / v_days, 1)) AS chemicals_pct
    FROM visible_plants vp
    LEFT JOIN well_pool_n    wp ON wp.plant_id = vp.id
    LEFT JOIN well_logged_n  wl ON wl.plant_id = vp.id
    LEFT JOIN locator_pool_n lp ON lp.plant_id = vp.id
    LEFT JOIN locator_logged_n ll ON ll.plant_id = vp.id
    LEFT JOIN train_pool_n   tp ON tp.plant_id = vp.id
    LEFT JOIN train_logged_n tl ON tl.plant_id = vp.id
    LEFT JOIN meter_pool_n   mp ON mp.plant_id = vp.id
    LEFT JOIN meter_logged_n ml ON ml.plant_id = vp.id
    LEFT JOIN power_logged_n pl ON pl.plant_id = vp.id
    LEFT JOIN chem_logged_n  cl ON cl.plant_id = vp.id
  ),

  -- Gap-day universe, wells/locators/RO trains only -- reading_gap_reasons'
  -- own CHECK constraint doesn't cover product meters, so this function
  -- doesn't claim to either.
  days AS (SELECT generate_series(p_from, p_to, interval '1 day')::date AS day),
  well_expected    AS (SELECT wp.entity_id, wp.plant_id, d.day FROM well_pool wp    CROSS JOIN days d),
  locator_expected AS (SELECT lp.entity_id, lp.plant_id, d.day FROM locator_pool lp CROSS JOIN days d),
  train_expected   AS (SELECT tp.entity_id, tp.plant_id, d.day FROM train_pool tp   CROSS JOIN days d),

  well_missing AS (
    SELECT we.* FROM well_expected we
    WHERE NOT EXISTS (SELECT 1 FROM well_logged wl WHERE wl.entity_id = we.entity_id AND wl.day = we.day)
  ),
  locator_missing AS (
    SELECT le.* FROM locator_expected le
    WHERE NOT EXISTS (SELECT 1 FROM locator_logged ll WHERE ll.entity_id = le.entity_id AND ll.day = le.day)
  ),
  train_missing AS (
    SELECT te.* FROM train_expected te
    WHERE NOT EXISTS (SELECT 1 FROM train_logged tl WHERE tl.entity_id = te.entity_id AND tl.day = te.day)
  ),

  -- "Unexplained" = missing a reading AND missing a reading_gap_reasons row
  -- for that same entity/day. This is the core "is anyone monitoring gaps"
  -- signal -- a gap with a reason logged means someone looked at it.
  gap_unexplained AS (
    SELECT wm.plant_id FROM well_missing wm
    WHERE NOT EXISTS (
      SELECT 1 FROM public.reading_gap_reasons g
      WHERE g.entity_type = 'well' AND g.entity_id = wm.entity_id AND g.gap_date = wm.day
    )
    UNION ALL
    SELECT lm.plant_id FROM locator_missing lm
    WHERE NOT EXISTS (
      SELECT 1 FROM public.reading_gap_reasons g
      WHERE g.entity_type = 'locator' AND g.entity_id = lm.entity_id AND g.gap_date = lm.day
    )
    UNION ALL
    SELECT tm.plant_id FROM train_missing tm
    WHERE NOT EXISTS (
      SELECT 1 FROM public.reading_gap_reasons g
      WHERE g.entity_type = 'ro_train' AND g.entity_id = tm.entity_id AND g.gap_date = tm.day
    )
  ),
  gap_agg AS (
    SELECT plant_id, COUNT(*)::int AS unexplained_gap_count
    FROM gap_unexplained
    GROUP BY plant_id
  ),

  -- Error rate: any reading touched by the normalization workflow
  -- (norm_status <> 'normal') within the window, over total readings taken
  -- in the window.
  readings_window AS (
    SELECT plant_id, norm_status FROM public.well_readings         WHERE reading_datetime::date BETWEEN p_from AND p_to
    UNION ALL
    SELECT plant_id, norm_status FROM public.locator_readings      WHERE reading_datetime::date BETWEEN p_from AND p_to
    UNION ALL
    SELECT plant_id, norm_status FROM public.ro_train_readings     WHERE reading_datetime::date BETWEEN p_from AND p_to
    UNION ALL
    SELECT plant_id, norm_status FROM public.product_meter_readings WHERE reading_datetime::date BETWEEN p_from AND p_to
  ),
  readings_agg AS (
    SELECT plant_id,
           COUNT(*)::int AS readings_n,
           COUNT(*) FILTER (WHERE norm_status <> 'normal')::int AS flagged_n
    FROM readings_window
    GROUP BY plant_id
  ),

  -- CURRENT open backlog (not window-scoped -- see header note). day here
  -- is reading_datetime, used as an approximate stand-in for "flagged
  -- since" -- there's no separate flagged_at timestamp on these tables, so
  -- this slightly overstates age for anything flagged well after ingestion
  -- (e.g. a later HAMAS sweep). Good enough for a first cut; a real
  -- flagged_at column would make this exact.
  open_reviews AS (
    SELECT plant_id, reading_datetime::date AS day FROM public.well_readings          WHERE norm_status = 'pending_review'
    UNION ALL
    SELECT plant_id, reading_datetime::date          FROM public.locator_readings      WHERE norm_status = 'pending_review'
    UNION ALL
    SELECT plant_id, reading_datetime::date          FROM public.ro_train_readings     WHERE norm_status = 'pending_review'
    UNION ALL
    SELECT plant_id, reading_datetime::date          FROM public.product_meter_readings WHERE norm_status = 'pending_review'
  ),
  open_reviews_agg AS (
    SELECT plant_id, COUNT(*)::int AS n, (CURRENT_DATE - MIN(day)) AS oldest_days
    FROM open_reviews
    GROUP BY plant_id
  ),

  -- Operator-submitted correction requests still awaiting Manager/Admin
  -- action. created_at here is a real "when was this raised" timestamp
  -- (unlike open_reviews' approximation above), so oldest_days is exact.
  open_corrections_agg AS (
    SELECT plant_id, COUNT(*)::int AS n, (CURRENT_DATE - MIN(created_at::date)) AS oldest_days
    FROM public.correction_requests
    WHERE status = 'pending'
    GROUP BY plant_id
  ),

  base AS (
    SELECT
      vp.id                                          AS plant_id,
      vp.name                                        AS plant_name,
      COALESCE(pm.manager_ids, '{}'::uuid[])          AS manager_ids,
      COALESCE(pm.manager_names, '{}'::text[])        AS manager_names,
      c.wells_pct, c.locators_pct, c.trains_pct, c.meters_pct, c.power_pct, c.chemicals_pct,
      ROUND(
        (COALESCE(c.wells_pct, 0) + COALESCE(c.locators_pct, 0) + COALESCE(c.trains_pct, 0)
         + COALESCE(c.meters_pct, 0) + COALESCE(c.power_pct, 0) + COALESCE(c.chemicals_pct, 0))
        / NULLIF(
            (CASE WHEN c.wells_pct IS NOT NULL THEN 1 ELSE 0 END) +
            (CASE WHEN c.locators_pct IS NOT NULL THEN 1 ELSE 0 END) +
            (CASE WHEN c.trains_pct IS NOT NULL THEN 1 ELSE 0 END) +
            (CASE WHEN c.meters_pct IS NOT NULL THEN 1 ELSE 0 END) +
            (CASE WHEN c.power_pct IS NOT NULL THEN 1 ELSE 0 END) +
            (CASE WHEN c.chemicals_pct IS NOT NULL THEN 1 ELSE 0 END),
            0)
      , 1)                                            AS overall_completeness_pct,
      COALESCE(ra.readings_n, 0)                      AS readings_in_window,
      COALESCE(ra.flagged_n, 0)                       AS flagged_in_window,
      ROUND(100.0 * COALESCE(ra.flagged_n, 0) / NULLIF(ra.readings_n, 0), 1) AS error_rate_pct,
      COALESCE(ga.unexplained_gap_count, 0)           AS unexplained_gaps_in_window,
      COALESCE(ora.n, 0)                              AS open_pending_review_count,
      COALESCE(ora.oldest_days, 0)                    AS open_pending_review_oldest_days,
      COALESCE(oca.n, 0)                               AS open_correction_count,
      COALESCE(oca.oldest_days, 0)                     AS open_correction_oldest_days
    FROM visible_plants vp
    LEFT JOIN plant_managers      pm  ON pm.plant_id = vp.id
    LEFT JOIN completeness        c   ON c.plant_id = vp.id
    LEFT JOIN gap_agg             ga  ON ga.plant_id = vp.id
    LEFT JOIN readings_agg        ra  ON ra.plant_id = vp.id
    LEFT JOIN open_reviews_agg    ora ON ora.plant_id = vp.id
    LEFT JOIN open_corrections_agg oca ON oca.plant_id = vp.id
  )
  SELECT
    b.plant_id,
    b.plant_name,
    b.manager_ids,
    b.manager_names,
    b.wells_pct,
    b.locators_pct,
    b.trains_pct,
    b.meters_pct,
    b.power_pct,
    b.chemicals_pct,
    b.overall_completeness_pct,
    b.readings_in_window,
    b.flagged_in_window,
    b.error_rate_pct,
    b.unexplained_gaps_in_window,
    b.open_pending_review_count,
    b.open_pending_review_oldest_days,
    b.open_correction_count,
    b.open_correction_oldest_days,
    -- Tunable thresholds -- 5 days / 80% picked as reasonable v1 defaults,
    -- not derived from anything in this repo. Easiest place to adjust once
    -- there's real data to calibrate against.
    CASE
      WHEN array_length(b.manager_ids, 1) IS NULL THEN 'unmonitored'
      WHEN b.open_pending_review_oldest_days > 5
        OR b.open_correction_oldest_days > 5
        OR COALESCE(b.overall_completeness_pct, 0) < 80
        THEN 'at_risk'
      WHEN b.unexplained_gaps_in_window > 0
        OR b.open_pending_review_count > 0
        OR b.open_correction_count > 0
        THEN 'watch'
      ELSE 'good'
    END AS status
  FROM base b
  ORDER BY b.plant_name;
END;
$$;

-- No PUBLIC execute -- authenticated only, then the function's own role
-- check narrows it further to Admin / Data Analyst / Manager. Existing
-- functions in this repo (fn_cascade_reading_correction) rely solely on the
-- internal check without an explicit REVOKE; adding it here too as
-- defense-in-depth costs nothing.
REVOKE ALL ON FUNCTION public.fn_manager_plant_scorecard(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_manager_plant_scorecard(date, date) TO authenticated;

COMMENT ON FUNCTION public.fn_manager_plant_scorecard(date, date) IS
  'Per-plant data-quality oversight rollup (completeness, unexplained gaps, '
  'flagged/error rate, open corrections) attributed to each plant''s '
  'assigned Manager(s). Admin/Data Analyst see all plants; Manager sees '
  'only their own plant_assignments. Call via '
  'supabase.rpc(''fn_manager_plant_scorecard'', { p_from, p_to }).';

-- ── Known limitations (v1) ───────────────────────────────────────────────────
-- 1. Every pool/logged CTE above scans all plants before visible_plants
--    filters the final output -- fine at this org's current plant count,
--    but if that grows a lot, push `WHERE plant_id IN (SELECT id FROM
--    visible_plants)` into each CTE instead of filtering at the join.
-- 2. open_pending_review_oldest_days uses reading_datetime as a stand-in
--    for "flagged since" (see comment above open_reviews). Add a real
--    flagged_at timestamp to the reading tables' pending_review path for
--    an exact figure.
-- 3. open_correction_count / open_correction_oldest_days depend on
--    correction_requests' current shape (plant_id, status, created_at),
--    unverified against a migration -- see the header note.
-- 4. No history: open_* columns are "as of now" every time this is called.
--    Snapshotting (compliance_snapshots' pattern) is the natural next step
--    if you want a trend line rather than a live-only view.

-- <<<<<<< END ARCHIVED: 20260807000002_manager_plant_scorecard.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260807000003_power_meter_change_required_fields.sql >>>>>>>
-- =============================================================================
-- Migration: 20260807_power_meter_change_required_fields.sql
--
-- Brings power meter replacement in line with the well / locator / product /
-- RO-train pattern from 20260727_meter_replacement_wiring.sql. Until now,
-- power_meter_changes only recorded the CT multiplier change (old_multiplier /
-- new_multiplier) — there was nowhere to record what the OLD physical meter
-- last read and what the NEW physical meter started at.
--
-- Adds:
--   old_meter_final_reading    — cumulative kWh the old meter last read
--   new_meter_initial_reading  — cumulative kWh the new meter read at install
--                                 (this becomes meter_reading_kwh on the
--                                 swap-point power_readings row instead of
--                                 blindly carrying the old value forward)
--   reading_id                 — links back to the specific power_readings row
--                                 the swap produced (new-swap flow) or the
--                                 existing row a post-hoc edit flags (matches
--                                 well_meter_replacements.reading_id /
--                                 locator_meter_replacements.reading_id /
--                                 product_meter_replacements.reading_id).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.power_meter_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id UUID NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  meter_index INTEGER NOT NULL DEFAULT 0,
  old_multiplier NUMERIC NOT NULL DEFAULT 1,
  new_multiplier NUMERIC NOT NULL DEFAULT 1,
  change_date DATE NOT NULL DEFAULT CURRENT_DATE,
  changed_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.power_meter_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "power_meter_changes_plant_access" ON public.power_meter_changes;
CREATE POLICY "power_meter_changes_plant_access" ON public.power_meter_changes
  FOR ALL TO authenticated
  USING (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

ALTER TABLE public.power_meter_changes
  ADD COLUMN IF NOT EXISTS old_meter_final_reading   NUMERIC,
  ADD COLUMN IF NOT EXISTS new_meter_initial_reading NUMERIC,
  ADD COLUMN IF NOT EXISTS reading_id UUID REFERENCES public.power_readings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_power_meter_changes_reading_id
  ON public.power_meter_changes(reading_id);

COMMENT ON COLUMN public.power_meter_changes.old_meter_final_reading IS
  'Cumulative kWh the OLD physical meter last read before it was swapped out. Required in the UI.';
COMMENT ON COLUMN public.power_meter_changes.new_meter_initial_reading IS
  'Cumulative kWh the NEW physical meter read at install. Required in the UI; becomes meter_reading_kwh on the swap-point power_readings row.';
COMMENT ON COLUMN public.power_meter_changes.reading_id IS
  'The power_readings row this change produced (live swap) or was retroactively flagged against (history edit).';

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260807000003_power_meter_change_required_fields.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260807000004_reading_anomaly_remarks.sql >>>>>>>
-- =============================================================================
-- Migration: 20260807_reading_anomaly_remarks.sql
-- Run this in: Supabase Dashboard -> SQL Editor
--
-- Part of the flow-rate-based anomaly detection unification (see
-- frontend/src/lib/flowRateGuards.ts for the shared classification logic
-- this table supports).
--
-- Every odometer input (locator/well/product/blending, power, RO train
-- feed/permeate/reject) is now classified against its own rolling-average
-- FLOW RATE (volume or kWh per hour/day), not the raw delta -- a raw delta
-- has a direct relationship with the elapsed time between readings, so it
-- was never a fair "is this normal" comparison whenever a date had no
-- reading. See roReadingGuards.ts / readingGuards.ts for the classification
-- callers.
--
-- Two tiers, both computed from the same rolling average:
--   - "needs_remark": outside the +-50% band around the average rate.
--     Save is blocked client-side until the operator types a remark
--     explaining the reading (own field knowledge -- pump down, meter
--     replaced, unusually high demand, etc.). This is new; nothing in the
--     app previously required an explanation for an out-of-band reading.
--   - "critical": beyond the stricter per-meter-type spike multiplier that
--     already existed (ALERTS.avg_multiplier_warn / power_spike_multiplier /
--     ro_meter_spike_multiplier -- deliberately NOT unified to one number,
--     since different meter types have different natural variance; only the
--     methodology, message format, and remark requirement are unified).
--     Same remark requirement, PLUS the existing pending_review /
--     supervisor-alert behaviour still fires exactly as before.
--
-- This table captures the "needs_remark" / "critical" remark itself, mirroring
-- the table_name + record_id pattern already used by reading_edit_audit_log
-- (NOT the entity_type + entity_id + gap_date pattern used by
-- reading_gap_reasons, which is about missing readings, not the anomaly on a
-- reading that *was* taken).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.reading_anomaly_remarks (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which saved reading this remark explains. table_name mirrors the
  -- constraint list already used by reading_edit_audit_log, extended with
  -- product_meter_readings (the one reading table that audit log doesn't
  -- cover yet).
  table_name      TEXT        NOT NULL CHECK (table_name IN (
                                'locator_readings',
                                'well_readings',
                                'product_meter_readings',
                                'blending_events',
                                'power_readings',
                                'ro_train_readings'
                              )),
  record_id       UUID        NOT NULL,

  -- ro_train_readings carries three independent meters (feed/permeate/
  -- reject) per row, any subset of which can individually be out-of-band --
  -- NULL for every other table_name, where one row = one meter.
  meter_kind      TEXT        CHECK (meter_kind IN ('feed', 'permeate', 'reject')),

  plant_id        UUID        NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,

  tier            TEXT        NOT NULL CHECK (tier IN ('needs_remark', 'critical')),
  direction       TEXT        NOT NULL CHECK (direction IN ('high', 'low')),
  deviation_pct   NUMERIC     NOT NULL,

  -- Snapshot of the numbers the operator actually saw, so a later audit
  -- doesn't have to reconstruct "what was the average at the time" from a
  -- rolling window that has since moved on.
  flow_rate       NUMERIC,
  avg_flow_rate   NUMERIC,
  rate_unit       TEXT        NOT NULL DEFAULT 'm3/hr' CHECK (rate_unit IN ('m3/hr', 'm3/day', 'kwh/hr')),

  remark_text     TEXT        NOT NULL CHECK (char_length(btrim(remark_text)) > 0),

  logged_by       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  logged_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reading_anomaly_remarks_record
  ON public.reading_anomaly_remarks (table_name, record_id);

CREATE INDEX IF NOT EXISTS idx_reading_anomaly_remarks_plant
  ON public.reading_anomaly_remarks (plant_id, logged_at DESC);

ALTER TABLE public.reading_anomaly_remarks ENABLE ROW LEVEL SECURITY;

-- Any authenticated user with access to the plant may read -- these are
-- meant to surface on the Dashboard / reading history alongside the reading
-- itself, not just to managers.
DROP POLICY IF EXISTS "reading_anomaly_remarks_read" ON public.reading_anomaly_remarks;
CREATE POLICY "reading_anomaly_remarks_read" ON public.reading_anomaly_remarks
  FOR SELECT TO authenticated
  USING (public.user_has_plant_access(plant_id));

-- Operators write their own remarks at save time -- not manager-gated,
-- since it's the field operator who has the explanation, exactly like
-- reading_gap_reasons.
DROP POLICY IF EXISTS "reading_anomaly_remarks_insert" ON public.reading_anomaly_remarks;
CREATE POLICY "reading_anomaly_remarks_insert" ON public.reading_anomaly_remarks
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_plant_access(plant_id));

-- Immutable audit-style record: no UPDATE/DELETE policy -> denied by default.

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260807000004_reading_anomaly_remarks.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260807000005_ro_trains_booster_pump_targets.sql >>>>>>>
-- Booster pump targets have the same "retyped every reading" problem
-- hpp_target_pressure_psi had (20260807_ro_trains_hpp_target_pressure_
-- setpoint.sql) -- confirmed while building that fix and flagged as a
-- separate follow-up rather than folded in, since a train can have multiple
-- booster pumps and each pump's target is entered in one of two mutually
-- exclusive modes (psi or Hz, toggled per train, not per pump -- the reading
-- form's "Target psi/Hz" toggle already applies to every pump on the train
-- at once via setGlobalMode, so the config shape below matches that: one
-- mode for the whole train, one target value per pump).
--
-- Amperage is NOT part of this -- that's a genuine per-reading measurement
-- (the pump's actual current draw, which varies with load/wear), not a
-- setpoint. Only target/Hz move to config; amp stays exactly as it was,
-- entered fresh on every reading.
--
-- JSONB rather than fixed columns because num_booster_pumps varies per
-- train (0 to N) -- a fixed set of booster_pump_1_target/2_target/... columns
-- would need a schema change every time a train configuration needs more
-- pumps than any train has needed so far. Shape:
--   { "psi_mode": true, "targets": { "1": 45, "2": 50 } }
-- targets is keyed by pump unit number as a string (JSONB object keys are
-- always strings); a unit with no entry (or the whole column null) falls
-- back to the reading form's current fully-editable behavior for that pump,
-- same graceful-degradation approach as the HPP fix -- no train breaks for
-- not having this configured.

ALTER TABLE public.ro_trains
  ADD COLUMN IF NOT EXISTS booster_pump_targets JSONB;

COMMENT ON COLUMN public.ro_trains.booster_pump_targets IS
  'Per-pump target setpoints for this train''s booster pumps, configured once in Train Settings. Shape: {"psi_mode": bool, "targets": {"<unit>": number}}. Auto-fills and locks the corresponding psi/Hz field on every pre-treatment/RO reading; amperage stays per-reading (a real measurement, not a setpoint). A unit missing from targets, or a null column, falls back to the fully-editable per-reading input.';

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260807000005_ro_trains_booster_pump_targets.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260807000006_ro_trains_hpp_target_pressure_setpoint.sql >>>>>>>
-- Roadmap §5: HPP target pressure was only ever a per-reading field
-- (ro_pretreatment_readings.hpp_target_pressure_psi), meaning an operator
-- retyped the exact same number on every single log entry -- the target
-- pressure a High-Pressure Pump is set to is a slow-changing equipment
-- setpoint, not something that varies reading to reading. A typo on any one
-- entry looked like a real target change in historical data when it was
-- just repeated manual entry.
--
-- Adds it to ro_trains as a per-train config value, configured once in
-- Train Settings (EditTrainDialog in TrainDetail.tsx) alongside num_hp_pumps
-- and the other train-level fields already there. Nullable, no default --
-- existing trains simply have it unset until a Manager/Admin fills it in;
-- the reading-entry form (PretreatmentAndROLog.tsx) falls back to its old
-- fully-editable-input behavior for any train where this is still null, so
-- nothing breaks for trains that haven't been configured yet.
--
-- ro_pretreatment_readings.hpp_target_pressure_psi is kept as-is, not
-- dropped -- once a train has this configured, the reading form auto-fills
-- and submits the train's value on every reading, so the readings table
-- still carries a per-reading historical record of what the target was at
-- that time (useful if the target itself is later changed), it's just no
-- longer manually retyped.

ALTER TABLE public.ro_trains
  ADD COLUMN IF NOT EXISTS hpp_target_pressure_psi NUMERIC;

COMMENT ON COLUMN public.ro_trains.hpp_target_pressure_psi IS
  'High-Pressure Pump target operating pressure (psi), configured once per train in Train Settings. Auto-fills the HPP Target Pressure field on every pre-treatment/RO reading for this train until changed here.';

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260807000006_ro_trains_hpp_target_pressure_setpoint.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260808000001_hamas_phase13_repair_mirror_resync_corruption.sql >>>>>>>
-- =============================================================================
-- Migration: hamas_phase13_repair_mirror_resync_corruption
-- Applied 2026-08-08.
--
-- ROOT CAUSE (frontend — not covered by phases 0-12, which were all
-- backend/SQL):
--   ProductSection.tsx's ProductMeterHistoryDialog has a client-side
--   resyncMeterChain() helper that walks every product_meter_readings row
--   for a meter in chronological order and recomputes:
--     previous_reading = the PRIOR row's raw current_reading
--     daily_volume      = GREATEST(0, current_reading - previous_reading)
--   That's the right model for a normal, monotonically-increasing cumulative
--   meter, but is_derived (mirrored) meters — e.g. Mambaling's "HAMAS",
--   mirrored from SRP's derived "HAMAS (Mambaling)" locator — don't work
--   that way: fn_sweep_derived_meters_for_date() (phase11/phase12) writes
--   each day's own volume directly into current_reading and pins
--   previous_reading at 0, so consecutive rows are independent, not
--   cumulative. resyncMeterChain never checked meter.is_derived, so any
--   edit, delete, or "mark as meter replacement" toggle on this dialog
--   re-walked the whole history as if it were cumulative and clobbered
--   daily_volume back down to ~0 for nearly every day — while SRP's own
--   derived locator kept computing correctly the whole time, because
--   locator_readings.daily_volume is a GENERATED column resyncMeterChain
--   never touches. This is why HAMAS (SRP) and HAMAS (Mambaling) diverged:
--   the sweep's mirror write was always correct, this resync silently
--   overwrote it afterwards. The matching frontend fix guards
--   resyncMeterChain (and saveEdit) against is_derived meters so this can't
--   recur.
--
-- FIX (this migration):
--   One-time data repair, not a new code path. For every is_derived locator,
--   re-derive its mirror product_meter_readings rows directly from the
--   (never-corrupted) locator_readings rows, matched by calendar day in
--   Asia/Manila. This is a straight copy, not a recompute — it's guaranteed
--   to leave every mirror row exactly equal to its source locator for every
--   day that's ever been swept, which is the whole point of the mirror
--   (HAMAS (SRP) = HAMAS (Mambaling)).
--
-- Idempotent: only writes a row when its stored values actually differ from
-- the source locator's; re-running after a successful repair is a no-op and
-- reports 0 rows changed.
-- =============================================================================

DO $$
DECLARE
  r_loc          RECORD;
  r_lr           RECORD;
  v_mirror       RECORD;
  v_day_start    timestamptz;
  v_day_end      timestamptz;
  -- Scalar (not RECORD) OUT targets for the existence-check SELECT below —
  -- a bare RECORD variable that's never yet been assigned a row raises
  -- "record ... is not assigned yet" the first time a zero-row SELECT INTO
  -- hits it, which a plain first lookup easily could. Scalars just come back
  -- NULL, no gotcha, matching how phase12's fn_sweep_derived_meters_for_date
  -- already does this same existence check (v_lr_id / v_old_daily_vol).
  v_mirror_id        uuid;
  v_mirror_cur       numeric;
  v_mirror_prev      numeric;
  v_mirror_vol       numeric;
  v_mirror_estimated boolean;
  v_checked      integer := 0;
  v_changed      integer := 0;
  v_inserted     integer := 0;
BEGIN
  FOR r_loc IN
    SELECT id, name FROM public.locators WHERE is_derived = true
  LOOP
    FOR r_lr IN
      SELECT reading_datetime, daily_volume, is_estimated
      FROM public.locator_readings
      WHERE locator_id = r_loc.id
      ORDER BY reading_datetime
    LOOP
      -- Calendar-day bounds in Asia/Manila, same convention
      -- fn_sweep_derived_meters_for_date() uses for v_day_start/v_day_end.
      v_day_start := date_trunc('day', r_lr.reading_datetime AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila';
      v_day_end   := v_day_start + interval '1 day';

      FOR v_mirror IN
        SELECT id, plant_id FROM public.product_meters
        WHERE derived_from_locator_id = r_loc.id AND is_derived = true
      LOOP
        v_checked := v_checked + 1;

        SELECT id, current_reading, previous_reading, daily_volume, is_estimated
          INTO v_mirror_id, v_mirror_cur, v_mirror_prev, v_mirror_vol, v_mirror_estimated
        FROM public.product_meter_readings
        WHERE meter_id = v_mirror.id
          AND reading_datetime >= v_day_start AND reading_datetime < v_day_end
        ORDER BY reading_datetime DESC LIMIT 1;

        IF v_mirror_id IS NOT NULL THEN
          IF v_mirror_cur  IS DISTINCT FROM r_lr.daily_volume
          OR v_mirror_prev IS DISTINCT FROM 0
          OR v_mirror_vol  IS DISTINCT FROM r_lr.daily_volume THEN
            UPDATE public.product_meter_readings
            SET current_reading  = r_lr.daily_volume,
                previous_reading = 0,
                daily_volume     = r_lr.daily_volume,
                is_estimated     = r_lr.is_estimated
            WHERE id = v_mirror_id;
            v_changed := v_changed + 1;
          END IF;
        ELSE
          -- Source locator has a reading for this day but the mirror never
          -- got one at all (e.g. the derived_from_locator_id link was added
          -- after that day's sweep, or the row was deleted outright).
          INSERT INTO public.product_meter_readings
            (meter_id, plant_id, reading_datetime, current_reading, previous_reading, daily_volume, is_estimated)
          VALUES
            (v_mirror.id, v_mirror.plant_id, r_lr.reading_datetime, r_lr.daily_volume, 0, r_lr.daily_volume, r_lr.is_estimated);
          v_inserted := v_inserted + 1;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'hamas_phase13: checked % mirror-day pairs, repaired % existing rows, inserted % missing rows',
    v_checked, v_changed, v_inserted;
END $$;

-- <<<<<<< END ARCHIVED: 20260808000001_hamas_phase13_repair_mirror_resync_corruption.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260808000002_custom_roles.sql >>>>>>>
-- =============================================================================
-- Migration: 20260808_custom_roles.sql
-- Custom role editor: lets an Admin create a NAMED role (e.g. "Plant
-- supervisor") that starts as a copy of one of the five system roles
-- (Operator/Technician/Manager/Data Analyst/Admin) and overrides individual
-- module permissions from there.
--
-- Design choice: a custom role does NOT get its own value in the app_role
-- enum, and does NOT change how any of the ~34 existing RLS policies work.
-- Every user assigned a custom role still carries a normal user_roles row
-- keyed to that role's base_role, so every Postgres-level security check in
-- this schema (is_admin(), is_manager_or_admin(), has_role(), etc.) keeps
-- working unchanged. custom_role_id is purely an additional pointer the
-- frontend uses to compute which modules to show/hide and which buttons to
-- enable — see frontend/src/lib/permissions.ts (effectivePermission()) and
-- frontend/src/pages/admin/RolesPanel.tsx.
--
-- Adds:
--   1. custom_roles              — id, name, base_role, description
--   2. custom_role_overrides     — sparse (module_key, action, allowed) rows;
--                                   only rows that differ from the base
--                                   role's PERMISSION_MATRIX default exist
--   3. user_roles.custom_role_id — nullable pointer, set alongside the
--                                   existing `role` column when an admin
--                                   assigns someone a custom role
--   4. A guard trigger blocking overrides on admin_users / admin_migrations
--      — mirrors "Admin console access can only be granted to the Admin
--      role, to prevent accidental lockout" so a direct API/SQL write can't
--      bypass what the UI already greys out.
-- =============================================================================

-- ── 1. custom_roles ──────────────────────────────────────────────────────────
CREATE TABLE public.custom_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  base_role   public.app_role NOT NULL,
  description TEXT,
  created_by  UUID REFERENCES public.user_profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_custom_roles_updated BEFORE UPDATE ON public.custom_roles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.custom_roles IS
  'Named permission presets an Admin builds on top of a system role '
  '(base_role). Does not participate in RLS directly — see migration header.';

-- ── 2. custom_role_overrides ─────────────────────────────────────────────────
-- Sparse by design: a row only exists where the custom role's effective
-- permission differs from PERMISSION_MATRIX[base_role][module_key][action].
-- Keeping it sparse is what makes "3 overrides from base" a simple COUNT(*).
CREATE TABLE public.custom_role_overrides (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  custom_role_id UUID NOT NULL REFERENCES public.custom_roles(id) ON DELETE CASCADE,
  module_key     TEXT NOT NULL,
  action         TEXT NOT NULL CHECK (action IN ('view','edit','budget','delete')),
  allowed        BOOLEAN NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (custom_role_id, module_key, action)
);
CREATE INDEX idx_custom_role_overrides_role ON public.custom_role_overrides(custom_role_id);

-- ── 3. Guard: admin_users / admin_migrations can never be overridden ────────
-- Matches PERMISSION_MATRIX's admin_users/admin_migrations entries (Admin
-- only) and REDIRECTS in frontend/src/lib/permissions.ts. Defense-in-depth:
-- the RolesPanel UI already disables these rows, this makes it a hard rule.
CREATE OR REPLACE FUNCTION public.fn_guard_custom_role_override()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.module_key IN ('admin_users', 'admin_migrations') THEN
    RAISE EXCEPTION
      'admin_users and admin_migrations cannot be overridden by a custom role (Admin-only, to prevent accidental lockout)';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_guard_custom_role_override
  BEFORE INSERT OR UPDATE ON public.custom_role_overrides
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_custom_role_override();

-- ── 4. user_roles gets a pointer to the custom role (if any) ────────────────
ALTER TABLE public.user_roles
  ADD COLUMN custom_role_id UUID REFERENCES public.custom_roles(id) ON DELETE SET NULL;

CREATE INDEX idx_user_roles_custom_role ON public.user_roles(custom_role_id) WHERE custom_role_id IS NOT NULL;

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.custom_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_role_overrides ENABLE ROW LEVEL SECURITY;

-- Every signed-in user can read role definitions — needed to compute their
-- own effective permissions client-side. Same trust model as
-- PERMISSION_MATRIX already being shipped in the JS bundle today.
CREATE POLICY custom_roles_select ON public.custom_roles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY custom_role_overrides_select ON public.custom_role_overrides
  FOR SELECT TO authenticated USING (true);

-- Only Admin may create, rename, re-base, or delete custom roles, and only
-- Admin may add/change/remove overrides.
CREATE POLICY custom_roles_admin_write ON public.custom_roles
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY custom_role_overrides_admin_write ON public.custom_role_overrides
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- ── Known limitations (v1) ───────────────────────────────────────────────────
-- 1. A user can only hold one custom_role_id at a time (it lives on the same
--    user_roles row as their base role, and RoleSelector-style UIs replace
--    that row wholesale). Fine today since the app already treats "primary
--    role" as singular everywhere (see primaryRole() in UsersPanel.tsx).
-- 2. Per-plant scoping and the Data-Analyst-only REDIRECTS behavior are
--    still governed entirely by frontend/src/lib/permissions.ts, same as
--    before this migration — this only adds the override layer on top.
-- 3. No history/audit trail on override changes yet. If that's needed,
--    reading_edit_audit_log's pattern (table_name/record_id/old/new jsonb)
--    is the natural fit — add 'custom_role_overrides' to its CHECK
--    constraint the same way 20260727_hamas_phase0_roles_and_audit.sql did
--    for locator_readings.

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260808000002_custom_roles.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260809000001_hamas_phase15_derived_locators_skip_generic_spike.sql >>>>>>>
-- =============================================================================
-- Migration: hamas_phase15_derived_locators_skip_generic_spike
--
-- Context: derived, direct-mode locators (locators.is_derived = true, e.g.
-- HAMAS) get their daily value written by fn_sweep_derived_meters_for_date(),
-- not by an operator. fn_locator_reading_integrity's direct-mode branch
-- (phase9) applies the same ">2x trailing 7-day average" spike check to this
-- swept output as it does to operator-entered direct-mode readings, which
-- routes normal sweep results into the same Pending Review queue operators
-- use — with no way to tell, from that queue, that the row was never
-- human-entered in the first place.
--
-- Derived locators already have a purpose-built review path:
-- locator_derived_review_flags / fn_flag_derived_review() (phase3), which
-- opens a flag specifically when a sibling locator or the mother meter was
-- edited in a way that could change this locator's residual — surfaced via
-- fn_notify_derived_review(). That mechanism is scoped to the actual risk
-- (an upstream edit), rather than to the resulting number's size, so it
-- doesn't fire on a legitimate large-but-correct swing (e.g. after a long
-- gap in siblings is backfilled) the way the generic spike check does.
--
-- Change: skip the generic >2x spike flag when NEW's locator is derived.
-- Sweep output for derived locators is now always written norm_status =
-- 'normal' by this trigger; any review need is carried entirely by
-- locator_derived_review_flags/fn_flag_derived_review(), not by landing in
-- Pending Review.
--
-- Trade-off, on purpose left as-is rather than "fixed" further: this does
-- remove the safety net that has, in practice, been catching bugs in the
-- sweep pipeline itself (phases 6/8/9/10/11/12/13/14 were all fixes to that
-- pipeline, several same-day). If sweep bugs are still active, consider
-- holding off on this migration, or additionally hardening
-- fn_flag_derived_review()/the sweep function's own internal checks before
-- removing this net. Revert by re-running phase9's CREATE OR REPLACE if
-- needed — this migration only adds the is_derived branch on top of it.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_locator_reading_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev_reading    NUMERIC;
  v_prev_dt         TIMESTAMPTZ;
  v_computed_vol    NUMERIC;
  v_hours_elapsed   NUMERIC;
  v_flow_rate       NUMERIC;
  v_avg_flow_rate   NUMERIC;
  v_input_mode      TEXT;
  v_is_derived      BOOLEAN;
BEGIN
  SELECT default_input_mode, is_derived
  INTO   v_input_mode, v_is_derived
  FROM   locators
  WHERE  id = NEW.locator_id;
  v_input_mode := COALESCE(v_input_mode, 'raw');
  v_is_derived := COALESCE(v_is_derived, FALSE);

  SELECT current_reading, reading_datetime
  INTO   v_prev_reading, v_prev_dt
  FROM   locator_readings
  WHERE  locator_id   = NEW.locator_id
    AND  plant_id     = NEW.plant_id
    AND  norm_status NOT IN ('retracted', 'pending_review')
    AND  reading_datetime < NEW.reading_datetime
    AND  id IS DISTINCT FROM NEW.id
  ORDER  BY reading_datetime DESC
  LIMIT  1;

  -- Only raw (cumulative-meter) locators get previous_reading derived from
  -- the chronological predecessor. Direct-mode locators (current_reading IS
  -- the period volume) keep whatever the caller set.
  IF v_input_mode <> 'direct' THEN
    NEW.previous_reading := v_prev_reading;
  END IF;

  IF v_input_mode = 'direct' THEN
    -- Derived locators (HAMAS-style): review need is already carried by
    -- locator_derived_review_flags / fn_flag_derived_review(), keyed to the
    -- actual upstream edit rather than the resulting number's size. Skip
    -- the generic spike check so a legitimate large swing doesn't land in
    -- the operator-facing Pending Review queue with no indication it was
    -- machine-generated.
    IF v_is_derived THEN
      RETURN NEW;
    END IF;

    IF NEW.current_reading > 0 AND NEW.norm_status = 'normal' THEN
      SELECT AVG(sub.vol) INTO v_avg_flow_rate
      FROM (
        SELECT current_reading AS vol
        FROM   locator_readings
        WHERE  locator_id = NEW.locator_id
          AND  plant_id   = NEW.plant_id
          AND  norm_status = 'normal'
          AND  reading_datetime >= NOW() - INTERVAL '7 days'
          AND  reading_datetime < NEW.reading_datetime
      ) sub;

      IF v_avg_flow_rate IS NOT NULL
         AND v_avg_flow_rate > 0
         AND NEW.current_reading > v_avg_flow_rate * 2.0
      THEN
        NEW.norm_status := 'pending_review';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  -- RAW MODE (unchanged) — backward-reading check
  v_computed_vol := NEW.current_reading - COALESCE(v_prev_reading, NEW.current_reading);

  IF v_computed_vol < 0
     AND COALESCE(NEW.is_meter_replacement, FALSE) = FALSE
     AND COALESCE(NEW.is_estimated, FALSE)         = FALSE
     AND NEW.norm_status = 'normal'
  THEN
    NEW.norm_status := 'pending_review';
    RETURN NEW;
  END IF;

  -- Spike detection — flow rate > 2x 7-day average
  IF v_prev_dt IS NOT NULL AND v_computed_vol > 0 THEN
    v_hours_elapsed := EXTRACT(EPOCH FROM (NEW.reading_datetime - v_prev_dt)) / 3600.0;

    IF v_hours_elapsed > 0 THEN
      v_flow_rate := v_computed_vol / v_hours_elapsed;

      SELECT AVG(sub.flow_rate)
      INTO   v_avg_flow_rate
      FROM (
        SELECT (current_reading - previous_reading)
               / NULLIF(
                   EXTRACT(EPOCH FROM (reading_datetime - LAG(reading_datetime)
                     OVER (ORDER BY reading_datetime))) / 3600.0,
                 0)  AS flow_rate
        FROM   locator_readings
        WHERE  locator_id   = NEW.locator_id
          AND  plant_id     = NEW.plant_id
          AND  norm_status  = 'normal'
          AND  reading_datetime >= NOW() - INTERVAL '7 days'
          AND  reading_datetime < NEW.reading_datetime
          AND  previous_reading IS NOT NULL
          AND  current_reading > previous_reading
      ) sub
      WHERE sub.flow_rate > 0;

      IF v_avg_flow_rate IS NOT NULL
         AND v_flow_rate > v_avg_flow_rate * 2.0
         AND NEW.norm_status = 'normal'
      THEN
        NEW.norm_status := 'pending_review';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- <<<<<<< END ARCHIVED: 20260809000001_hamas_phase15_derived_locators_skip_generic_spike.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260809000002_hamas_phase14_repair_override_mirror_sync.sql >>>>>>>
-- =============================================================================
-- Migration: hamas_phase14_repair_override_mirror_sync
-- Applied 2026-08-09.
--
-- ROOT CAUSE (phase14):
--   saveOverride() and insertDerivedOverrideRows() in LocatorSection.tsx only
--   ever wrote to locator_readings. When an operator overrode the derived
--   locator value (e.g. SRP's "HAMAS (Mambaling)" locator → set to 5,294),
--   the corresponding mirror product_meter_readings row (Mambaling's "HAMAS"
--   product meter) was never touched. The sweep's phase12 CONTINUE guard then
--   protects the locator row (is_estimated = false) from re-computation —
--   which is correct — but that same CONTINUE also skips the mirror update
--   for the same iteration, leaving the mirror permanently at whatever the
--   sweep last computed (e.g. 306) rather than the override value (5,294).
--   The locator and mirror stayed diverged indefinitely.
--
--   phase13 (20260808100000) addressed only the historical data at the time it
--   ran. Any override applied after phase13 ran re-introduced the divergence.
--   The matching frontend fix (saveOverride / insertDerivedOverrideRows now
--   call syncDerivedLocatorMirrors) stops future divergence. This migration
--   repairs the current divergence for all dates in locator_readings, whether
--   the value was written by the sweep (is_estimated = true) or by a human
--   override (is_estimated = false).
--
-- WHAT THIS DOES:
--   For every active derived locator:
--     For every date's locator_reading row (sweep or override):
--       Find the mirror product_meter_readings row for the same Asia/Manila
--       calendar day and update it to current_reading = daily_volume =
--       locator_reading.daily_volume. If no mirror row exists for that date,
--       insert one.
--
-- IDEMPOTENT: re-running after a full repair is a no-op (0 rows changed/inserted).
-- =============================================================================

DO $$
DECLARE
  r_loc            RECORD;
  r_lr             RECORD;
  v_mirror         RECORD;
  v_day_start      timestamptz;
  v_day_end        timestamptz;
  v_mirror_id      uuid;
  v_mirror_cur     numeric;
  v_mirror_prev    numeric;
  v_mirror_vol     numeric;
  v_checked        integer := 0;
  v_changed        integer := 0;
  v_inserted       integer := 0;
BEGIN
  FOR r_loc IN
    SELECT id, name
    FROM public.locators
    WHERE is_derived = true
      AND status = 'Active'
  LOOP
    FOR r_lr IN
      SELECT reading_datetime, daily_volume, is_estimated
      FROM public.locator_readings
      WHERE locator_id = r_loc.id
      ORDER BY reading_datetime
    LOOP
      -- Same day-window convention as fn_sweep_derived_meters_for_date:
      -- Asia/Manila calendar day boundaries.
      v_day_start := date_trunc('day', r_lr.reading_datetime AT TIME ZONE 'Asia/Manila')
                       AT TIME ZONE 'Asia/Manila';
      v_day_end   := v_day_start + interval '1 day';

      FOR v_mirror IN
        SELECT id, plant_id
        FROM public.product_meters
        WHERE derived_from_locator_id = r_loc.id
          AND is_derived = true
      LOOP
        v_checked := v_checked + 1;

        SELECT id, current_reading, previous_reading, daily_volume
          INTO v_mirror_id, v_mirror_cur, v_mirror_prev, v_mirror_vol
        FROM public.product_meter_readings
        WHERE meter_id = v_mirror.id
          AND reading_datetime >= v_day_start
          AND reading_datetime <  v_day_end
        ORDER BY reading_datetime DESC
        LIMIT 1;

        IF v_mirror_id IS NOT NULL THEN
          -- Only write if stale to keep the log noise down.
          IF v_mirror_cur  IS DISTINCT FROM r_lr.daily_volume
          OR v_mirror_prev IS DISTINCT FROM 0
          OR v_mirror_vol  IS DISTINCT FROM r_lr.daily_volume THEN
            UPDATE public.product_meter_readings
               SET current_reading  = r_lr.daily_volume,
                   previous_reading = 0,
                   daily_volume     = r_lr.daily_volume,
                   is_estimated     = true
             WHERE id = v_mirror_id;
            v_changed := v_changed + 1;
          END IF;
        ELSE
          -- Locator has a reading for this day but the mirror never got one
          -- (sweep never ran for that date at the mirror, or the row was deleted).
          INSERT INTO public.product_meter_readings
            (meter_id, plant_id, reading_datetime,
             current_reading, previous_reading, daily_volume, is_estimated)
          VALUES
            (v_mirror.id, v_mirror.plant_id,
             v_day_end - interval '1 second',   -- 23:59:59 Manila, matching sweep convention
             r_lr.daily_volume, 0, r_lr.daily_volume, true);
          v_inserted := v_inserted + 1;
        END IF;

        -- Reset scalars so a zero-row SELECT on the next iteration doesn't
        -- re-use the previous iteration's values.
        v_mirror_id   := NULL;
        v_mirror_cur  := NULL;
        v_mirror_prev := NULL;
        v_mirror_vol  := NULL;
      END LOOP;
    END LOOP;
  END LOOP;

  RAISE NOTICE
    'hamas_phase14: checked % mirror-day pairs, repaired % existing rows, inserted % missing rows',
    v_checked, v_changed, v_inserted;
END $$;

-- <<<<<<< END ARCHIVED: 20260809000002_hamas_phase14_repair_override_mirror_sync.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260809000003_hamas_phase15_product_meter_integrity_guard_and_mirror_trigger.sql >>>>>>>
-- =============================================================================
-- Migration: hamas_phase15_product_meter_integrity_guard_and_mirror_trigger
-- Applied live 2026-08-09 (direct Supabase MCP access, project sosfbfxovtleuvahxvpm).
--
-- ROOT CAUSE (phase15 — a third, independent cause from phase13/14):
--   trg_product_meter_reading_integrity (BEFORE INSERT OR UPDATE ON
--   product_meter_readings, function fn_product_meter_reading_integrity) has
--   always unconditionally recomputed previous_reading/daily_volume by
--   looking up "the most recent non-retracted/non-pending_review row before
--   this one" and taking a delta — the correct model for a real cumulative
--   meter, but wrong for a mirrored is_derived meter like Mambaling's
--   "HAMAS", where current_reading already IS the period volume (phase11's
--   convention: previous_reading pinned at 0). This function never checked
--   product_meters.is_derived, so it silently overwrote whatever a correct
--   writer (fn_sweep_derived_meters_for_date's mirror loop, or the frontend's
--   syncDerivedLocatorMirrors()) had just set, replacing it with a bogus
--   delta against an unrelated old reading.
--
--   This is the same class of bug phase5/6/7/9/10 already fixed on the
--   *locator_readings* side (fn_locator_reading_integrity /
--   fn_sync_locator_reading_chain) — it was simply never mirrored onto the
--   analogous product_meter_readings-side trigger, so the exact same failure
--   mode was reintroduced one table over.
--
--   Symptom observed live: Mambaling's HAMAS history showed 0 m³ for most of
--   the last 30 days and small-but-wrong values (949, 306) for the two most
--   recent days, while SRP's HAMAS was fully correct throughout — because the
--   locator side (fixed in the earlier live session, 2026-08-01) was never
--   touched by this bug, only the mirror side was.
--
--   Consequence for phase13/14: both of those migrations are pure data
--   repairs — their UPDATE/INSERT statements go through this same trigger.
--   Even if run, this trigger would have re-corrupted the very rows they
--   just repaired in the same statement. phase15 is the reason phase13/14
--   can actually hold.
--
-- FIX PART 1 — fn_product_meter_reading_integrity gets an is_derived guard,
--   mirroring the pattern already used in fn_locator_reading_integrity: for
--   a derived (mirrored) product meter, previous_reading/daily_volume/
--   norm_status are left exactly as the caller set them. A mirror row is
--   never independently "recorded," so it doesn't need — and must not get —
--   its own delta/spike computation; correctness lives entirely upstream in
--   the source locator, which already has its own integrity checks.
--
-- FIX PART 2 — new trigger trg_sync_derived_locator_mirror on
--   locator_readings (AFTER INSERT OR UPDATE OR DELETE), scoped to
--   is_derived locators. Whatever locator_readings ends up with for a given
--   Asia/Manila calendar day — sweep-computed or manually overridden via
--   DerivedMeterOverrideDialog / the CSV bulk-override path — is copied
--   verbatim to every linked product_meters mirror (derived_from_locator_id)
--   for that same day; a delete on the source removes the mirror row too.
--   This makes "HAMAS (SRP) = HAMAS (Mambaling), always" a database-level
--   invariant instead of something each call site has to remember to do.
--
--   This is a deliberate belt-and-suspenders alongside the frontend's own
--   syncDerivedLocatorMirrors() (LocatorSection.tsx, merged same day in
--   correction-fixes-v2.patch): that call only fires from saveOverride() /
--   insertDerivedOverrideRows(), so it can't catch a delete (the History
--   dialog's row-level "X" delete has never called it) or any future write
--   path that forgets to call it. mirror is_estimated is hardcoded true
--   either way — a mirror row is never itself "directly recorded," matching
--   the convention already used by both fn_sweep_derived_meters_for_date and
--   syncDerivedLocatorMirrors.
--
-- DATA REPAIR: performed live for all ~222 days of HAMAS history plus
--   today, using locator_readings as ground truth (re-verified against the
--   screenshots: SRP and Mambaling now match exactly, day for day). Not
--   repeated as a DO block here — phase13/14 already carry that exact
--   repair and are idempotent, so running them after this migration is a
--   safe no-op / confirmation pass, not a second repair.
--
--   One pre-existing, untouched oddity found and *not* repaired here:
--   product_meter_readings has one row for meter b5546271-4302-46c4-aaf4-
--   c495ef96d448 (Mambaling HAMAS) dated 2026-07-01 (current_reading
--   2,721,182.44 — a stale cumulative-style value, daily_volume 4,654) with
--   no corresponding locator_readings row on the SRP side at all. Flagged
--   for Kevz rather than deleted, since it predates the mirror-link backfill
--   and its correct disposition (delete vs. backfill a real SRP value for
--   that date) isn't determinable from data alone.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_product_meter_reading_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev_reading  NUMERIC;
  v_prev_dt       TIMESTAMPTZ;
  v_computed_vol  NUMERIC;
  v_flow_rate     NUMERIC;
  v_avg_flow_rate NUMERIC;
  v_is_derived    BOOLEAN;
BEGIN
  SELECT is_derived INTO v_is_derived
  FROM   product_meters
  WHERE  id = NEW.meter_id;

  IF COALESCE(v_is_derived, FALSE) THEN
    RETURN NEW;
  END IF;

  SELECT current_reading, reading_datetime
  INTO   v_prev_reading, v_prev_dt
  FROM   product_meter_readings
  WHERE  meter_id  = NEW.meter_id
    AND  plant_id  = NEW.plant_id
    AND  norm_status NOT IN ('retracted', 'pending_review')
    AND  reading_datetime < NEW.reading_datetime
    AND  id IS DISTINCT FROM NEW.id
  ORDER  BY reading_datetime DESC
  LIMIT  1;

  NEW.previous_reading := v_prev_reading;

  v_computed_vol := NEW.current_reading - COALESCE(v_prev_reading, NEW.current_reading);

  IF COALESCE(NEW.is_meter_rollover, FALSE)
     AND NEW.meter_rollover_max IS NOT NULL
     AND v_prev_reading IS NOT NULL
  THEN
    NEW.daily_volume := GREATEST(0, NEW.meter_rollover_max - v_prev_reading + NEW.current_reading);
  ELSE
    NEW.daily_volume := GREATEST(0, NEW.current_reading - COALESCE(v_prev_reading, 0));
  END IF;

  IF v_computed_vol < 0
     AND COALESCE(NEW.is_meter_replacement, FALSE) = FALSE
     AND COALESCE(NEW.is_meter_rollover, FALSE)     = FALSE
     AND NEW.norm_status = 'normal'
  THEN
    NEW.norm_status := 'pending_review';
    RETURN NEW;
  END IF;

  IF v_prev_dt IS NOT NULL AND v_computed_vol > 0 THEN
    DECLARE v_hrs NUMERIC := EXTRACT(EPOCH FROM (NEW.reading_datetime - v_prev_dt)) / 3600.0;
    BEGIN
      IF v_hrs > 0 THEN
        v_flow_rate := v_computed_vol / v_hrs;
        SELECT AVG(sub.fr) INTO v_avg_flow_rate FROM (
          SELECT (current_reading - previous_reading)
                 / NULLIF(EXTRACT(EPOCH FROM (reading_datetime - LAG(reading_datetime)
                     OVER (ORDER BY reading_datetime))) / 3600.0, 0) AS fr
          FROM   product_meter_readings
          WHERE  meter_id = NEW.meter_id AND plant_id = NEW.plant_id
            AND  norm_status = 'normal'
            AND  reading_datetime >= NOW() - INTERVAL '7 days'
            AND  reading_datetime < NEW.reading_datetime
            AND  previous_reading IS NOT NULL
            AND  current_reading  > previous_reading
        ) sub WHERE sub.fr > 0;

        IF v_avg_flow_rate IS NOT NULL AND v_flow_rate > v_avg_flow_rate * 2.0 AND NEW.norm_status = 'normal' THEN
          NEW.norm_status := 'pending_review';
        END IF;
      END IF;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_sync_derived_locator_mirror()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_locator_id  uuid := COALESCE(NEW.locator_id, OLD.locator_id);
  v_is_derived  boolean;
  v_day         date;
  v_day_start   timestamptz;
  v_day_end     timestamptz;
  v_reading_dt  timestamptz;
  v_mirror      RECORD;
  v_mirror_id   uuid;
BEGIN
  SELECT is_derived INTO v_is_derived FROM public.locators WHERE id = v_locator_id;
  IF NOT COALESCE(v_is_derived, FALSE) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_day        := (COALESCE(NEW.reading_datetime, OLD.reading_datetime) AT TIME ZONE 'Asia/Manila')::date;
  v_day_start  := (v_day::timestamp) AT TIME ZONE 'Asia/Manila';
  v_day_end    := ((v_day + 1)::timestamp) AT TIME ZONE 'Asia/Manila';
  v_reading_dt := v_day_end - interval '1 second';

  FOR v_mirror IN
    SELECT id, plant_id FROM public.product_meters
    WHERE derived_from_locator_id = v_locator_id AND is_derived = true
  LOOP
    IF TG_OP = 'DELETE' THEN
      DELETE FROM public.product_meter_readings
      WHERE meter_id = v_mirror.id
        AND reading_datetime >= v_day_start AND reading_datetime < v_day_end;
      CONTINUE;
    END IF;

    SELECT id INTO v_mirror_id
    FROM public.product_meter_readings
    WHERE meter_id = v_mirror.id
      AND reading_datetime >= v_day_start AND reading_datetime < v_day_end
    ORDER BY reading_datetime DESC LIMIT 1;

    IF v_mirror_id IS NOT NULL THEN
      UPDATE public.product_meter_readings
      SET current_reading  = NEW.current_reading,
          previous_reading = 0,
          daily_volume     = NEW.current_reading,
          is_estimated     = true
      WHERE id = v_mirror_id;
    ELSE
      INSERT INTO public.product_meter_readings
        (meter_id, plant_id, reading_datetime, current_reading, previous_reading, daily_volume, is_estimated)
      VALUES
        (v_mirror.id, v_mirror.plant_id, v_reading_dt, NEW.current_reading, 0, NEW.current_reading, true);
    END IF;
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_derived_locator_mirror ON public.locator_readings;
CREATE TRIGGER trg_sync_derived_locator_mirror
AFTER INSERT OR UPDATE OR DELETE ON public.locator_readings
FOR EACH ROW EXECUTE FUNCTION public.fn_sync_derived_locator_mirror();

-- <<<<<<< END ARCHIVED: 20260809000003_hamas_phase15_product_meter_integrity_guard_and_mirror_trigger.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260809000004_locator_readings_latest_view.sql >>>>>>>
-- Adds a "latest row per locator" view, same pattern as
-- ro_train_readings_latest (20260725000000_ro_train_readings_latest_view.sql):
-- DISTINCT ON does the reduction in Postgres instead of the client running
-- N per-locator queries (see LocatorSection.tsx's `op-loc-latest` query,
-- which currently issues one request per locator to get this exact row).
--
-- This backs the new "Last reading" badge on:
--   • Plant detail → Locators list (pages/plants/locators/LocatorsList.tsx)
--   • Operations → Locator tab (pages/operations/locators/LocatorSection.tsx),
--     which can migrate its op-loc-latest query onto this view too.
--
-- No new index needed — idx_lr_locator_dt (locator_id, reading_datetime desc)
-- already exists from the initial schema and is exactly what DISTINCT ON
-- needs to skip-scan by locator_id.

create or replace view public.locator_readings_latest
with (security_invoker = true) as
select distinct on (locator_id) *
from public.locator_readings
order by locator_id, reading_datetime desc;

-- PostgREST needs an explicit grant on the view object itself, separate from
-- RLS on the base table. security_invoker (Postgres 15+) keeps the base
-- table's RLS policies applying per-caller instead of running as the view
-- owner and silently bypassing plant-level access control.
grant select on public.locator_readings_latest to authenticated, anon;

-- <<<<<<< END ARCHIVED: 20260809000004_locator_readings_latest_view.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260809000005_well_readings_latest_view.sql >>>>>>>
-- Adds a "latest row per well" view, same pattern as ro_train_readings_latest
-- (20260725000000_ro_train_readings_latest_view.sql) and locator_readings_latest
-- (20260809140000_locator_readings_latest_view.sql).
--
-- Unlike locator_readings, well_readings has no (well_id, reading_datetime)
-- index yet — only idx_wr_plant_dt (plant_id, reading_datetime desc). Without
-- a well_id-led index, DISTINCT ON (well_id) would still need a sort over the
-- whole table, so this migration adds both, matching the RO train migration's
-- shape rather than the locator one's.
--
-- This also fixes a real gap, not just adds a badge: WellSection.tsx's
-- existing latestByWell is reduced client-side from a 30-day rolling window
-- (see the `op-well-recent` query), so a well that hasn't been read in over
-- 30 days currently reads as "no reading" instead of "very stale" — the
-- wrong message. Pointing that query at this view instead removes the
-- window entirely.

create index if not exists idx_well_readings_well_dt
  on public.well_readings (well_id, reading_datetime desc);

create or replace view public.well_readings_latest
with (security_invoker = true) as
select distinct on (well_id) *
from public.well_readings
order by well_id, reading_datetime desc;

grant select on public.well_readings_latest to authenticated, anon;

-- <<<<<<< END ARCHIVED: 20260809000005_well_readings_latest_view.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260809000006_product_meter_readings_latest_view.sql >>>>>>>
-- Adds a "latest row per product meter" view, same pattern as
-- ro_train_readings_latest, locator_readings_latest, and well_readings_latest.
-- idx_pmr_meter_dt (meter_id, reading_datetime desc) already exists from
-- 20260721_product_meters_and_readings.sql — no new index needed.
--
-- This also replaces a real correctness bug in ProductSection.tsx's existing
-- 'product-readings-latest' query, not just adds a badge: that query pulls
-- the last 200 rows for the whole plant, order by reading_datetime desc, and
-- keeps the first row seen per meter_id. On a plant where some meters are
-- read far more often than others, the 200-row window can be entirely
-- consumed by the frequently-read meters before ever reaching a row for a
-- rarely-read one — that meter then reads as "no reading ever" rather than
-- "reading exists, just old", with no relationship to how stale it actually
-- is. Pointing that query at this view instead makes "latest per meter"
-- correct by construction, for the same reading_datetime/daily_volume shape
-- that ProductMeterRow.tsx already consumes from it.
--
-- norm_status filter: matches fn_product_meter_reading_integrity's own
-- definition of "the real previous reading" (see hamas_phase15, same day) —
-- 'retracted' rows are voided and 'pending_review' rows are unconfirmed,
-- so neither should surface as "the latest reading" in a freshness badge.
-- 'erroneous' and 'normalized' are left in, same as that trigger treats
-- them: flagged or corrected, but still a real recorded reading. The
-- `norm_status IS NULL OR` guard is defensive, not load-bearing — the
-- column carries `DEFAULT 'normal'` (20260514_normalization.sql), which
-- Postgres backfills onto pre-existing rows, so there shouldn't be any
-- nulls left in practice.

create or replace view public.product_meter_readings_latest
with (security_invoker = true) as
select distinct on (meter_id) *
from public.product_meter_readings
where norm_status is null or norm_status not in ('retracted', 'pending_review')
order by meter_id, reading_datetime desc;

grant select on public.product_meter_readings_latest to authenticated, anon;

-- <<<<<<< END ARCHIVED: 20260809000006_product_meter_readings_latest_view.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260809000007_locator_readings_latest_view_exclude_retracted.sql >>>>>>>
-- Corrects locator_readings_latest (20260809140000_locator_readings_latest_view.sql,
-- already applied) to exclude 'retracted' and 'pending_review' rows, matching
-- fn_locator_reading_integrity's own definition of "the real previous
-- reading" and the same fix just applied to well_readings_latest and
-- product_meter_readings_latest (20260809150000 / 20260809160000, same
-- batch) — this one was missed when 140000 was written since the
-- norm_status column and its implications weren't on the radar yet at that
-- point. CREATE OR REPLACE VIEW is safe here: the output column list is
-- unchanged (still `select distinct on (locator_id) *`), only the WHERE
-- clause is added, so this doesn't need to drop the view or touch anything
-- that depends on it.
--
-- Without this, a locator whose most recent row happens to be retracted (a
-- normalization undone) or pending_review (an unconfirmed spike/backward
-- reading, not yet resolved via Data Corrections) would show that voided or
-- unconfirmed row as "the latest reading" in the freshness badge, instead of
-- the last row that's actually confirmed.

create or replace view public.locator_readings_latest
with (security_invoker = true) as
select distinct on (locator_id) *
from public.locator_readings
where norm_status is null or norm_status not in ('retracted', 'pending_review')
order by locator_id, reading_datetime desc;

grant select on public.locator_readings_latest to authenticated, anon;

-- <<<<<<< END ARCHIVED: 20260809000007_locator_readings_latest_view_exclude_retracted.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260809000008_well_readings_latest_view_exclude_retracted.sql >>>>>>>
-- Corrects well_readings_latest (20260809150000_well_readings_latest_view.sql,
-- already applied) to exclude 'retracted' and 'pending_review' rows — the
-- same fix as 20260809170000 for locator_readings_latest, for the same
-- reason: fn_locator_reading_integrity's family of triggers (and
-- hamas_phase15's version of it for product meters) treats a retracted row
-- as voided and a pending_review row as unconfirmed, so neither should
-- surface as "the latest reading" in a freshness badge. well_readings
-- carries the same norm_status column and values (20260514_normalization.sql
-- / 20260718_pending_review_and_cascade_correction.sql).
--
-- CREATE OR REPLACE VIEW is safe: the output column list is unchanged
-- (still `select distinct on (well_id) *`), only the WHERE clause is added.

create or replace view public.well_readings_latest
with (security_invoker = true) as
select distinct on (well_id) *
from public.well_readings
where norm_status is null or norm_status not in ('retracted', 'pending_review')
order by well_id, reading_datetime desc;

grant select on public.well_readings_latest to authenticated, anon;

-- <<<<<<< END ARCHIVED: 20260809000008_well_readings_latest_view_exclude_retracted.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260809000009_blending_events_dedupe_and_unique_constraint.sql >>>>>>>
-- =============================================================================
-- Migration: 20260809_blending_events_dedupe_and_unique_constraint.sql
--
-- CONTEXT: blending_events has never had a uniqueness guarantee on
-- (well_id, event_date). The only protection against two rows for the same
-- well on the same day was app-side: BlendingSection.tsx SELECTs to check
-- whether a row already exists, then branches to INSERT or UPDATE. That's a
-- classic check-then-act race — a double-click, a slow network retry, or
-- two people saving around the same time can each pass the "does it exist?"
-- check before either write has landed, producing two rows for the same
-- well/day. Each row then surfaces as its own card in the notification bell
-- (Dashboard.tsx's blending feed alert), which is what showed up as
-- duplicate "Injected NNN m³" notifications for the same well.
--
-- This migration:
--   1. Deduplicates any existing (well_id, event_date) collisions, keeping
--      one row per group (preferring the row with a real reading_datetime,
--      then the most recently entered one).
--   2. Adds a UNIQUE constraint on (well_id, event_date) so Postgres itself
--      rejects any future duplicate, race or not.
--   3. Adds fn_blending_upsert_reading(), an atomic INSERT ... ON CONFLICT
--      DO UPDATE the frontend can call instead of its old select-then-write
--      pair, closing the race window entirely rather than just detecting it
--      after the fact. SECURITY INVOKER, so existing RLS policies
--      (analyst_write_blending_events / blending_events_update) still apply
--      exactly as they do for direct .insert()/.update() calls.
-- =============================================================================

-- ── 1. Dedupe existing collisions ───────────────────────────────────────────
-- Keep one row per (well_id, event_date): prefer a real reading_datetime
-- over NULL, then the most recently entered (noted_at), then highest id as
-- a final tiebreak. Safe to delete the losers outright — previous_reading
-- on any later row is a value baked in at write time, not a live foreign
-- key, so removing an earlier duplicate can't corrupt a later row's stored
-- delta. reading_edit_audit_log / reading_anomaly_remarks reference
-- blending_events rows by a loosely-typed (table_name, record_id) pair with
-- no FK, so a removed duplicate's audit trail simply stays as history —
-- same as any other hard delete of a blending_events row today.
DO $$
DECLARE
  dup_count INT;
BEGIN
  WITH ranked AS (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY well_id, event_date
        ORDER BY reading_datetime DESC NULLS LAST, noted_at DESC, id DESC
      ) AS rn
    FROM public.blending_events
  ),
  deleted AS (
    DELETE FROM public.blending_events
    WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
    RETURNING id
  )
  SELECT count(*) INTO dup_count FROM deleted;

  RAISE NOTICE 'blending_events dedupe: removed % duplicate row(s) for (well_id, event_date)', dup_count;
END $$;

-- ── 2. Enforce it going forward ─────────────────────────────────────────────
ALTER TABLE public.blending_events
  DROP CONSTRAINT IF EXISTS blending_events_well_date_uniq;
ALTER TABLE public.blending_events
  ADD CONSTRAINT blending_events_well_date_uniq UNIQUE (well_id, event_date);

-- ── 3. Atomic upsert, replacing the racy select-then-write pair ────────────
-- p_update_previous_reading controls whether previous_reading is allowed to
-- overwrite an EXISTING row (the ON CONFLICT DO UPDATE branch):
--   - CSV import (BlendingSection.tsx) always passes previous_reading
--     through on overwrite when it has one, so it passes true.
--   - Manual entry (BlendingRow.save) never wants to re-baseline an
--     existing row from a client-tracked cumulative value, so it passes
--     false — matching the old manual UPDATE branch, which omitted
--     previous_reading entirely.
-- Either way, previous_reading is still used to seed a genuine new row on
-- INSERT; when omitted (NULL), trg_blending_set_reading resolves it from
-- the well's own last row exactly as it already does today.
CREATE OR REPLACE FUNCTION public.fn_blending_upsert_reading(
  p_well_id                 UUID,
  p_plant_id                UUID,
  p_well_name               TEXT,
  p_plant_name              TEXT,
  p_event_date              DATE,
  p_reading_datetime        TIMESTAMPTZ,
  p_raw_meter_reading       NUMERIC,
  p_previous_reading        NUMERIC DEFAULT NULL,
  p_update_previous_reading BOOLEAN DEFAULT false
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.blending_events
    (well_id, plant_id, well_name, plant_name, event_date, reading_datetime,
     raw_meter_reading, previous_reading)
  VALUES
    (p_well_id, p_plant_id, p_well_name, p_plant_name, p_event_date, p_reading_datetime,
     p_raw_meter_reading, p_previous_reading)
  ON CONFLICT (well_id, event_date) DO UPDATE SET
    plant_id          = EXCLUDED.plant_id,
    well_name         = EXCLUDED.well_name,
    plant_name        = EXCLUDED.plant_name,
    reading_datetime   = COALESCE(EXCLUDED.reading_datetime, public.blending_events.reading_datetime),
    raw_meter_reading = EXCLUDED.raw_meter_reading,
    previous_reading  = CASE
                           WHEN p_update_previous_reading AND EXCLUDED.previous_reading IS NOT NULL
                             THEN EXCLUDED.previous_reading
                           ELSE public.blending_events.previous_reading
                         END
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_blending_upsert_reading(
  UUID, UUID, TEXT, TEXT, DATE, TIMESTAMPTZ, NUMERIC, NUMERIC, BOOLEAN
) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260809000009_blending_events_dedupe_and_unique_constraint.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260809000010_correction_requests_rls.sql >>>>>>>
-- =============================================================================
-- Migration: 20260809_correction_requests_rls.sql
--
-- Likely root cause of "approved correction requests stay stuck in the
-- pending list": correction_requests isn't created by any migration in this
-- repo (see 20260723_manager_data_corrections_access.sql's note) — it was
-- set up directly in the Supabase dashboard, so its RLS has never actually
-- been confirmed from code, only guessed at.
--
-- approveRequest() / rejectRequest() / supersedeOtherCorrectionRequests() in
-- DataCorrections.tsx all update this table. If its current UPDATE policy
-- doesn't grant the resolving user access — e.g. only allows the row's own
-- submitted_by to update it, or requires a role that doesn't match whoever's
-- clicking Approve — Postgres/PostgREST doesn't error on that: an UPDATE a
-- policy narrows to zero matching rows just returns 0 rows affected, no
-- error. The old frontend code didn't check for that, so it showed
-- "Correction approved and applied" regardless, called invalidate(), and
-- fetchCorrectionRequests() re-fetched status='pending' rows and found the
-- same row still there — because it never actually changed. Ruled out the
-- simpler explanation first: invalidate() does target the right query key
-- ('correction-requests-pending'), so this isn't a caching bug.
--
-- This can't be confirmed against the table's actual current policy from
-- here, so this migration is deliberately idempotent (DROP POLICY IF EXISTS
-- before every CREATE) and safe to run either way. It's paired with a
-- frontend fix (DataCorrections.tsx) that now checks the .update() result
-- directly — so if this guess turns out wrong, or something else entirely
-- is blocking the write, that will now surface as a visible error toast
-- instead of a silently-stale row, either way.
--
-- Before applying, you can compare against what's actually live:
--   SELECT policyname, cmd, qual, with_check
--     FROM pg_policies WHERE tablename = 'correction_requests';
--
-- Policy shape mirrors the rest of the schema:
--   - INSERT: any authenticated user with plant access, only as themselves
--     (submitted_by = auth.uid()) — same as how operators already submit
--     readings directly to locator_readings/well_readings/etc.
--   - SELECT: plant access — both the submitting operator and any approver
--     need to see these rows.
--   - UPDATE (approve/reject/supersede): Admin, Manager, or Data Analyst
--     with plant access — the exact same approver group
--     fn_cascade_reading_correction already checks (20260723 migration),
--     so an operator can never resolve their own or anyone else's request.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.correction_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id UUID NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  source_table TEXT NOT NULL,
  source_id UUID NOT NULL,
  original_value NUMERIC NOT NULL,
  proposed_value NUMERIC NOT NULL,
  reason TEXT NOT NULL,
  note TEXT,
  submitted_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  resolution_note TEXT,
  resolved_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.correction_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "correction_requests_insert_own" ON public.correction_requests;
CREATE POLICY "correction_requests_insert_own" ON public.correction_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_plant_access(plant_id)
    AND submitted_by = auth.uid()
  );

DROP POLICY IF EXISTS "correction_requests_select_plant" ON public.correction_requests;
CREATE POLICY "correction_requests_select_plant" ON public.correction_requests
  FOR SELECT TO authenticated
  USING (public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS "correction_requests_resolve_approvers" ON public.correction_requests;
CREATE POLICY "correction_requests_resolve_approvers" ON public.correction_requests
  FOR UPDATE TO authenticated
  USING (public.is_manager_or_analyst_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id))
  WITH CHECK (public.is_manager_or_analyst_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id));

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260809000010_correction_requests_rls.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260809000011_notify_submitter_on_correction_rejection.sql >>>>>>>
-- =============================================================================
-- Migration: 20260809_notify_submitter_on_correction_rejection.sql
--
-- Gap: when a supervisor rejects an operator's correction_requests row
-- (DataCorrections.tsx → rejectRequest()), the submitting operator was never
-- notified — the request just quietly stopped showing up anywhere on their
-- side, with no indication it was reviewed or why. approveRequest()'s own
-- code comment ("Mark request as approved (triggers operator notification)")
-- implies the approve path already notifies the submitter via some existing
-- trigger, but correction_requests itself isn't created by any migration in
-- this repo — per 20260723_manager_data_corrections_access.sql, it was set
-- up directly in the Supabase dashboard — so that trigger's exact definition
-- isn't visible here to extend safely.
--
-- Rather than guess at it and risk a duplicate/conflicting trigger on the
-- approve path, this adds a new trigger scoped ONLY to the pending→rejected
-- transition. It surfaces resolution_note — now always populated, since the
-- frontend requires a reason before the Reject button is even enabled — as
-- the notification body, so the operator sees why, not just that.
--
-- Before/after applying, you can confirm there's no pre-existing overlap:
--   SELECT tgname, pg_get_triggerdef(oid)
--     FROM pg_trigger WHERE tgrelid = 'public.correction_requests'::regclass;
-- If a rejection ever produces two notifications for the same event, one of
-- the two triggers found there is redundant with this one — drop that one.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_notify_submitter_on_correction_rejection()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'rejected'
     AND OLD.status IS DISTINCT FROM 'rejected'
     AND NEW.submitted_by IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, plant_id, alert_type, severity, title, message, link_path)
    VALUES (
      NEW.submitted_by,
      NEW.plant_id,
      'correction_request_rejected',
      'Medium',
      'Correction request rejected',
      'Your correction request (' || NEW.source_table || ': ' ||
        COALESCE(NEW.original_value::text, '—') || ' \u2192 ' ||
        COALESCE(NEW.proposed_value::text, '—') ||
        ') was rejected. Reason: ' ||
        COALESCE(NULLIF(TRIM(NEW.resolution_note), ''), 'No reason given.'),
      '/operations'
    );
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_notify_submitter_on_correction_rejection() IS
  'Notifies the operator who submitted a correction_requests row when a '
  'supervisor rejects it, including resolution_note (the required rejection '
  'reason) in the notification body. Scoped narrowly to the pending→rejected '
  'transition so it cannot double-fire alongside whatever already handles '
  'the approved case.';

DROP TRIGGER IF EXISTS trg_notify_submitter_on_correction_rejection ON public.correction_requests;
CREATE TRIGGER trg_notify_submitter_on_correction_rejection
  AFTER UPDATE ON public.correction_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notify_submitter_on_correction_rejection();

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260809000011_notify_submitter_on_correction_rejection.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260809000012_reading_audit_log_add_cip_logs.sql >>>>>>>
-- =============================================================================
-- Migration: 20260809_reading_audit_log_add_cip_logs.sql
--
-- CIPLog.tsx's saveEdit() has always called logReadingEdit() with
-- `table_name: 'chemical_dosing_logs' as any` — the comment right above it
-- said why: "cast table_name since cip_logs isn't in the type union yet."
-- 'cip_logs' was never in this table's CHECK constraint either, so casting
-- to a table name that WAS allowed was the only way it worked at all — every
-- CIP edit has been silently misattributed to Chemical Dosing in the audit
-- trail since this page shipped, including now that CIP edits carry a
-- required reason (20260809_reading_edit_audit_log_reason.sql) — that reason
-- has been landing under the wrong table_name too.
--
-- Paired with a frontend fix (CIPLog.tsx, helpers.tsx) that now passes the
-- correct 'cip_logs' literal. Without this migration, that fix alone would
-- turn a silent mislabeling into a silent non-write instead (logReadingEdit
-- swallows insert failures on purpose — audit logging must never block the
-- actual save), which would be worse: CIP edits would stop being audited at
-- all instead of just being audited under the wrong table name.
-- =============================================================================

ALTER TABLE public.reading_edit_audit_log
  DROP CONSTRAINT IF EXISTS reading_edit_audit_log_table_name_check;

ALTER TABLE public.reading_edit_audit_log
  ADD CONSTRAINT reading_edit_audit_log_table_name_check
  CHECK (table_name IN (
    'ro_train_readings',
    'ro_pretreatment_readings',
    'chemical_dosing_logs',
    'cip_logs',
    'locator_readings',
    'power_readings',
    'blending_events',
    'well_readings'
  ));

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260809000012_reading_audit_log_add_cip_logs.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260809000013_reading_edit_audit_log_reason.sql >>>>>>>
-- =============================================================================
-- Migration: 20260809_reading_edit_audit_log_reason.sql
--
-- CONTEXT: correctionReasons.ts already defines a shared CORRECTION_REASONS
-- taxonomy, and two surfaces already require picking one — an operator's
-- CorrectionRequestDialog (goes to supervisor approval) and an admin's
-- EditValueModal on the Pending Review tab (DataCorrections.tsx). But the
-- day-to-day "edit an already-saved reading" dialogs used throughout
-- Operations (RO trains, pretreatment, locators, wells, product, blending,
-- power, dosing/CIP logs) never got wired to it — they log a field-level
-- diff via logReadingEdit() -> reading_edit_audit_log, but nothing about
-- *why*. This adds the column that was missing to actually record it.
--
-- Plain TEXT, no CHECK constraint: mirrors correction_requests.reason,
-- which is enforced against CORRECTION_REASONS only at the app layer (the
-- shared dropdown), including a free-typed 'Other' value. Nullable —
-- existing rows have none, and by product decision this only applies to
-- 'update' actions going forward (not 'delete' or bulk 'import'), so NULL
-- stays a normal, valid state at the DB level; the requirement is enforced
-- client-side by gating each dialog's Save button, same pattern the two
-- existing consumers already use.
-- =============================================================================

ALTER TABLE public.reading_edit_audit_log
  ADD COLUMN IF NOT EXISTS reason TEXT;

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260809000013_reading_edit_audit_log_reason.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260810000001_backfill_well_reading_chain_sync.sql >>>>>>>
-- =============================================================================
-- BACKFILL MIGRATION — already applied live, never committed until now.
-- Recovered verbatim from the live database (project sosfbfxovtleuvahxvpm)
-- during the Parkmall / "Well 2" Data Summary investigation (2026-08-10).
--
-- Gives well_readings the same AFTER-trigger chain-repair that
-- locator_readings already has (fn_sync_locator_reading_chain): re-derives
-- previous_reading + daily_volume fresh on every insert/update/delete and
-- heals the immediate successor, so an out-of-order backfill or edit
-- doesn't leave a later row's previous_reading permanently stale.
--
-- NOTE: this fixes the trigger going forward only. It does not retroactively
-- repair rows that drifted before this trigger existed — see
-- reading_chain_drift_audit.sql (committed the same day) for the current
-- scale of that backlog across wells. That backlog is a separate, larger
-- cleanup (several wells show real drift, some of it possibly tangled up
-- with un-flagged meter replacements) and is NOT touched by this migration
-- or by the two migrations that follow it today.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_sync_well_reading_chain()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
/*
  Called AFTER INSERT, UPDATE, or DELETE on well_readings.

  Same chain-repair strategy as locator_readings, but because daily_volume
  is a plain column we write all three derived values (previous_reading,
  daily_volume) directly on the mutated row and then heal the successor.

  current_reading may be NULL on well rows (partial reading entry) —
  we guard with NULLIF to avoid writing a nonsensical delta.
*/
DECLARE
  v_well_id           UUID;
  v_reading_dt        TIMESTAMPTZ;
  v_predecessor_id    UUID;
  v_predecessor_read  NUMERIC;
  v_successor_id      UUID;
  v_new_prev          NUMERIC;
BEGIN

  IF TG_OP = 'DELETE' THEN
    v_well_id    := OLD.well_id;
    v_reading_dt := OLD.reading_datetime;
  ELSE
    v_well_id    := NEW.well_id;
    v_reading_dt := NEW.reading_datetime;
  END IF;

  -- ── Step 1 (INSERT / UPDATE): derive previous_reading + daily_volume ──────
  IF TG_OP IN ('INSERT', 'UPDATE') THEN

    SELECT id, current_reading
      INTO v_predecessor_id, v_predecessor_read
      FROM public.well_readings
     WHERE well_id          = v_well_id
       AND reading_datetime < v_reading_dt
       AND current_reading IS NOT NULL           -- skip partial rows as predecessors
     ORDER BY reading_datetime DESC
     LIMIT 1;

    UPDATE public.well_readings
       SET previous_reading = v_predecessor_read,
           daily_volume     = CASE
                                WHEN NEW.current_reading IS NOT NULL
                                 AND v_predecessor_read  IS NOT NULL
                                THEN GREATEST(0, NEW.current_reading - v_predecessor_read)
                                WHEN NEW.current_reading IS NOT NULL
                                THEN NEW.current_reading        -- first reading in chain
                                ELSE NULL
                              END
     WHERE id = NEW.id;

  END IF;

  -- ── Step 2: patch successor ───────────────────────────────────────────────
  SELECT id
    INTO v_successor_id
    FROM public.well_readings
   WHERE well_id          = v_well_id
     AND reading_datetime > v_reading_dt
   ORDER BY reading_datetime ASC
   LIMIT 1;

  IF v_successor_id IS NOT NULL THEN

    IF TG_OP = 'DELETE' THEN
      -- Successor's predecessor is now OLD's predecessor.
      v_new_prev := OLD.previous_reading;
    ELSE
      -- Successor's predecessor is this row's current_reading.
      v_new_prev := NEW.current_reading;
    END IF;

    UPDATE public.well_readings AS wr
       SET previous_reading = v_new_prev,
           daily_volume     = CASE
                                WHEN wr.current_reading IS NOT NULL
                                 AND v_new_prev          IS NOT NULL
                                THEN GREATEST(0, wr.current_reading - v_new_prev)
                                WHEN wr.current_reading IS NOT NULL
                                THEN wr.current_reading
                                ELSE NULL
                              END
     WHERE wr.id = v_successor_id;

  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;

END;
$function$;

DROP TRIGGER IF EXISTS trg_well_readings_delta ON public.well_readings;
CREATE TRIGGER trg_well_readings_delta
  AFTER INSERT OR DELETE OR UPDATE OF current_reading ON public.well_readings
  FOR EACH ROW EXECUTE FUNCTION fn_sync_well_reading_chain();

-- <<<<<<< END ARCHIVED: 20260810000001_backfill_well_reading_chain_sync.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260810000002_product_meter_pending_review_predecessor_fix.sql >>>>>>>
-- =============================================================================
-- Root cause of the Parkmall "500,000+ m3/day" Data Summary / detail-chart
-- bug (reported 2026-08-10, screenshots of Dashboard "Data Summary" >
-- Production tab and the Parkmall meter detail chart).
--
-- fn_product_meter_reading_integrity's predecessor lookup excluded BOTH
-- 'retracted' and 'pending_review' rows. Once one row got flagged
-- pending_review (for any reason — even a transient one), every later
-- insert's predecessor lookup skipped over it and fell back further back
-- in time, producing an ever-larger gap that itself exceeded the 2x-average
-- spike threshold and got flagged pending_review too. Self-reinforcing,
-- no way to self-heal: five real days of Parkmall production (~1,200 m3
-- each) compounded into a single 6,270 m3 "daily" figure by day five,
-- and DataSummaryModal.tsx's computePivotFromReadingsNoCache trusts the
-- stored daily_volume directly (correctly, in general — this was a data
-- problem, not a pivot problem).
--
-- 'retracted' genuinely means "voided, don't use." A 'pending_review' row's
-- raw current_reading is still the best known real meter value and should
-- remain a valid predecessor for the next reading — only its own
-- interpretation is in question, not the reading itself. This mirrors how
-- well_readings' and locator_readings' chain-repair already work (no
-- status filtering at all in their predecessor lookups).
--
-- Companion migration 20260810020000 adds the AFTER-trigger cascade repair
-- (product_meter_readings never had one) for defense in depth against
-- out-of-order inserts/edits going forward.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_product_meter_reading_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev_reading  NUMERIC;
  v_prev_dt       TIMESTAMPTZ;
  v_computed_vol  NUMERIC;
  v_flow_rate     NUMERIC;
  v_avg_flow_rate NUMERIC;
  v_is_derived    BOOLEAN;
BEGIN
  SELECT is_derived INTO v_is_derived
  FROM   product_meters
  WHERE  id = NEW.meter_id;

  IF COALESCE(v_is_derived, FALSE) THEN
    RETURN NEW;
  END IF;

  SELECT current_reading, reading_datetime
  INTO   v_prev_reading, v_prev_dt
  FROM   product_meter_readings
  WHERE  meter_id  = NEW.meter_id
    AND  plant_id  = NEW.plant_id
    AND  (norm_status IS NULL OR norm_status <> 'retracted')
    AND  reading_datetime < NEW.reading_datetime
    AND  id IS DISTINCT FROM NEW.id
  ORDER  BY reading_datetime DESC
  LIMIT  1;

  NEW.previous_reading := v_prev_reading;

  v_computed_vol := NEW.current_reading - COALESCE(v_prev_reading, NEW.current_reading);

  IF COALESCE(NEW.is_meter_rollover, FALSE)
     AND NEW.meter_rollover_max IS NOT NULL
     AND v_prev_reading IS NOT NULL
  THEN
    NEW.daily_volume := GREATEST(0, NEW.meter_rollover_max - v_prev_reading + NEW.current_reading);
  ELSE
    NEW.daily_volume := GREATEST(0, NEW.current_reading - COALESCE(v_prev_reading, 0));
  END IF;

  IF v_computed_vol < 0
     AND COALESCE(NEW.is_meter_replacement, FALSE) = FALSE
     AND COALESCE(NEW.is_meter_rollover, FALSE)     = FALSE
     AND NEW.norm_status = 'normal'
  THEN
    NEW.norm_status := 'pending_review';
    RETURN NEW;
  END IF;

  IF v_prev_dt IS NOT NULL AND v_computed_vol > 0 THEN
    DECLARE v_hrs NUMERIC := EXTRACT(EPOCH FROM (NEW.reading_datetime - v_prev_dt)) / 3600.0;
    BEGIN
      IF v_hrs > 0 THEN
        v_flow_rate := v_computed_vol / v_hrs;
        SELECT AVG(sub.fr) INTO v_avg_flow_rate FROM (
          SELECT (current_reading - previous_reading)
                 / NULLIF(EXTRACT(EPOCH FROM (reading_datetime - LAG(reading_datetime)
                     OVER (ORDER BY reading_datetime))) / 3600.0, 0) AS fr
          FROM   product_meter_readings
          WHERE  meter_id = NEW.meter_id AND plant_id = NEW.plant_id
            AND  norm_status = 'normal'
            AND  reading_datetime >= NOW() - INTERVAL '7 days'
            AND  reading_datetime < NEW.reading_datetime
            AND  previous_reading IS NOT NULL
            AND  current_reading  > previous_reading
        ) sub WHERE sub.fr > 0;

        IF v_avg_flow_rate IS NOT NULL AND v_flow_rate > v_avg_flow_rate * 2.0 AND NEW.norm_status = 'normal' THEN
          NEW.norm_status := 'pending_review';
        END IF;
      END IF;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

-- ── Data repair ───────────────────────────────────────────────────────────
-- Clears the false pending_review flags this cascade left on Parkmall and
-- Coke (both at Guizo — same plant, same window; Coke's inflated numbers
-- were smaller and less visually obvious but the same bug). The chain
-- cascade trigger in the companion migration must run first so
-- previous_reading/daily_volume are already correct before this clears
-- the flag; run this repair block AFTER applying 20260810020000.
--
-- UPDATE product_meter_readings
-- SET norm_status = 'normal'
-- WHERE meter_id IN (
--   (SELECT id FROM product_meters WHERE name = 'Parkmall'),
--   (SELECT id FROM product_meters WHERE name = 'Coke')
-- )
-- AND norm_status = 'pending_review'
-- AND reading_datetime >= '2026-08-06' AND reading_datetime <= '2026-08-10 23:59:59';

-- <<<<<<< END ARCHIVED: 20260810000002_product_meter_pending_review_predecessor_fix.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260810000003_product_meter_readings_chain_cascade_trigger.sql >>>>>>>
-- =============================================================================
-- product_meter_readings never had the AFTER-trigger chain-repair that
-- well_readings (fn_sync_well_reading_chain) and locator_readings
-- (fn_sync_locator_reading_chain) already have. Without it, an
-- out-of-order insert/edit/delete leaves a successor row's
-- previous_reading permanently stale — same class of bug already fixed
-- elsewhere in this schema, now the second half of the Parkmall fix (see
-- 20260810010000, which stops NEW cascades from forming; this one gives
-- every insert/update/delete a self-healing, status-independent recompute
-- + successor patch, for out-of-order backfills going forward).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_sync_product_meter_reading_chain()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_meter_id          UUID;
  v_plant_id          UUID;
  v_reading_dt        TIMESTAMPTZ;
  v_is_derived        BOOLEAN;
  v_predecessor_read  NUMERIC;
  v_successor_id      UUID;
  v_successor_repl    BOOLEAN;
  v_successor_roll    BOOLEAN;
  v_successor_rollmax NUMERIC;
  v_new_prev          NUMERIC;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_meter_id   := OLD.meter_id;
    v_plant_id   := OLD.plant_id;
    v_reading_dt := OLD.reading_datetime;
  ELSE
    v_meter_id   := NEW.meter_id;
    v_plant_id   := NEW.plant_id;
    v_reading_dt := NEW.reading_datetime;
  END IF;

  -- Derived (mirrored) meters get current_reading/daily_volume written
  -- directly by the locator-mirror sweep, not by cumulative-meter diffing
  -- — matches fn_product_meter_reading_integrity's own is_derived guard.
  SELECT is_derived INTO v_is_derived FROM public.product_meters WHERE id = v_meter_id;
  IF COALESCE(v_is_derived, FALSE) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- ── Step 1 (INSERT / UPDATE): derive previous_reading + daily_volume ──────
  IF TG_OP IN ('INSERT', 'UPDATE') THEN

    SELECT current_reading INTO v_predecessor_read
      FROM public.product_meter_readings
     WHERE meter_id         = v_meter_id
       AND plant_id         = v_plant_id
       AND reading_datetime < v_reading_dt
       AND (norm_status IS NULL OR norm_status <> 'retracted')
       AND id <> NEW.id
     ORDER BY reading_datetime DESC
     LIMIT 1;

    UPDATE public.product_meter_readings
       SET previous_reading = v_predecessor_read,
           daily_volume     = CASE
                                WHEN COALESCE(is_meter_replacement, FALSE) THEN 0
                                WHEN COALESCE(is_meter_rollover, FALSE)
                                 AND meter_rollover_max IS NOT NULL
                                 AND v_predecessor_read IS NOT NULL
                                THEN GREATEST(0, meter_rollover_max - v_predecessor_read + current_reading)
                                ELSE GREATEST(0, current_reading - COALESCE(v_predecessor_read, 0))
                              END
     WHERE id = NEW.id;

  END IF;

  -- ── Step 2: patch successor ───────────────────────────────────────────────
  SELECT id, COALESCE(is_meter_replacement, FALSE), COALESCE(is_meter_rollover, FALSE), meter_rollover_max
    INTO v_successor_id, v_successor_repl, v_successor_roll, v_successor_rollmax
    FROM public.product_meter_readings
   WHERE meter_id         = v_meter_id
     AND plant_id         = v_plant_id
     AND reading_datetime > v_reading_dt
   ORDER BY reading_datetime ASC
   LIMIT 1;

  IF v_successor_id IS NOT NULL THEN

    IF TG_OP = 'DELETE' THEN
      v_new_prev := OLD.previous_reading;
    ELSE
      v_new_prev := NEW.current_reading;
    END IF;

    UPDATE public.product_meter_readings AS pmr
       SET previous_reading = v_new_prev,
           daily_volume     = CASE
                                WHEN v_successor_repl THEN 0
                                WHEN v_successor_roll AND v_successor_rollmax IS NOT NULL AND v_new_prev IS NOT NULL
                                THEN GREATEST(0, v_successor_rollmax - v_new_prev + pmr.current_reading)
                                ELSE GREATEST(0, pmr.current_reading - COALESCE(v_new_prev, 0))
                              END
     WHERE pmr.id = v_successor_id;

  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;

END;
$function$;

DROP TRIGGER IF EXISTS trg_product_meter_readings_delta ON public.product_meter_readings;
CREATE TRIGGER trg_product_meter_readings_delta
  AFTER INSERT OR DELETE OR UPDATE OF current_reading ON public.product_meter_readings
  FOR EACH ROW EXECUTE FUNCTION fn_sync_product_meter_reading_chain();

-- ── Data repair ───────────────────────────────────────────────────────────
-- Fires the new trigger on every existing row so previous_reading /
-- daily_volume are recomputed from the true chronological predecessor.
-- Safe to run repeatedly (idempotent once the chain is correct).
--
-- UPDATE product_meter_readings
-- SET current_reading = current_reading
-- WHERE id IN (SELECT id FROM product_meter_readings ORDER BY meter_id, reading_datetime ASC);

-- <<<<<<< END ARCHIVED: 20260810000003_product_meter_readings_chain_cascade_trigger.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260810000004_blending_events_chain_cascade_trigger.sql >>>>>>>
-- =============================================================================
-- Root cause of the "Well 2" blending History showing inflated multi-
-- thousand-m3 volumes (reported 2026-08-10, screenshots of two "Well 2 —
-- History" dialogs disagreeing — the blending-events view vs the
-- well_readings meter-history view for the same physical meter).
--
-- blending_events only had fn_blending_set_reading (BEFORE INSERT/UPDATE),
-- which resolves previous_reading ONCE, at insert time, and only when the
-- caller didn't already supply one — with no mechanism to re-walk the
-- chain when an earlier row is backfilled after a later one already
-- exists. A well acting as a blending source doesn't always get same-day
-- entries, so a later row's previous_reading gets stuck pointing at
-- whatever was the most recent row AT INSERT TIME, silently skipping any
-- earlier row backfilled afterward and double- (or triple-) counting
-- those skipped days into one. Adds the same AFTER-trigger chain-repair
-- pattern as well_readings / locator_readings / product_meter_readings.
--
-- The successor-patch step deliberately skips any successor whose
-- raw_meter_reading IS NULL — pre-migration legacy rows that carry a
-- manually-set volume_m3 with no meter reading to diff against. Touching
-- those would both compute a meaningless NULL volume and re-fire
-- fn_blending_set_reading (which also fires on UPDATE OF previous_reading)
-- straight into its "raw_meter_reading is required" guard.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_sync_blending_reading_chain()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_well_id        UUID;
  v_event_date     DATE;
  v_reading_dt     TIMESTAMPTZ;
  v_predecessor    NUMERIC;
  v_successor_id   UUID;
  v_successor_repl BOOLEAN;
  v_successor_raw  NUMERIC;
  v_new_prev       NUMERIC;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_well_id    := OLD.well_id;
    v_event_date := OLD.event_date;
    v_reading_dt := OLD.reading_datetime;
  ELSE
    v_well_id    := NEW.well_id;
    v_event_date := NEW.event_date;
    v_reading_dt := NEW.reading_datetime;
  END IF;

  -- ── Step 1 (INSERT / UPDATE): derive previous_reading + volume_m3 ─────────
  -- Ordering matches fn_blending_set_reading's own convention: event_date,
  -- then reading_datetime as a tiebreaker within the same date.
  IF TG_OP IN ('INSERT', 'UPDATE') THEN

    SELECT raw_meter_reading INTO v_predecessor
      FROM public.blending_events
     WHERE well_id = v_well_id
       AND id <> NEW.id
       AND (event_date < v_event_date
            OR (event_date = v_event_date AND reading_datetime IS NOT NULL
                AND v_reading_dt IS NOT NULL AND reading_datetime < v_reading_dt))
     ORDER BY event_date DESC, reading_datetime DESC NULLS LAST
     LIMIT 1;

    UPDATE public.blending_events
       SET previous_reading = v_predecessor,
           volume_m3        = CASE
                                WHEN COALESCE(is_meter_replacement, FALSE) THEN 0
                                WHEN v_predecessor IS NULL THEN 0
                                ELSE GREATEST(0, raw_meter_reading - v_predecessor)
                              END
     WHERE id = NEW.id;

  END IF;

  -- ── Step 2: patch successor ───────────────────────────────────────────────
  SELECT id, COALESCE(is_meter_replacement, FALSE), raw_meter_reading
    INTO v_successor_id, v_successor_repl, v_successor_raw
    FROM public.blending_events
   WHERE well_id = v_well_id
     AND (event_date > v_event_date
          OR (event_date = v_event_date AND reading_datetime IS NOT NULL
              AND v_reading_dt IS NOT NULL AND reading_datetime > v_reading_dt))
   ORDER BY event_date ASC, reading_datetime ASC NULLS LAST
   LIMIT 1;

  IF v_successor_id IS NOT NULL AND v_successor_raw IS NOT NULL THEN

    IF TG_OP = 'DELETE' THEN
      v_new_prev := OLD.previous_reading;
    ELSE
      v_new_prev := NEW.raw_meter_reading;
    END IF;

    UPDATE public.blending_events AS be
       SET previous_reading = v_new_prev,
           volume_m3        = CASE
                                WHEN v_successor_repl THEN 0
                                WHEN v_new_prev IS NULL THEN 0
                                ELSE GREATEST(0, be.raw_meter_reading - v_new_prev)
                              END
     WHERE be.id = v_successor_id;

  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;

END;
$function$;

DROP TRIGGER IF EXISTS trg_blending_readings_chain ON public.blending_events;
CREATE TRIGGER trg_blending_readings_chain
  AFTER INSERT OR DELETE OR UPDATE OF raw_meter_reading ON public.blending_events
  FOR EACH ROW EXECUTE FUNCTION fn_sync_blending_reading_chain();

-- ── Data repair ───────────────────────────────────────────────────────────
-- Fires the new trigger on every existing row with a raw meter reading, so
-- previous_reading / volume_m3 are recomputed from the true chronological
-- predecessor. EXCLUDES "Inside Well" (Mambaling) rows dated on or before
-- 2026-07-01: that well's early history has event_date and reading_datetime
-- running ~6-7 days apart from each other in a way that isn't consistent
-- enough to auto-repair safely (see reading_chain_drift_audit.sql) — left
-- alone deliberately, flagged for manual review rather than guessed at.
--
-- UPDATE blending_events
-- SET raw_meter_reading = raw_meter_reading
-- WHERE id IN (
--   SELECT id FROM blending_events
--   WHERE raw_meter_reading IS NOT NULL
--     AND NOT (well_id = (SELECT id FROM wells WHERE name = 'Inside Well' AND plant_id =
--                          (SELECT id FROM plants WHERE name = 'Mambaling'))
--              AND event_date <= '2026-07-01')
--   ORDER BY well_id, event_date ASC, reading_datetime ASC
-- );

-- <<<<<<< END ARCHIVED: 20260810000004_blending_events_chain_cascade_trigger.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260811000001_reading_audit_log_add_product_meter.sql >>>>>>>
-- =============================================================================
-- Migration: 20260811_reading_audit_log_add_product_meter.sql
--
-- ProductMeterHistoryDialog (frontend/src/pages/operations/product/
-- ProductSection.tsx) is the "edit an already-saved reading" surface for
-- product meters — the direct sibling of the well/locator/power/blending
-- edit flow in ReadingHistoryDialog.tsx and the RO train/pretreatment/CIP/
-- dosing edit dialogs. Every one of those already requires picking a reason
-- from CORRECTION_REASONS (CorrectionReasonField) and logs the edit via
-- logReadingEdit() -> reading_edit_audit_log. ProductMeterHistoryDialog's
-- saveEdit()/deleteRow() never did either — confirmed by
-- 20260807_reading_anomaly_remarks.sql's own comment describing
-- product_meter_readings as "the one reading table that audit log doesn't
-- cover yet", and by 20260809_reading_edit_audit_log_reason.sql listing
-- "product" among the surfaces the reason column was meant to cover.
--
-- Paired with a frontend fix (ProductSection.tsx, helpers.tsx) that now
-- requires a reason and calls logReadingEdit() with
-- table_name: 'product_meter_readings'. Without this migration, that insert
-- would fail the table_name CHECK constraint — logReadingEdit() swallows
-- insert failures on purpose (audit logging must never block the actual
-- save), so the edit would keep silently going unaudited exactly as before.
-- Same DROP/ADD pattern as 20260806_reading_audit_log_add_power_blending_well.sql
-- and 20260809_reading_audit_log_add_cip_logs.sql.
-- =============================================================================

ALTER TABLE public.reading_edit_audit_log
  DROP CONSTRAINT IF EXISTS reading_edit_audit_log_table_name_check;

ALTER TABLE public.reading_edit_audit_log
  ADD CONSTRAINT reading_edit_audit_log_table_name_check
  CHECK (table_name IN (
    'ro_train_readings',
    'ro_pretreatment_readings',
    'chemical_dosing_logs',
    'cip_logs',
    'locator_readings',
    'power_readings',
    'blending_events',
    'well_readings',
    'product_meter_readings'
  ));

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260811000001_reading_audit_log_add_product_meter.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260811000002_ro_pretreat_delete_rls_fix.sql >>>>>>>
-- =============================================================================
-- Migration: 20260811_ro_pretreat_delete_rls_fix.sql
--
-- Fixes: the Delete (and Edit) button in the RO Train / Pre-Treatment
-- operator log does nothing for some Manager / Data Analyst users.
--
-- Root cause: TrainLogModal.tsx sets
--     hasFullAccess = isManager || isDataAnalyst
-- and shows the delete/edit controls to those roles for ANY train, with no
-- plant scoping (see frontend/src/pages/ro-trains/helpers.tsx canEditEntry).
-- But the RLS policies on ro_train_readings and ro_pretreatment_readings
-- only ever called user_has_plant_access(plant_id), which for a non-Admin
-- requires the row's plant_id to be in that user's plant_assignments. A
-- Manager/Data Analyst whose plant_assignments don't cover a given train's
-- plant sees the delete button (frontend says "full access"), confirms the
-- dialog, and the DELETE is silently blocked by RLS -- 0 rows affected.
-- TrainLogModal.tsx's doDeleteReading() already detects and reports this via
-- its post-delete `.select('id')` 0-row check (added after the same failure
-- mode hit blending_events -- see 20260729_blending_events_meter_columns.sql).
--
-- Fix: give Manager / Data Analyst unscoped write access to just these two
-- tables, matching what the frontend already assumes. Scoped through a new
-- helper function rather than broadening user_has_plant_access() itself,
-- since that function also backs write policies on locator_readings,
-- well_readings, power_readings, pump_readings, cip_logs, incidents, and
-- others -- broadening it globally would silently hand Manager/Data Analyst
-- unscoped write access to all of those too, which is a bigger change than
-- "fix the RO delete button."
--
-- Supersedes the interactive supabase/migrations/confirm-and-fix-ro-delete.sql
-- draft (same fix, minus the manual per-user diagnostic step). That file can
-- be deleted once this one has been run.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.user_has_ro_write_access(_plant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.user_has_plant_access(_plant_id)
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role IN ('Manager', 'Data Analyst')
    );
$$;

DROP POLICY IF EXISTS "ro_train_readings_plant_access" ON public.ro_train_readings;
CREATE POLICY "ro_train_readings_plant_access" ON public.ro_train_readings
  FOR ALL TO authenticated
  USING (public.user_has_ro_write_access(plant_id))
  WITH CHECK (public.user_has_ro_write_access(plant_id));

DROP POLICY IF EXISTS "ro_pretreatment_access" ON public.ro_pretreatment_readings;
CREATE POLICY "ro_pretreatment_access" ON public.ro_pretreatment_readings
  FOR ALL TO authenticated
  USING (public.user_has_ro_write_access(plant_id))
  WITH CHECK (public.user_has_ro_write_access(plant_id));

NOTIFY pgrst, 'reload schema';

-- ── Verify ───────────────────────────────────────────────────────────────
-- Re-run this after applying and confirm both policies show USING/WITH CHECK
-- expressions referencing user_has_ro_write_access.
select tablename, policyname, cmd, roles
from pg_policies
where tablename in ('ro_train_readings', 'ro_pretreatment_readings')
order by tablename, policyname;

-- <<<<<<< END ARCHIVED: 20260811000002_ro_pretreat_delete_rls_fix.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260812000001_fix_approve_reflag_on_pending_review.sql >>>>>>>
-- =============================================================================
-- Migration: 20260812090000_fix_approve_reflag_on_pending_review.sql
--
-- BUG REPORTED: Data Corrections → Pending tab — clicking "Approve" on a
-- flagged reading (e.g. Parkmall, Coke — both product_meter_readings,
-- Guizo) shows the "approved" toast, but the row is still there after the
-- list refetches / on next visit.
--
-- ROOT CAUSE: this is NOT the RLS-silently-narrows-the-update failure mode
-- the .select('id') checks in DataCorrections.tsx already guard against
-- (see comments there) — the UPDATE genuinely applies. The problem is what
-- happens next, inside the same statement:
--
--   fn_locator_reading_integrity() and fn_product_meter_reading_integrity()
--   both run BEFORE INSERT OR UPDATE and unconditionally re-derive
--   norm_status from the row's raw current_reading/previous_reading
--   whenever the incoming value is norm_status = 'normal':
--
--     IF v_computed_vol < 0 ... AND NEW.norm_status = 'normal' THEN
--       NEW.norm_status := 'pending_review';
--     END IF;
--
--   "Approve" (DataCorrections.tsx resolveOne / bulkResolve) does exactly
--   `UPDATE ... SET norm_status = 'normal' WHERE id = ...` — it doesn't
--   touch current_reading, because the reading is being approved AS-IS,
--   not corrected. That UPDATE is precisely what the trigger's own
--   condition is watching for. Since the raw values didn't change, the
--   backward/spike check still evaluates true, and the trigger silently
--   flips norm_status right back to 'pending_review' before the row is
--   even written — the admin's decision is overwritten inside their own
--   UPDATE statement, with no error raised anywhere.
--
--   This is also why the other two resolution paths look fine and only
--   plain Approve is broken:
--     - "Edit value" (fn_cascade_reading_correction) sets
--       norm_status = 'normalized', which never matches the trigger's
--       `= 'normal'` check, so it's untouched by this bug.
--     - "Mark as rollover" sets is_meter_rollover = true, which the
--       backward-check condition already explicitly excludes.
--     - "Reject" sets norm_status = 'retracted', which also never matches
--       `= 'normal'`.
--   Only the literal "approve this reading unchanged" action collides with
--   the trigger's own re-check condition.
--
--   well_readings is NOT affected — it has no equivalent integrity trigger
--   that re-derives norm_status (trg_well_readings_delta only recomputes
--   previous_reading/daily_volume, and only fires on
--   `UPDATE OF current_reading`, which a plain Approve never touches).
--
-- FIX: both functions gain a `v_resolving_from_pending` flag — true only
-- when this is an UPDATE and the row's norm_status was already
-- 'pending_review' beforehand. When true, the backward/spike auto-flag is
-- skipped, so an explicit admin/reviewer approval sticks. Fresh inserts
-- (TG_OP = 'INSERT', where OLD doesn't exist) and any other edit path are
-- completely unaffected — they're still checked exactly as before. This is
-- deliberately scoped as narrowly as possible: it only changes behavior for
-- the specific "this row was pending_review and is now being explicitly
-- set to normal" transition, which is the definition of "approve."
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_locator_reading_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev_reading           NUMERIC;
  v_prev_dt                TIMESTAMPTZ;
  v_computed_vol           NUMERIC;
  v_hours_elapsed          NUMERIC;
  v_flow_rate              NUMERIC;
  v_avg_flow_rate          NUMERIC;
  v_input_mode             TEXT;
  v_is_derived             BOOLEAN;
  -- True only for an UPDATE whose OLD row was already 'pending_review' —
  -- i.e. this statement is resolving an existing flag, not introducing a
  -- fresh one. Computed via IF (not inline `TG_OP = 'UPDATE' AND OLD...`)
  -- so OLD is never referenced outside an UPDATE context.
  v_resolving_from_pending BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_resolving_from_pending := (OLD.norm_status = 'pending_review');
  END IF;

  SELECT default_input_mode, is_derived
  INTO   v_input_mode, v_is_derived
  FROM   locators
  WHERE  id = NEW.locator_id;
  v_input_mode := COALESCE(v_input_mode, 'raw');
  v_is_derived := COALESCE(v_is_derived, FALSE);

  SELECT current_reading, reading_datetime
  INTO   v_prev_reading, v_prev_dt
  FROM   locator_readings
  WHERE  locator_id   = NEW.locator_id
    AND  plant_id     = NEW.plant_id
    AND  norm_status NOT IN ('retracted', 'pending_review')
    AND  reading_datetime < NEW.reading_datetime
    AND  id IS DISTINCT FROM NEW.id
  ORDER  BY reading_datetime DESC
  LIMIT  1;

  -- Only raw (cumulative-meter) locators get previous_reading derived from
  -- the chronological predecessor. Direct-mode locators (current_reading IS
  -- the period volume) keep whatever the caller set.
  IF v_input_mode <> 'direct' THEN
    NEW.previous_reading := v_prev_reading;
  END IF;

  IF v_input_mode = 'direct' THEN
    -- Derived locators (HAMAS-style): review need is already carried by
    -- locator_derived_review_flags / fn_flag_derived_review(). Skip the
    -- generic spike check.
    IF v_is_derived THEN
      RETURN NEW;
    END IF;

    IF NEW.current_reading > 0 AND NEW.norm_status = 'normal' AND NOT v_resolving_from_pending THEN
      SELECT AVG(sub.vol) INTO v_avg_flow_rate
      FROM (
        SELECT current_reading AS vol
        FROM   locator_readings
        WHERE  locator_id = NEW.locator_id
          AND  plant_id   = NEW.plant_id
          AND  norm_status = 'normal'
          AND  reading_datetime >= NOW() - INTERVAL '7 days'
          AND  reading_datetime < NEW.reading_datetime
      ) sub;

      IF v_avg_flow_rate IS NOT NULL
         AND v_avg_flow_rate > 0
         AND NEW.current_reading > v_avg_flow_rate * 2.0
      THEN
        NEW.norm_status := 'pending_review';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  -- RAW MODE — backward-reading check
  v_computed_vol := NEW.current_reading - COALESCE(v_prev_reading, NEW.current_reading);

  IF v_computed_vol < 0
     AND COALESCE(NEW.is_meter_replacement, FALSE) = FALSE
     AND COALESCE(NEW.is_estimated, FALSE)         = FALSE
     AND NEW.norm_status = 'normal'
     AND NOT v_resolving_from_pending
  THEN
    NEW.norm_status := 'pending_review';
    RETURN NEW;
  END IF;

  -- Spike detection — flow rate > 2x 7-day average
  IF v_prev_dt IS NOT NULL AND v_computed_vol > 0 THEN
    v_hours_elapsed := EXTRACT(EPOCH FROM (NEW.reading_datetime - v_prev_dt)) / 3600.0;

    IF v_hours_elapsed > 0 THEN
      v_flow_rate := v_computed_vol / v_hours_elapsed;

      SELECT AVG(sub.flow_rate)
      INTO   v_avg_flow_rate
      FROM (
        SELECT (current_reading - previous_reading)
               / NULLIF(
                   EXTRACT(EPOCH FROM (reading_datetime - LAG(reading_datetime)
                     OVER (ORDER BY reading_datetime))) / 3600.0,
                 0)  AS flow_rate
        FROM   locator_readings
        WHERE  locator_id   = NEW.locator_id
          AND  plant_id     = NEW.plant_id
          AND  norm_status  = 'normal'
          AND  reading_datetime >= NOW() - INTERVAL '7 days'
          AND  reading_datetime < NEW.reading_datetime
          AND  previous_reading IS NOT NULL
          AND  current_reading > previous_reading
      ) sub
      WHERE sub.flow_rate > 0;

      IF v_avg_flow_rate IS NOT NULL
         AND v_flow_rate > v_avg_flow_rate * 2.0
         AND NEW.norm_status = 'normal'
         AND NOT v_resolving_from_pending
      THEN
        NEW.norm_status := 'pending_review';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_product_meter_reading_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev_reading           NUMERIC;
  v_prev_dt                TIMESTAMPTZ;
  v_computed_vol           NUMERIC;
  v_flow_rate               NUMERIC;
  v_avg_flow_rate           NUMERIC;
  v_is_derived              BOOLEAN;
  -- Same guard as fn_locator_reading_integrity above.
  v_resolving_from_pending  BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_resolving_from_pending := (OLD.norm_status = 'pending_review');
  END IF;

  SELECT is_derived INTO v_is_derived
  FROM   product_meters
  WHERE  id = NEW.meter_id;

  IF COALESCE(v_is_derived, FALSE) THEN
    RETURN NEW;
  END IF;

  SELECT current_reading, reading_datetime
  INTO   v_prev_reading, v_prev_dt
  FROM   product_meter_readings
  WHERE  meter_id  = NEW.meter_id
    AND  plant_id  = NEW.plant_id
    AND  (norm_status IS NULL OR norm_status <> 'retracted')
    AND  reading_datetime < NEW.reading_datetime
    AND  id IS DISTINCT FROM NEW.id
  ORDER  BY reading_datetime DESC
  LIMIT  1;

  NEW.previous_reading := v_prev_reading;

  v_computed_vol := NEW.current_reading - COALESCE(v_prev_reading, NEW.current_reading);

  IF COALESCE(NEW.is_meter_rollover, FALSE)
     AND NEW.meter_rollover_max IS NOT NULL
     AND v_prev_reading IS NOT NULL
  THEN
    NEW.daily_volume := GREATEST(0, NEW.meter_rollover_max - v_prev_reading + NEW.current_reading);
  ELSE
    NEW.daily_volume := GREATEST(0, NEW.current_reading - COALESCE(v_prev_reading, 0));
  END IF;

  IF v_computed_vol < 0
     AND COALESCE(NEW.is_meter_replacement, FALSE) = FALSE
     AND COALESCE(NEW.is_meter_rollover, FALSE)     = FALSE
     AND NEW.norm_status = 'normal'
     AND NOT v_resolving_from_pending
  THEN
    NEW.norm_status := 'pending_review';
    RETURN NEW;
  END IF;

  IF v_prev_dt IS NOT NULL AND v_computed_vol > 0 THEN
    DECLARE v_hrs NUMERIC := EXTRACT(EPOCH FROM (NEW.reading_datetime - v_prev_dt)) / 3600.0;
    BEGIN
      IF v_hrs > 0 THEN
        v_flow_rate := v_computed_vol / v_hrs;
        SELECT AVG(sub.fr) INTO v_avg_flow_rate FROM (
          SELECT (current_reading - previous_reading)
                 / NULLIF(EXTRACT(EPOCH FROM (reading_datetime - LAG(reading_datetime)
                     OVER (ORDER BY reading_datetime))) / 3600.0, 0) AS fr
          FROM   product_meter_readings
          WHERE  meter_id = NEW.meter_id AND plant_id = NEW.plant_id
            AND  norm_status = 'normal'
            AND  reading_datetime >= NOW() - INTERVAL '7 days'
            AND  reading_datetime < NEW.reading_datetime
            AND  previous_reading IS NOT NULL
            AND  current_reading  > previous_reading
        ) sub WHERE sub.fr > 0;

        IF v_avg_flow_rate IS NOT NULL
           AND v_flow_rate > v_avg_flow_rate * 2.0
           AND NEW.norm_status = 'normal'
           AND NOT v_resolving_from_pending
        THEN
          NEW.norm_status := 'pending_review';
        END IF;
      END IF;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

-- ── Data repair ───────────────────────────────────────────────────────────
-- One-time clear for rows already stuck by this bug at the time it was
-- found (Parkmall / Coke, Guizo — the exact rows from the bug report).
-- Safe to run any time after the function bodies above are applied: it's a
-- plain UPDATE ... SET norm_status = 'normal', and with the fixed trigger
-- in place that value will no longer be immediately reverted. Genuinely
-- backward/spike rows that still need a real decision are unaffected by
-- this migration — only rows an admin already tried (and failed) to
-- approve should be re-cleared, so this is commented out rather than
-- auto-applied; uncomment and run once if those specific rows are still
-- stuck after deploying the fix above.
--
-- UPDATE product_meter_readings
-- SET norm_status = 'normal'
-- WHERE meter_id IN (
--   (SELECT id FROM product_meters WHERE name = 'Parkmall'),
--   (SELECT id FROM product_meters WHERE name = 'Coke')
-- )
-- AND norm_status = 'pending_review';

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260812000001_fix_approve_reflag_on_pending_review.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260815000001_reading_gap_reasons_add_blending.sql >>>>>>>
-- =============================================================================
-- Migration: 20260815000000_reading_gap_reasons_add_blending.sql
-- Extends reading_gap_reasons (see 20260719_offline_reason_tracking.sql) to
-- accept entity_type = 'blending'.
--
-- The "No reading — why?" gap-reason dialog exists on the Well and Locator
-- tabs (WellSection.tsx / LocatorSection.tsx) but was never added to the
-- Blending tab, so operators had no way to explain a day with no blending
-- meter reading. blending_events is keyed by well_id, but blending wells are
-- tracked as a distinct entity_type here (not 'well') because a well's
-- regular well_readings gap and its blending_events gap are two different
-- things — a well can be logged for one and not the other on the same day.
-- =============================================================================

ALTER TABLE reading_gap_reasons DROP CONSTRAINT IF EXISTS reading_gap_reasons_entity_type_check;
ALTER TABLE reading_gap_reasons ADD CONSTRAINT reading_gap_reasons_entity_type_check
  CHECK (entity_type IN ('well', 'locator', 'ro_train', 'blending'));

-- <<<<<<< END ARCHIVED: 20260815000001_reading_gap_reasons_add_blending.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260816000001_meter_readings_dedupe_and_unique_constraints.sql >>>>>>>
-- =============================================================================
-- Migration: 20260816000000_meter_readings_dedupe_and_unique_constraints.sql
--
-- CONTEXT: well_readings, locator_readings and product_meter_readings have
-- never had a uniqueness guarantee on (entity_id, reading_datetime) — the
-- same gap blending_events had before 20260809_blending_events_dedupe_and_
-- unique_constraint.sql. WellSection.tsx and LocatorSection.tsx's save()
-- already contain a `error.code === '23505'` handler with a friendly
-- "already submitted within the last hour" toast — that code has been dead
-- since it was written, because no constraint exists to ever raise a 23505
-- here. ProductSection.tsx's ProductMeterRow.save() never got that handling
-- at all.
--
-- The actual failure mode (confirmed against live data): after a successful
-- save, the reading input re-fills with the just-saved value (deliberate —
-- "start from the real odometer value"). If the operator isn't sure the
-- save registered, the field shows the *same* number they just entered.
-- Re-tapping Save resubmits current_reading === previous_reading, quietly
-- creating a genuine, zero-delta duplicate row rather than being rejected.
-- Confirmed live on well_readings, locator_readings and product_meter_
-- readings (~30 existing collisions across all three, oldest from May 2026);
-- power_readings shows no exact-timestamp collisions currently (submitMeter
-- already pre-checks for a same-day row via findExistingReading() and
-- merges into it instead of inserting) so it's left out of this migration.
--
-- This migration:
--   1. Deduplicates existing (entity_id, reading_datetime) collisions per
--      table, keeping the most-recently-entered row (highest created_at) in
--      each group — same tiebreak as the blending_events precedent. Most
--      groups are exact duplicates (identical current_reading) where the
--      choice is moot; a smaller number are two *different* values entered
--      moments apart, which this treats as "the later entry is the
--      operator's corrected/final one." Full list of removed rows reported
--      separately for review, since that assumption isn't verifiable from
--      the data alone.
--   2. Adds a UNIQUE index on (entity_id, reading_datetime) per table so
--      Postgres rejects any future duplicate outright, race or not.
--
-- Deliberately NOT adding an atomic upsert RPC (contrast fn_blending_
-- upsert_reading): blending wants "latest value wins" for one row per
-- well/day. Meter readings don't — two different values at the same
-- timestamp are a conflict to surface to the operator, not silently
-- resolve by overwrite. Insert + 23505 + friendly toast (already written on
-- the Well/Locator side) is the right shape here; Product just needs that
-- same handling added, which is a frontend-only change.
-- =============================================================================

-- ── 1. Dedupe existing collisions ───────────────────────────────────────────
DO $$
DECLARE
  dup_count INT;
BEGIN
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY well_id, reading_datetime ORDER BY created_at DESC, id DESC
    ) AS rn
    FROM public.well_readings
  ),
  deleted AS (
    DELETE FROM public.well_readings WHERE id IN (SELECT id FROM ranked WHERE rn > 1) RETURNING id
  )
  SELECT count(*) INTO dup_count FROM deleted;
  RAISE NOTICE 'well_readings dedupe: removed % duplicate row(s) for (well_id, reading_datetime)', dup_count;
END $$;

DO $$
DECLARE
  dup_count INT;
BEGIN
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY locator_id, reading_datetime ORDER BY created_at DESC, id DESC
    ) AS rn
    FROM public.locator_readings
  ),
  deleted AS (
    DELETE FROM public.locator_readings WHERE id IN (SELECT id FROM ranked WHERE rn > 1) RETURNING id
  )
  SELECT count(*) INTO dup_count FROM deleted;
  RAISE NOTICE 'locator_readings dedupe: removed % duplicate row(s) for (locator_id, reading_datetime)', dup_count;
END $$;

DO $$
DECLARE
  dup_count INT;
BEGIN
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY meter_id, reading_datetime ORDER BY created_at DESC, id DESC
    ) AS rn
    FROM public.product_meter_readings
  ),
  deleted AS (
    DELETE FROM public.product_meter_readings WHERE id IN (SELECT id FROM ranked WHERE rn > 1) RETURNING id
  )
  SELECT count(*) INTO dup_count FROM deleted;
  RAISE NOTICE 'product_meter_readings dedupe: removed % duplicate row(s) for (meter_id, reading_datetime)', dup_count;
END $$;

-- ── 2. Enforce it going forward ─────────────────────────────────────────────
ALTER TABLE public.well_readings
  DROP CONSTRAINT IF EXISTS well_readings_well_datetime_uniq;
ALTER TABLE public.well_readings
  ADD CONSTRAINT well_readings_well_datetime_uniq UNIQUE (well_id, reading_datetime);

ALTER TABLE public.locator_readings
  DROP CONSTRAINT IF EXISTS locator_readings_locator_datetime_uniq;
ALTER TABLE public.locator_readings
  ADD CONSTRAINT locator_readings_locator_datetime_uniq UNIQUE (locator_id, reading_datetime);

ALTER TABLE public.product_meter_readings
  DROP CONSTRAINT IF EXISTS product_meter_readings_meter_datetime_uniq;
ALTER TABLE public.product_meter_readings
  ADD CONSTRAINT product_meter_readings_meter_datetime_uniq UNIQUE (meter_id, reading_datetime);

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260816000001_meter_readings_dedupe_and_unique_constraints.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260817000001_sweep_function_revoke_anon.sql >>>>>>>
-- =============================================================================
-- Migration: 20260817000000_sweep_function_revoke_anon.sql
-- Removes the `anon` EXECUTE grant on fn_sweep_derived_meters.
--
-- CONTEXT:
--   20260727_hamas_phase2_sweep_function.sql granted EXECUTE to anon so the
--   derived-meter-sweep.yml cron job (no user session) could call it. But
--   the credential that workflow actually uses is
--   VITE_SUPABASE_PUBLISHABLE_KEY -- the same anon key that ships inside the
--   public frontend bundle by Supabase's own design. Granting a
--   SECURITY DEFINER function to `anon` on that basis means the function's
--   only real gate is a key any site visitor can read out of devtools, not
--   "the scheduled job" as intended. Anyone who has ever loaded the app can
--   POST to /rest/v1/rpc/fn_sweep_derived_meters with any p_date /
--   p_lookback_days (capped at 30 inside the function) at any frequency,
--   writing across locator_readings, product_meter_readings, and
--   derived_meter_sweep_log, and re-triggering fn_notify_derived_review's
--   "superseded" notification to Admin/Manager/Data Analyst each time.
--
-- FIX:
--   Revoke anon's EXECUTE grant. The cron workflow switches to the
--   service_role key instead (see the paired derived-meter-sweep.yml diff --
--   service_role is only ever held in GitHub Actions secrets, never shipped
--   to the client, so this closes the gap without touching the function's
--   own logic or its SECURITY DEFINER need). The "Recalculate now" button in
--   Operations > Locator already calls this through an authenticated
--   session, so the existing `authenticated` grant is untouched and that
--   path keeps working exactly as before.
--
--   service_role bypasses RLS/grants in Supabase by design, so it needs no
--   explicit GRANT here to keep working once the workflow switches keys --
--   this migration only removes anon's access.
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.fn_sweep_derived_meters(DATE, INT) FROM anon;

COMMENT ON FUNCTION public.fn_sweep_derived_meters(DATE, INT) IS
  'Recomputes residual volume (mother meter minus sibling locators) for every '
  'is_derived locator over a rolling lookback window, mirrors the result into '
  'any linked product_meters row, and notifies Admin/Manager/Data Analyst if '
  'a manual override gets superseded. Called on a schedule by '
  '.github/workflows/derived-meter-sweep.yml (service_role key as of '
  '2026-08-17 -- see 20260817000000_sweep_function_revoke_anon.sql; anon was '
  'never actually restricted to the cron job, since the anon key ships in '
  'the public frontend bundle) and on demand by the "Recalculate now" '
  'button in Operations > Locator (authenticated session).';

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260817000001_sweep_function_revoke_anon.sql <<<<<<<

-- >>>>>>> BEGIN ARCHIVED: 20260817000002_rls_gap_closure_pump_cip_incidents_blending_audit.sql >>>>>>>
-- =============================================================================
-- Migration: 20260817010000_rls_gap_closure_pump_cip_incidents_blending_audit.sql
--
-- Closes the remaining RLS gaps flagged in the 2026-08-17 code review /
-- status report, plus one newly-discovered gap found while verifying them
-- live (see part 2 below). Applied live via Supabase MCP on 2026-08-17;
-- this file backfills it into migrations so main and the live schema don't
-- drift apart (the recurring "committed but never run live" pattern, in
-- reverse).
--
-- PART 1 -- SELECT bypass for Manager/Data Analyst/Admin outside their own
-- plant assignment, same pattern already applied to well_readings,
-- locator_readings, and power_readings (is_manager_or_analyst_or_admin()).
-- Without this, a Manager/Data Analyst/Admin picking a plant outside their
-- own assignment silently gets 0 rows back on these three tables, same bug
-- class as the earlier "data analysis missing for some roles" fix.
-- INSERT/UPDATE/DELETE are untouched -- the existing plant-scoped FOR ALL
-- policies still gate writes for everyone, including Admin (which is fine,
-- since user_has_plant_access() already grants admins full access via
-- is_admin()).
-- =============================================================================

CREATE POLICY "pump_readings_analyst_select_bypass" ON public.pump_readings
  FOR SELECT
  USING (public.is_manager_or_analyst_or_admin(auth.uid()));

CREATE POLICY "cip_logs_analyst_select_bypass" ON public.cip_logs
  FOR SELECT
  USING (public.is_manager_or_analyst_or_admin(auth.uid()));

CREATE POLICY "incidents_analyst_select_bypass" ON public.incidents
  FOR SELECT
  USING (public.is_manager_or_analyst_or_admin(auth.uid()));

-- =============================================================================
-- PART 2 -- blending_events: drop two over-permissive PERMISSIVE policies.
--
-- auth_delete_blending_events (DELETE, USING auth.uid() IS NOT NULL) was
-- already flagged as stray in the 2026-08-17 review. While verifying it
-- live, found the exact same pattern also exists for UPDATE:
-- auth_update_blending_events (UPDATE, USING/WITH CHECK auth.uid() IS NOT
-- NULL) -- not previously flagged. Because Postgres RLS policies for the
-- same command are OR'd together (both are PERMISSIVE), either of these
-- alone grants ANY authenticated user the ability to update or delete ANY
-- blending event in ANY plant, regardless of plant assignment -- making the
-- correctly plant-scoped blending_events_update / blending_events_delete
-- policies sitting right next to them functionally moot. A malicious or
-- merely curious authenticated user could reach this directly via the
-- Supabase REST API even though ReadingHistoryDialog's client-side
-- canEditEntry()/hasFullAccess() checks make the UI itself behave
-- correctly -- RLS is the real boundary, and it wasn't holding.
--
-- Dropping both. blending_events_update / blending_events_delete (both
-- FOR ... TO authenticated USING user_has_plant_access(plant_id)) already
-- grant the intended access: any role with plant access can edit/delete
-- within their own plant, same model as every other operational table in
-- this app, with per-row ownership/time restrictions enforced client-side
-- via canEditEntry() (the established pattern here, not changed by this
-- migration). auth_read_blending_events (SELECT, also auth.uid() IS NOT
-- NULL, no plant check) is untouched -- that one was already reviewed and
-- deliberately left open in the "blending history missing for some roles"
-- fix, since ReadingHistoryDialog's own read-only visibility gate was the
-- actual bug there, not the RLS.
-- =============================================================================

DROP POLICY IF EXISTS "auth_delete_blending_events" ON public.blending_events;
DROP POLICY IF EXISTS "auth_update_blending_events" ON public.blending_events;

-- =============================================================================
-- PART 3 -- reading_edit_audit_log SELECT: include Data Analyst.
--
-- Was is_manager_or_admin(auth.uid()) (Admin/Manager only), excluding Data
-- Analyst despite Data Analyst having full access to the Data Corrections
-- page this audit trail belongs to. Swapped to the analyst-inclusive
-- helper, same one used everywhere else in this migration.
-- =============================================================================

DROP POLICY IF EXISTS "reading edit log readable by admin/manager" ON public.reading_edit_audit_log;

CREATE POLICY "reading edit log readable by admin/manager/analyst" ON public.reading_edit_audit_log
  FOR SELECT
  USING (public.is_manager_or_analyst_or_admin(auth.uid()));

NOTIFY pgrst, 'reload schema';

-- <<<<<<< END ARCHIVED: 20260817000002_rls_gap_closure_pump_cip_incidents_blending_audit.sql <<<<<<<

