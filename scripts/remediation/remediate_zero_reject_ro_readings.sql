-- scripts/remediation/remediate_zero_reject_ro_readings.sql
--
-- Remediation for 959 ro_train_readings rows where operators typed 0 into the
-- Reject EM Flow box to bypass the required-field check.
--
-- Fingerprint:
--   reject_flow = 0        (reject was "entered" as zero)
--   feed_flow = permeate_flow  (feed was inferred as Permeate + 0)
--   recovery_pct BETWEEN 99 AND 101   (100% recovery artefact)
--   reject_meter IS NULL   (no manual reject meter was read)
--
-- Affected trains (as of Sep 19 2026):
--   SRP RO3  — 391 rows since Jul 25
--   SRP RO5  — 154 rows since Aug 7
--   SRP RO7  — 412 rows since Aug 26
--   Mambaling RO1  — 1 row
--   Umapad RO11    — 1 row
--
-- IMPORTANT:
--   Run PREVIEW first to verify match count.
--   Run BACKUP before applying.
--   Run on STAGING before production.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1: PREVIEW  (read-only, verify count and distribution)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  t.name                         AS train_name,
  COUNT(*)                       AS affected_rows,
  MIN(r.reading_datetime)        AS earliest,
  MAX(r.reading_datetime)        AS latest,
  ROUND(AVG(r.permeate_flow)::numeric, 2) AS avg_permeate_flow
FROM public.ro_train_readings r
JOIN public.ro_trains t ON t.id = r.train_id
WHERE r.reject_flow = 0
  AND r.feed_flow IS NOT NULL
  AND r.feed_flow > 0
  AND r.feed_flow = r.permeate_flow         -- inferred Feed = Permeate + 0
  AND r.recovery_pct BETWEEN 99 AND 101     -- 100% recovery artefact
  AND r.reject_meter IS NULL                -- no physical reject meter read
GROUP BY t.name
ORDER BY affected_rows DESC;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2: BACKUP  (run once; creates a snapshot of the rows to be changed)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ro_train_readings_pre_remediation_zero_reject AS
SELECT r.*
FROM public.ro_train_readings r
WHERE r.reject_flow = 0
  AND r.feed_flow IS NOT NULL
  AND r.feed_flow > 0
  AND r.feed_flow = r.permeate_flow
  AND r.recovery_pct BETWEEN 99 AND 101
  AND r.reject_meter IS NULL;

SELECT COUNT(*) AS backed_up_rows FROM public.ro_train_readings_pre_remediation_zero_reject;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3: APPLY
--
-- Clears the bad derived values:
--   • reject_flow  → NULL  (was incorrectly entered as 0)
--   • feed_flow    → NULL  (was incorrectly set to permeate_flow via inference)
--   • recovery_pct → NULL  (cannot be computed without valid feed/reject)
--
-- Annotates the rows for audit:
--   • incomplete_reason  → explanation (only if not already set)
--
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE public.ro_train_readings
SET
  reject_flow       = NULL,
  feed_flow         = NULL,
  recovery_pct      = NULL,
  incomplete_reason = COALESCE(
    incomplete_reason,
    'Historical: reject EM flow typed as 0 — reject and inferred feed cleared for review'
  )
WHERE reject_flow = 0
  AND feed_flow IS NOT NULL
  AND feed_flow > 0
  AND feed_flow = permeate_flow
  AND recovery_pct BETWEEN 99 AND 101
  AND reject_meter IS NULL;

-- Verify result:
SELECT
  COUNT(*) AS remaining_bad_rows
FROM public.ro_train_readings
WHERE reject_flow = 0
  AND feed_flow IS NOT NULL
  AND feed_flow > 0
  AND feed_flow = permeate_flow
  AND recovery_pct BETWEEN 99 AND 101
  AND reject_meter IS NULL;
-- Expected: 0

