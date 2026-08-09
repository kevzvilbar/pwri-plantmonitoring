-- =============================================================================
-- Migration: 20260809_correction_requests_rls.sql
--
-- Likely root cause of "approved correction requests stay stuck in the
-- pending list": correction_requests isn't created by any migration in this
-- repo (see 20260723_manager_data_corrections_access.sql's note) — it was
-- set up directly in the Supabase dashboard, so its RLS has never actually
-- been confirmed from code, only guessed at.
--
-- approveRequest() / rejectRequest() / supersedeOtherCorrectionRequests() in
-- DataCorrections.tsx all update this table. If its current UPDATE policy
-- doesn't grant the resolving user access — e.g. only allows the row's own
-- submitted_by to update it, or requires a role that doesn't match whoever's
-- clicking Approve — Postgres/PostgREST doesn't error on that: an UPDATE a
-- policy narrows to zero matching rows just returns 0 rows affected, no
-- error. The old frontend code didn't check for that, so it showed
-- "Correction approved and applied" regardless, called invalidate(), and
-- fetchCorrectionRequests() re-fetched status='pending' rows and found the
-- same row still there — because it never actually changed. Ruled out the
-- simpler explanation first: invalidate() does target the right query key
-- ('correction-requests-pending'), so this isn't a caching bug.
--
-- This can't be confirmed against the table's actual current policy from
-- here, so this migration is deliberately idempotent (DROP POLICY IF EXISTS
-- before every CREATE) and safe to run either way. It's paired with a
-- frontend fix (DataCorrections.tsx) that now checks the .update() result
-- directly — so if this guess turns out wrong, or something else entirely
-- is blocking the write, that will now surface as a visible error toast
-- instead of a silently-stale row, either way.
--
-- Before applying, you can compare against what's actually live:
--   SELECT policyname, cmd, qual, with_check
--     FROM pg_policies WHERE tablename = 'correction_requests';
--
-- Policy shape mirrors the rest of the schema:
--   - INSERT: any authenticated user with plant access, only as themselves
--     (submitted_by = auth.uid()) — same as how operators already submit
--     readings directly to locator_readings/well_readings/etc.
--   - SELECT: plant access — both the submitting operator and any approver
--     need to see these rows.
--   - UPDATE (approve/reject/supersede): Admin, Manager, or Data Analyst
--     with plant access — the exact same approver group
--     fn_cascade_reading_correction already checks (20260723 migration),
--     so an operator can never resolve their own or anyone else's request.
-- =============================================================================

ALTER TABLE public.correction_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "correction_requests_insert_own" ON public.correction_requests;
CREATE POLICY "correction_requests_insert_own" ON public.correction_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_plant_access(plant_id)
    AND submitted_by = auth.uid()
  );

DROP POLICY IF EXISTS "correction_requests_select_plant" ON public.correction_requests;
CREATE POLICY "correction_requests_select_plant" ON public.correction_requests
  FOR SELECT TO authenticated
  USING (public.user_has_plant_access(plant_id));

DROP POLICY IF EXISTS "correction_requests_resolve_approvers" ON public.correction_requests;
CREATE POLICY "correction_requests_resolve_approvers" ON public.correction_requests
  FOR UPDATE TO authenticated
  USING (public.is_manager_or_analyst_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id))
  WITH CHECK (public.is_manager_or_analyst_or_admin(auth.uid()) AND public.user_has_plant_access(plant_id));

NOTIFY pgrst, 'reload schema';
