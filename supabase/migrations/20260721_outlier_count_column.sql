-- ============================================================
-- §4 item 4 — Materialize outlier_count on regression_results
-- ============================================================
--
-- PROBLEM:
--   Every call to DataAnalysis.tsx's regression-results query was pulling
--   the full `corrections` JSONB array (potentially hundreds of rows × many
--   KB each) purely to count how many entries have is_outlier=true.
--   That count is then shown in the result-list card header.
--
-- FIX:
--   Add a real integer column that is kept in sync with the corrections array
--   by a trigger.  Reads only need to select `outlier_count`; the full
--   `corrections` blob is only fetched when a result card is expanded.
--
-- BACKFILL:
--   Existing rows are populated immediately via UPDATE.
--
-- TRIGGER:
--   Fires BEFORE INSERT OR UPDATE on regression_results so the column is
--   always correct at write time — no async job needed.

-- 1) Add column (idempotent)
ALTER TABLE public.regression_results
  ADD COLUMN IF NOT EXISTS outlier_count integer NOT NULL DEFAULT 0;

-- 2) Backfill existing rows
UPDATE public.regression_results
SET outlier_count = (
  SELECT COUNT(*)::int
  FROM jsonb_array_elements(
    COALESCE(corrections, '[]'::jsonb)
  ) AS elem
  WHERE (elem ->> 'is_outlier')::boolean IS TRUE
)
WHERE outlier_count = 0;   -- skip rows already set (safe for re-runs)

-- 3) Trigger function — recomputes on every insert/update that touches corrections
CREATE OR REPLACE FUNCTION public.trg_regression_results_outlier_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  NEW.outlier_count := (
    SELECT COUNT(*)::int
    FROM jsonb_array_elements(
      COALESCE(NEW.corrections, '[]'::jsonb)
    ) AS elem
    WHERE (elem ->> 'is_outlier')::boolean IS TRUE
  );
  RETURN NEW;
END;
$$;

-- 4) Attach trigger (drop first so migration is re-runnable)
DROP TRIGGER IF EXISTS trg_regression_results_outlier_count
  ON public.regression_results;

CREATE TRIGGER trg_regression_results_outlier_count
BEFORE INSERT OR UPDATE OF corrections
ON public.regression_results
FOR EACH ROW EXECUTE FUNCTION public.trg_regression_results_outlier_count();
