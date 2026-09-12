-- =============================================================================
-- 20260912000002_ro_train_uptime_reports.sql
-- "Report Running — failed to encode" exemption for the auto-offline flagger.
--
-- WHY THIS EXISTS
-- The auto-offline flag measures DATA staleness, not actual pump state. When
-- an operator fails to encode readings for >2h (forgot, or the terminal/app
-- was down), the train genuinely kept running but gets auto-flagged Offline —
-- a false positive that then sits in the Operator Log as an "Offline —
-- ongoing" banner and skews downtime reports.
--
-- DESIGN (retroactive attestation, bounded):
--   * An operator/supervisor files a report attesting "the train was running
--     the whole time; we just failed to log". The report covers the window
--     [covered_from, covered_until]:
--       covered_from  = the last production reading BEFORE the gap
--       covered_until = server now() at filing time
--   * useTrainAutoOffline skips auto-flagging any candidate whose gap start
--     falls inside a reported window — so the bogus flag is never re-written.
--     Gaps AFTER the reported window are flagged normally (the attestation is
--     not a free pass for the rest of time).
--   * Filing a report also deletes the open bogus auto-flag row(s) from
--     train_status_log and flips the train back to Running, so the Operator
--     Log banner disappears immediately.
--   * The report itself is the audit trail: who attested, when, why.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ro_train_uptime_reports (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  train_id        UUID        NOT NULL REFERENCES public.ro_trains(id) ON DELETE CASCADE,
  plant_id        UUID        NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  covered_from    TIMESTAMPTZ NOT NULL,
  covered_until   TIMESTAMPTZ NOT NULL,
  reason_category TEXT        NOT NULL CHECK (reason_category IN
                    ('operator_failed_to_encode', 'system_error', 'other')),
  reason_detail   TEXT,
  reported_by     UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ro_train_uptime_reports_window_check
    CHECK (covered_until > covered_from)
);

CREATE INDEX IF NOT EXISTS idx_ro_train_uptime_reports_lookup
  ON public.ro_train_uptime_reports (train_id, covered_from, covered_until);

ALTER TABLE public.ro_train_uptime_reports ENABLE ROW LEVEL SECURITY;

-- Same access model as ro_train_data_gaps: any operator with plant access may
-- file reports — they are the ones who actually know whether the pump ran.
DROP POLICY IF EXISTS "ro_train_uptime_reports_plant_access" ON public.ro_train_uptime_reports;
CREATE POLICY "ro_train_uptime_reports_plant_access" ON public.ro_train_uptime_reports
  FOR ALL TO authenticated
  USING (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));

-- ── Helper: does a reported window cover a candidate gap start? ──────────────
-- Used by useTrainAutoOffline (client-side via rpc-less select) and available
-- for future server-side flagging.
CREATE OR REPLACE FUNCTION public.uptime_report_covers(
  p_train_id uuid,
  p_gap_start timestamptz
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ro_train_uptime_reports
    WHERE train_id = p_train_id
      AND covered_from <= p_gap_start
      AND covered_until >= p_gap_start
  );
$$;

REVOKE ALL ON FUNCTION public.uptime_report_covers(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.uptime_report_covers(uuid, timestamptz) TO authenticated;
