-- =============================================================================
-- Migration: 20260823_ro_train_data_gaps.sql
-- Hourly gap-reason logging for RO Train / Pre-Treatment operator readings.
--
-- Sibling to reading_gap_reasons (20260719_offline_reason_tracking.sql),
-- not an overload of it: reading_gap_reasons is DATE-grained (one row per
-- entity per day — "no reading at all today"), which can't represent
-- "operator missed the 11:00 hour but logged everything else that day".
-- This table is HOUR-RANGE-grained instead: one row per flagged span
-- (gap_start_at → gap_end_at), covering one or more consecutive missing
-- hourly buckets for a train, on either the RO or the Pre-Treatment tab.
--
-- Deliberately does NOT reuse the shared reason_category vocabulary used by
-- entity_status_audit_log / reading_gap_reasons (pump_problem, locked_meter,
-- etc.) for anything status-related — this table only ever answers "why was
-- this hour skipped while the train was Running", which is exactly the
-- REASON_CATEGORIES / ReasonDialog use case, so it reuses that vocabulary
-- as-is. RO-train OFFLINE reasons are a different, much richer, RO-specific
-- preset list already live in PretreatmentAndROLog.tsx's "Reason for
-- Offline" dropdown (Scheduled Maintenance, Membrane Replacement, CIP In
-- Progress, Power Outage, …) — that list is intentionally left alone and
-- keeps flowing into train_status_log.reason as free text; no schema change
-- needed there, and no attempt is made here to unify the two vocabularies.
--
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================================================

CREATE TABLE IF NOT EXISTS ro_train_data_gaps (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  train_id        UUID        NOT NULL REFERENCES ro_trains(id) ON DELETE CASCADE,
  plant_id        UUID        NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  -- Which operator-log tab this gap was detected on. Matches the actual
  -- Supabase table names (not a shorthand) so the detector/hook can select
  -- straight off this column without a lookup table.
  source_table    TEXT        NOT NULL CHECK (source_table IN
                    ('ro_train_readings', 'ro_pretreatment_readings')),
  gap_start_at    TIMESTAMPTZ NOT NULL,
  gap_end_at      TIMESTAMPTZ NOT NULL,
  missed_hours    INT         NOT NULL CHECK (missed_hours > 0),
  reason_category TEXT        NOT NULL CHECK (reason_category IN
                    ('pump_problem', 'locked_meter', 'equipment_malfunction',
                     'maintenance', 'access_issue', 'other')),
  reason_detail   TEXT,
  logged_by       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  logged_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One reason per flagged span. If the detector re-runs and a span's exact
  -- boundaries shift (e.g. a later reading arrives and shrinks the gap), the
  -- upsert in the UI targets this key — see useTrainHourlyGaps.ts.
  UNIQUE (train_id, source_table, gap_start_at)
);

CREATE INDEX IF NOT EXISTS idx_ro_train_data_gaps_lookup
  ON ro_train_data_gaps (train_id, source_table, gap_start_at);
CREATE INDEX IF NOT EXISTS idx_ro_train_data_gaps_plant
  ON ro_train_data_gaps (plant_id, gap_start_at DESC);

ALTER TABLE ro_train_data_gaps ENABLE ROW LEVEL SECURITY;

-- Any operator with plant access may log/update these — same policy as
-- reading_gap_reasons and for the same reason: day-to-day operators are the
-- ones who actually know why an hour was missed, not just managers.
DROP POLICY IF EXISTS "ro_train_data_gaps_plant_access" ON ro_train_data_gaps;
CREATE POLICY "ro_train_data_gaps_plant_access" ON ro_train_data_gaps FOR ALL TO authenticated
  USING (public.user_has_plant_access(plant_id))
  WITH CHECK (public.user_has_plant_access(plant_id));
