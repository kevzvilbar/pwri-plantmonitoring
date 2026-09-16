-- =============================================================================
-- 20260916000005_reading_storage_report.sql
-- Phase 0 of the reading-storage work: make table storage MEASURABLE, because
-- nothing in this repo has ever reported it (zero hits repo-wide for
-- pg_total_relation_size / pg_database_size / pg_indexes_size).
--
-- WHY
--   ro_train_readings and ro_pretreatment_readings are written HOURLY per train,
--   not once a day:
--     - frontend/src/pages/ro-trains/submitROReadings.ts:145
--         "Duplicate check — one per train per hour"
--     - frontend/src/pages/ROTrains/pretreatment/hooks/usePretreatmentActions.ts
--         inserts BOTH an ro_train_readings row and an ro_pretreatment_readings
--         row per pre-treatment log
--   so at ~24 rows/train/day these two tables are roughly 24x what a
--   daily-cadence estimate assumes — and ro_pretreatment_readings additionally
--   carries five JSONB arrays (mmf_readings, booster_pumps, afm_units,
--   filter_housings, cartridge_filter_housings) per row.
--
--   Before anyone picks a retention window, they need the real numbers. This
--   migration adds the two read-only functions that produce them.
--
-- WHAT
--   1. fn_duplicate_index_report()  — schema-wide exact-duplicate index report.
--      The 2026-09-11 migration squash (docs/MIGRATION-SQUASH.md) concatenated
--      an older index set and a later "phase4_missing_indexes" set, which left
--      both copies live on these two tables (verified in
--      supabase/migrations/20260911044610_baseline_schema.sql: lines 7796 vs
--      7824 on ro_train_readings; 7712 vs 7944 and 7776 vs 7940 on
--      ro_pretreatment_readings).
--   2. fn_reading_storage_report()  — per-table heap/index/TOAST bytes, row
--      counts, oldest/newest reading, 7-day growth, and per-index size with
--      idx_scan, for the high-volume reading tables.
--
-- NOTE ON WHAT ACTUALLY RECLAIMS SPACE
--   Dropping a duplicate index returns its bytes to the OS immediately, because
--   DROP INDEX unlinks the file. Moving rows into an archive table in this same
--   database does NOT free storage — it only shrinks the hot table. That
--   distinction is the main correction to PRETREATMENT_STORAGE_ANALYSIS.md,
--   which proposes in-database archiving with "60-80% savings".
-- =============================================================================

-- ─ 1. Duplicate index detector ──────────────────────────────────────────────
-- Groups indexes by everything that determines their physical contents
-- (columns, operator classes, collations, per-column sort direction, expression,
-- partial predicate, uniqueness) and reports every member of a group except the
-- one worth keeping.
--
-- indoption is part of the grouping key ON PURPOSE: (train_id, reading_datetime)
-- and (train_id, reading_datetime DESC) are different indexes, so this report
-- stays exact and never guesses that one could stand in for the other. The
-- looser "a covering/ASC index could also serve DESC via a backward scan" case
-- (idx_rtr_train_dt_covering) is deliberately NOT reported — that trade needs
-- idx_scan evidence, not a heuristic.
CREATE OR REPLACE FUNCTION public.fn_duplicate_index_report()
RETURNS TABLE (
  table_name       text,
  keep_index       text,
  drop_index       text,
  definition       text,
  keep_idx_scan    bigint,
  drop_idx_scan    bigint,
  drop_index_bytes bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
WITH idx AS (
  SELECT
    i.indrelid,
    i.indexrelid,
    pg_get_indexdef(i.indexrelid)                     AS definition,
    i.indkey::text                                    AS indkey,
    i.indclass::text                                  AS indclass,
    i.indcollation::text                              AS indcollation,
    i.indoption::text                                 AS indoption,
    coalesce(pg_get_expr(i.indexprs, i.indrelid), '') AS indexprs,
    coalesce(pg_get_expr(i.indpred,  i.indrelid), '') AS indpred,
    i.indisunique,
    pg_relation_size(i.indexrelid)                    AS index_bytes,
    coalesce(s.idx_scan, 0)                           AS idx_scan
  FROM pg_index i
  JOIN pg_class     c ON c.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_stat_user_indexes s ON s.indexrelid = i.indexrelid
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'      -- ordinary tables only (not matviews/partitions)
    AND i.indisvalid
    AND NOT i.indisprimary   -- never propose dropping a primary key
),
grouped AS (
  SELECT
    indrelid, indkey, indclass, indcollation, indoption, indexprs, indpred, indisunique,
    (array_agg(indexrelid ORDER BY idx_scan DESC, index_bytes DESC))[1] AS keep_oid
  FROM idx
  GROUP BY indrelid, indkey, indclass, indcollation, indoption, indexprs, indpred, indisunique
  HAVING count(*) > 1
)
SELECT
  g.indrelid::regclass::text   AS table_name,
  k.indexrelid::regclass::text AS keep_index,
  d.indexrelid::regclass::text AS drop_index,
  d.definition,
  k.idx_scan                   AS keep_idx_scan,
  d.idx_scan                   AS drop_idx_scan,
  d.index_bytes                AS drop_index_bytes
FROM grouped g
JOIN idx d
  ON  d.indrelid     = g.indrelid
  AND d.indkey       = g.indkey
  AND d.indclass     = g.indclass
  AND d.indcollation = g.indcollation
  AND d.indoption    = g.indoption
  AND d.indexprs     = g.indexprs
  AND d.indpred      = g.indpred
  AND d.indisunique  = g.indisunique
JOIN idx k ON k.indexrelid = g.keep_oid
WHERE d.indexrelid <> g.keep_oid
ORDER BY pg_relation_size(g.indrelid) DESC, d.index_bytes DESC;
$$;

COMMENT ON FUNCTION public.fn_duplicate_index_report() IS
  'Schema-wide exact-duplicate index report for public tables. Keeps the member with the highest idx_scan (ties: largest) and reports the rest as droppable. Excludes primary keys; treats (a,b) and (a,b DESC) as distinct indexes rather than assuming one can replace the other.';
-- ─ 2. Per-table storage report ─────────────────────────────────────────────
-- p_exact_counts = true runs a real COUNT(*) per table (a seq scan on a large
-- table — run it off-peak). The default (false) uses pg_class.reltuples, which
-- is accurate enough to choose a retention window and costs nothing.
--
-- rows_last_7d is what turns "how big is it" into "how fast is it growing" —
-- the number the retention decision actually needs.
--
-- Cost note: neither table has an index whose LEADING column is reading_datetime
-- (they are all (train_id, …) / (plant_id, …)), so the 7-day count cannot use a
-- plain btree range scan; it reads the heap or index-only-scans the covering
-- index. Acceptable for a report, but do not call this per page render — the
-- admin card that uses it caches the result.
CREATE OR REPLACE FUNCTION public.fn_reading_storage_report(p_exact_counts boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Extend this list as the other high-volume reading tables come under
  -- scrutiny (well_readings, locator_readings, product_meter_readings,
  -- power_readings) — everything below is table-agnostic and only assumes a
  -- reading_datetime column.
  v_tables     text[] := ARRAY['ro_train_readings', 'ro_pretreatment_readings'];

  v_tbl        text;
  v_oid        oid;
  v_est_rows   bigint;
  v_exact_rows bigint;
  v_oldest     timestamptz;
  v_newest     timestamptz;
  v_rows_7d    bigint;
  v_heap       bigint;
  v_idx_bytes  bigint;
  v_toast      bigint;
  v_total      bigint;
  v_indexes    jsonb;
  v_out        jsonb := '[]'::jsonb;
BEGIN
  -- SECURITY DEFINER bypasses RLS, so authorization lives here. auth.uid()
  -- IS NULL is the service_role / GitHub-Actions path (that key is never used
  -- from a browser), and anon holds no EXECUTE grant on this function at all.
  IF auth.uid() IS NOT NULL AND NOT public.is_manager_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only Managers/Admins may read storage reports' USING ERRCODE = '42501';
  END IF;

  FOREACH v_tbl IN ARRAY v_tables LOOP
    v_oid := to_regclass('public.' || quote_ident(v_tbl));
    IF v_oid IS NULL THEN CONTINUE; END IF;

    SELECT c.reltuples::bigint,
           pg_relation_size(c.oid),
           pg_indexes_size(c.oid),
           CASE WHEN c.reltoastrelid <> 0 THEN pg_total_relation_size(c.reltoastrelid) ELSE 0 END,
           pg_total_relation_size(c.oid)
      INTO v_est_rows, v_heap, v_idx_bytes, v_toast, v_total
      FROM pg_class c
     WHERE c.oid = v_oid;

    EXECUTE format(
      'SELECT min(reading_datetime), max(reading_datetime),
              count(*) FILTER (WHERE reading_datetime >= now() - interval ''7 days'')
         FROM public.%I', v_tbl)
      INTO v_oldest, v_newest, v_rows_7d;

    IF p_exact_counts THEN
      EXECUTE format('SELECT count(*) FROM public.%I', v_tbl) INTO v_exact_rows;
    END IF;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'index',      i.indexrelid::regclass::text,
             'size',       pg_size_pretty(pg_relation_size(i.indexrelid)),
             'bytes',      pg_relation_size(i.indexrelid),
             'idx_scan',   coalesce(s.idx_scan, 0),
             'unique',     i.indisunique,
             'primary',    i.indisprimary,
             'definition', pg_get_indexdef(i.indexrelid)
           ) ORDER BY pg_relation_size(i.indexrelid) DESC), '[]'::jsonb)
      INTO v_indexes
      FROM pg_index i
      LEFT JOIN pg_stat_user_indexes s ON s.indexrelid = i.indexrelid
     WHERE i.indrelid = v_oid;

    v_out := v_out || jsonb_build_object(
      'table',              v_tbl,
      'total_size',         pg_size_pretty(v_total),
      'total_bytes',        v_total,
      'heap_bytes',         v_heap,
      'index_bytes',        v_idx_bytes,
      'toast_bytes',        v_toast,
      'est_rows',           v_est_rows,
      'exact_rows',         v_exact_rows,
      'oldest_reading',     v_oldest,
      'newest_reading',     v_newest,
      'rows_last_7d',       v_rows_7d,
      'avg_row_bytes',      CASE WHEN coalesce(v_exact_rows, v_est_rows) > 0
                                 THEN round(v_total::numeric / coalesce(v_exact_rows, v_est_rows), 1) END,
      'projected_bytes_per_day',
                            CASE WHEN v_rows_7d > 0 AND coalesce(v_exact_rows, v_est_rows) > 0
                                 THEN round((v_total::numeric / coalesce(v_exact_rows, v_est_rows))
                                            * (v_rows_7d::numeric / 7)) END,
      'indexes',            v_indexes
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok',                  true,
    'generated_at',        now(),
    'database_size',       pg_size_pretty(pg_database_size(current_database())),
    'database_size_bytes', pg_database_size(current_database()),
    'exact_counts',        p_exact_counts,
    'tables',              v_out
  );
END;
$$;

COMMENT ON FUNCTION public.fn_reading_storage_report(boolean) IS
  'Per-table heap/index/TOAST bytes, row counts, oldest/newest reading, 7-day growth and per-index size + idx_scan for the high-volume reading tables. Drive the retention-window decision from this instead of estimating from a logging cadence.';

-- Grants follow the house pattern set by 20260912000001_train_last_readings_rpc.sql:
-- PUBLIC revoked, signed-in users with the in-function Manager/Admin guard, plus
-- service_role for the scheduled/CI path. anon is deliberately not granted.
REVOKE ALL ON FUNCTION public.fn_duplicate_index_report() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_duplicate_index_report() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_reading_storage_report(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_reading_storage_report(boolean) TO authenticated, service_role;