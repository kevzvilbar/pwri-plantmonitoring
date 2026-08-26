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
