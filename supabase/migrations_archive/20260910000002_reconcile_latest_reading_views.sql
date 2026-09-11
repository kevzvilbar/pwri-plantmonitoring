-- =============================================================================
-- Reconcile latest reading views to include non-retracted readings
-- =============================================================================
-- Previously, product_meter_readings_latest, locator_readings_latest, and
-- well_readings_latest excluded 'pending_review' rows:
--   WHERE norm_status IS NULL OR norm_status NOT IN ('retracted', 'pending_review')
--
-- This caused meters with readings awaiting review (or flagged by automatic
-- flow-rate guards) to be skipped entirely, falling back to rows from days ago.
-- The UI consequently claimed the meter had not been read in days ("Last reading:
-- 5 days ago"), prompted operators with "Log gap reason", and prefilled stale
-- odometer readings that caused recursive spike flags on subsequent saves.
--
-- Only 'retracted' rows should be excluded, matching fn_product_meter_reading_integrity's
-- own definition of valid predecessors:
--   (norm_status IS NULL OR norm_status <> 'retracted')

CREATE OR REPLACE VIEW public.product_meter_readings_latest
WITH (security_invoker = true) AS
SELECT DISTINCT ON (meter_id) *
FROM public.product_meter_readings
WHERE norm_status IS NULL OR norm_status <> 'retracted'
ORDER BY meter_id, reading_datetime DESC;

GRANT SELECT ON public.product_meter_readings_latest TO authenticated;

CREATE OR REPLACE VIEW public.locator_readings_latest
WITH (security_invoker = true) AS
SELECT DISTINCT ON (locator_id) *
FROM public.locator_readings
WHERE norm_status IS NULL OR norm_status <> 'retracted'
ORDER BY locator_id, reading_datetime DESC;

GRANT SELECT ON public.locator_readings_latest TO authenticated;

CREATE OR REPLACE VIEW public.well_readings_latest
WITH (security_invoker = true) AS
SELECT DISTINCT ON (well_id) *
FROM public.well_readings
WHERE norm_status IS NULL OR norm_status <> 'retracted'
ORDER BY well_id, reading_datetime DESC;

GRANT SELECT ON public.well_readings_latest TO authenticated;
