-- =============================================================================
-- 20260916000003_train_tables_realtime_publication.sql
-- Adds the RO-train tables to the Supabase Realtime publication so the
-- frontend can react to inserts instantly instead of relying on 5-minute
-- polling (RO_TRAIN_ALERT_SYSTEM_RECONCILIATION.md §3 item 1, priority P2).
--
-- Consumers: hooks/useTrainDataRealtime.ts subscribes to INSERT events on
-- these three tables and invalidates the train-related react-query caches —
-- the same pattern TrendChart.tsx has used for power/chemical readings since
-- the 2026-08 dashboard realtime work.
--
-- WHY THESE THREE TABLES
--   ro_train_readings / ro_pretreatment_readings — every production reading
--     (freshness of train cards, hourly-gap alerts, operator log).
--   train_status_log — every Running/Offline/Maintenance transition (banner
--     pipeline, auto-flag confirmation, downtime windows).
--
-- RLS: postgres_changes subscribers receive only rows their session's RLS
-- policies expose. All three tables carry the standard user_has_plant_access
-- policies, so an operator only ever receives events for their plants.
--
-- IDEMPOTENT: follows the same pattern as
-- 20260901000003_user_presence_and_activity_tracking.sql — check
-- pg_publication_tables before altering, so re-running (or applying to a
-- project where the table was already added via the dashboard) is a no-op.
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    -- ro_train_readings
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'ro_train_readings'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.ro_train_readings;
    END IF;

    -- ro_pretreatment_readings
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'ro_pretreatment_readings'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.ro_pretreatment_readings;
    END IF;

    -- train_status_log
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'train_status_log'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.train_status_log;
    END IF;
  END IF;
END $$;
