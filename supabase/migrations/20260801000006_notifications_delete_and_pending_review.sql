-- =============================================================================
-- Migration: 20260801_notifications_delete_and_pending_review.sql
--
-- 1. notifications has SELECT/UPDATE/INSERT policies (20260419, 20260419_
--    notifications_rls) but no DELETE policy, so the "DB Notifications" list
--    in TopBar.tsx has never been able to offer a working X/close button
--    (unlike "Plant Alerts" above it, which is client-side/Zustand and
--    already supports dismiss). This adds the missing policy, scoped to the
--    user's own notifications only — same ownership rule already used by
--    notifications_own_select / notifications_own_update.
--
-- 2. ro_train_readings already has a norm_status column (added in
--    20260514_normalization.sql) and 'pending_review' has been an allowed
--    value since 20260718_pending_review_and_cascade_correction.sql — but
--    no RO save path has ever written to it (confirmed: no INSERT/UPDATE
--    anywhere in the app sets ro_train_readings.norm_status). This is the
--    "the permeate meter error should be flagged" gap: an operator mis-key
--    (e.g. Aug 1 06:43 permeate meter jumping from ~660,977 to 2,153,677 —
--    a 1,493,203 m3 delta / 409,096.71 m3/h flow rate) is written straight
--    through with no guard, no matter how far outside history it is.
--    This does NOT change fn_cascade_reading_correction (which explicitly
--    rejects ro_train_readings — it uses a 3-meter model, not the single
--    current_reading/previous_reading model that RPC assumes) or the
--    Data Corrections / Pending Review table lists (which are scoped to
--    locator/well/product_meter_readings only) — extending those to fully
--    support RO's 3-meter shape is a larger follow-up, not this fix.
--    The frontend (roReadingGuards.ts + PretreatmentAndROLog.tsx +
--    Dashboard.tsx) is responsible for setting/reading norm_status here;
--    this migration only confirms the constraint already allows it and is
--    a safe no-op if 20260514/20260718 already applied.
-- =============================================================================

-- ── 1. notifications: allow a user to delete their own notifications ────────
DROP POLICY IF EXISTS "notifications_own_delete" ON public.notifications;
CREATE POLICY "notifications_own_delete" ON public.notifications
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ── 2. ro_train_readings.norm_status — confirm column + constraint exist ────
-- Guarded the same way 20260514/20260718 guard it, so this migration is a
-- safe no-op on any DB that already ran those, and self-healing on one that
-- somehow didn't (e.g. ro_train_readings created after 20260514 by a restore).
DO $$ BEGIN
  ALTER TABLE public.ro_train_readings
    ADD COLUMN IF NOT EXISTS norm_status TEXT;
  ALTER TABLE public.ro_train_readings DROP CONSTRAINT IF EXISTS ro_train_readings_norm_status_check;
  ALTER TABLE public.ro_train_readings
    ADD CONSTRAINT ro_train_readings_norm_status_check
    CHECK (norm_status IN ('normal', 'pending_review', 'erroneous', 'normalized', 'retracted'));
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_rtr_norm_status ON public.ro_train_readings(norm_status)
  WHERE norm_status = 'pending_review';
