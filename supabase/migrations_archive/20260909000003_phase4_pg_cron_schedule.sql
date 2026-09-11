-- =============================================================================
-- Phase 4: Database Hardening - pg_cron Schedule for Async Cost Computation
-- =============================================================================
-- Schedule the compute-production-costs Edge Function to run every 5 minutes
-- This replaces the synchronous cost triggers with async computation.

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule: Every 5 minutes, recompute costs for last 7 days
SELECT cron.schedule(
  'compute-production-costs-every-5min',
  '*/5 * * * *', -- Every 5 minutes
  $$
  SELECT net.http_post(
    url := 'https://' || current_setting('app.supabase_url') || '/functions/v1/compute-production-costs',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'date_from', (CURRENT_DATE - INTERVAL '7 days')::text,
      'date_to', CURRENT_DATE::text
    )
  ) AS request_id;
  $$
);

-- Optional: Daily full recompute at 2 AM (catches any missed days)
SELECT cron.schedule(
  'compute-production-costs-daily-full',
  '0 2 * * *', -- 2:00 AM daily
  $$
  SELECT net.http_post(
    url := 'https://' || current_setting('app.supabase_url') || '/functions/v1/compute-production-costs',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'date_from', (CURRENT_DATE - INTERVAL '30 days')::text,
      'date_to', CURRENT_DATE::text,
      'force_recompute', true
    )
  ) AS request_id;
  $$
);

-- =============================================================================
-- END OF PG_CRON SCHEDULE
-- =============================================================================