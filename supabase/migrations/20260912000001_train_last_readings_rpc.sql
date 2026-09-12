-- =============================================================================
-- 20260912000001_train_last_readings_rpc.sql
-- Server-side "latest reading per train" RPC for the auto-offline flagger.
--
-- WHY THIS EXISTS
-- useTrainAutoOffline (frontend/src/hooks/useTrainAutoOffline.ts) previously
-- computed each train's reading staleness against the *requesting device's*
-- clock, both for the 24h "since" cutoff and for the hours_gap itself. A
-- plant-floor terminal with a drifted/ahead clock (very common) produced
-- false Offline auto-flags — Train 7 / RO7 was flagged "no reading for >24h"
-- only 59 minutes after a real reading (incident 2026-09-12 14:03).
--
-- FIX: the flagger now asks the DATABASE for each train's latest reading AND
-- the server's now() in one round trip. No device clock is involved in the
-- staleness decision at all.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_train_last_readings(train_ids uuid[])
RETURNS TABLE (train_id uuid, last_reading_at timestamptz, server_now timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id,
    GREATEST(
      (SELECT MAX(r.reading_datetime) FROM public.ro_train_readings r
        WHERE r.train_id = t.id),
      (SELECT MAX(p.reading_datetime) FROM public.ro_pretreatment_readings p
        WHERE p.train_id = t.id)
    ) AS last_reading_at,
    now() AS server_now
  FROM public.ro_trains t
  WHERE t.id = ANY(train_ids);
$$;

-- The hook runs as the signed-in operator; SECURITY DEFINER bypasses RLS on
-- the two reading tables on purpose (the flagger only needs timestamps, and
-- previously it read those tables directly under RLS anyway — the effective
-- access is unchanged, it's just moved server-side).
REVOKE ALL ON FUNCTION public.get_train_last_readings(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_train_last_readings(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.get_train_last_readings(uuid[]) IS
  'Latest reading_datetime per RO train across ro_train_readings and ro_pretreatment_readings, plus the server''s now(). Used by useTrainAutoOffline so offline staleness is computed against server time, never the client device clock.';

-- =============================================================================
-- One-time cleanup of the bogus auto-flags the clock bug already wrote
-- (e.g. Train 7 "Auto-flagged: no reading for >24h" at 2026-09-12 14:03 when
-- a real reading existed at 13:04).
--
-- Rule: an auto-flag row is bogus when a real reading exists within the
-- 2h auto-offline threshold BEFORE the flag's confirmed_at. Delete those log
-- rows and, if the train's CURRENT status was set by such a bogus flag (no
-- later manual status row exists), flip it back to Running.
-- =============================================================================

DO $$
DECLARE
  bogus_ids uuid[];
BEGIN
  WITH bogus AS (
    SELECT sl.id
    FROM public.train_status_log sl
    WHERE sl.status = 'Offline'
      AND sl.reason LIKE 'Auto-flagged%'
      AND EXISTS (
        SELECT 1
        FROM public.ro_train_readings r
        WHERE r.train_id = sl.train_id
          AND r.reading_datetime > (sl.confirmed_at - interval '2 hours')
          AND r.reading_datetime <= sl.confirmed_at
      )
  )
  SELECT array_agg(id) INTO bogus_ids FROM bogus;

  IF bogus_ids IS NOT NULL THEN
    DELETE FROM public.train_status_log WHERE id = ANY(bogus_ids);
    RAISE NOTICE 'Deleted % bogus auto-offline flag row(s)', array_length(bogus_ids, 1);
  END IF;
END $$;

-- Flip trains whose latest status log entry was an auto-flag (now possibly
-- deleted) back to Running, unless a newer status row exists that says
-- otherwise. Only touches trains currently stuck on 'Offline'.
UPDATE public.ro_trains t
SET status = 'Running'
WHERE t.status = 'Offline'
  AND NOT EXISTS (
    SELECT 1 FROM public.train_status_log sl
    WHERE sl.train_id = t.id
      AND sl.confirmed_at > now() - interval '2 hours'
  );
