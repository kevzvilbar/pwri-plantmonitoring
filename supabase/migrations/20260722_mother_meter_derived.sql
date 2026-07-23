-- ============================================================
-- §7.3 — Mother Meter / Locators derived-meter config
-- ============================================================
--
-- CONTEXT:
--   The "Hamas case" (plant SRP supplies Mambaling through a shared
--   pipeline).  A locator at SRP (Hamas) has no physical meter — its
--   daily volume is derived: total through the mother product meter
--   minus the sum of all other metered locators on the same meter.
--   That derived value must also mirror into a product_meters row at
--   Mambaling so NRW/Dashboard on BOTH plants remain self-consistent.
--
--   Key insight: calc.nrw() is already a single formula fed by pivot
--   sums grouped by plant_id.  No NRW or Dashboard code changes are
--   needed — the feature reduces to "compute one number, write it into
--   two existing tables."
--
-- SCHEMA ADDITIONS:
--   locators
--     is_derived            BOOL  — true = no physical meter; value computed
--     derived_from_meter_id UUID  — the product_meter whose readings are the
--                                   basis for residual computation
--
--   product_meters
--     is_derived            BOOL  — true = mirrors a derived locator's value
--     derived_from_locator_id UUID — which locator provides the value to mirror
--
-- CONSTRAINT:
--   At most ONE derived (is_derived=true) locator per mother meter
--   is enforced via a partial unique index.  The residual formula has
--   no unique answer for two unknowns.

-- ── locators ──────────────────────────────────────────────────────────────────
ALTER TABLE public.locators
  ADD COLUMN IF NOT EXISTS is_derived              boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS derived_from_meter_id   uuid    REFERENCES public.product_meters(id) ON DELETE SET NULL;

-- Enforce at most one derived locator per mother meter at the DB level.
-- A partial unique index is cheaper than a trigger and self-documenting.
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_derived_locator_per_meter
  ON public.locators (derived_from_meter_id)
  WHERE is_derived = true AND derived_from_meter_id IS NOT NULL;

-- ── product_meters ────────────────────────────────────────────────────────────
ALTER TABLE public.product_meters
  ADD COLUMN IF NOT EXISTS is_derived               boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS derived_from_locator_id  uuid    REFERENCES public.locators(id) ON DELETE SET NULL;

-- ── is_estimated — mark cron-computed readings so the UI can distinguish them ─
-- Operator-entered readings are is_estimated=false (default).
-- Cron-computed derived readings are is_estimated=true so they can be filtered
-- or labelled in DataSummaryModal and the per-locator history view.
ALTER TABLE public.locator_readings
  ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.product_meter_readings
  ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN NOT NULL DEFAULT false;

-- ── Derived-meter sweep audit table ──────────────────────────────────────────
-- Records every cron run so we can answer "when was this derived value last
-- recomputed?" and skip dates already processed (incremental, not full-history).
CREATE TABLE IF NOT EXISTS public.derived_meter_sweep_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  swept_at        timestamptz NOT NULL DEFAULT now(),
  locator_id      uuid        NOT NULL REFERENCES public.locators(id)  ON DELETE CASCADE,
  date_key        date        NOT NULL,
  old_value       numeric,
  new_value       numeric,
  changed         boolean     NOT NULL DEFAULT false,
  mirror_meter_id uuid        REFERENCES public.product_meters(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_dms_log_locator_date
  ON public.derived_meter_sweep_log (locator_id, date_key);

-- ── RLS: service-role only (cron job uses service key) ───────────────────────
-- Regular users never read/write this table directly; it's an internal audit log.
ALTER TABLE public.derived_meter_sweep_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY derived_meter_sweep_log_service_only
  ON public.derived_meter_sweep_log
  FOR ALL
  USING (auth.role() = 'service_role');
