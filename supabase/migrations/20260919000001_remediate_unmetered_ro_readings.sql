-- 20260919000001_remediate_unmetered_ro_readings.sql
--
-- Remediation for historical ro_train_readings where operators saved readings
-- with feed_meter and reject_meter completely blank, causing spurious recovery_pct
-- (e.g. 100% recovery) and un-annotated incomplete records.
--
-- This script:
-- 1. Clears recovery_pct to NULL on rows where feed was never metered (cannot calculate recovery without feed).
-- 2. Sets incomplete_reason if not already present.
-- 3. Flags norm_status as 'pending_review' so managers have full audit visibility.

UPDATE public.ro_train_readings
SET
  recovery_pct = NULL,
  incomplete_reason = COALESCE(incomplete_reason, 'Historical entry: feed and reject meters unrecorded'),
  norm_status = CASE WHEN norm_status = 'normal' THEN 'pending_review' ELSE norm_status END
WHERE
  feed_meter IS NULL
  AND (feed_flow IS NULL OR feed_flow = 0)
  AND (feed_meter_delta IS NULL OR feed_meter_delta = 0)
  AND permeate_meter IS NOT NULL
  AND recovery_pct IS NOT NULL;
