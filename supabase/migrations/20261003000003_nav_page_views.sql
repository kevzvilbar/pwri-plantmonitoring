-- =============================================================================
-- Migration: 20261003000003_nav_page_views.sql
-- Description:
--   Anonymous navigation telemetry for the IA review
--   (docs/IA-NAV-USERFLOW-CRITIQUE-AND-PLAN.md, task IA0-1).
--
--   One row per page view: which route (normalised, never an id), which tab,
--   which role, mobile or desktop, and a random per-browser-tab session id.
--   Deliberately NO user_id, plant id, IP or free text, so rows cannot be
--   tied back to a person. `role` is self-reported by the client and is for
--   aggregate analysis only; do not use it for access decisions.
--
--   Access:
--     INSERT  any signed-in user (column CHECKs bound what can be written)
--     SELECT  Admin only
--     DELETE  Admin only (retention: delete rows older than 90 days;
--             service_role bypasses RLS for a scheduled job)
--     anon    nothing
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.nav_page_views (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  session_id  text        NOT NULL,
  route       text        NOT NULL,
  tab         text,
  role        text,
  device      text        NOT NULL,
  CONSTRAINT nav_page_views_session_id_len CHECK (char_length(session_id) BETWEEN 8 AND 64),
  CONSTRAINT nav_page_views_route_shape    CHECK (char_length(route) <= 120 AND route ~ '^/[A-Za-z0-9/:_*-]*$'),
  CONSTRAINT nav_page_views_tab_shape      CHECK (tab IS NULL OR tab ~ '^[a-z0-9-]{1,32}$'),
  CONSTRAINT nav_page_views_role_known     CHECK (role IS NULL OR role IN ('Operator', 'Technician', 'Manager', 'Admin', 'Data Analyst')),
  CONSTRAINT nav_page_views_device_known   CHECK (device IN ('mobile', 'desktop'))
);

CREATE INDEX IF NOT EXISTS nav_page_views_occurred_at_idx
  ON public.nav_page_views (occurred_at DESC);

ALTER TABLE public.nav_page_views ENABLE ROW LEVEL SECURITY;

-- New public tables get broad default grants in Supabase; start from nothing.
REVOKE ALL ON public.nav_page_views FROM PUBLIC, anon, authenticated;
GRANT INSERT, SELECT, DELETE ON public.nav_page_views TO authenticated;
GRANT ALL ON public.nav_page_views TO service_role;

DROP POLICY IF EXISTS nav_page_views_insert ON public.nav_page_views;
CREATE POLICY nav_page_views_insert ON public.nav_page_views
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS nav_page_views_select_admin ON public.nav_page_views;
CREATE POLICY nav_page_views_select_admin ON public.nav_page_views
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS nav_page_views_delete_admin ON public.nav_page_views;
CREATE POLICY nav_page_views_delete_admin ON public.nav_page_views
  FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

COMMENT ON TABLE public.nav_page_views IS
  'Anonymous page-view telemetry for IA decisions. No user id by design. Keep 90 days.';
