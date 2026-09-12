-- RO Train per-stream EM vs. manual meter configuration
--
-- Adds 5 boolean columns to ro_trains so Plant Configuration can mark each
-- train feed/permeate/reject streams as electromagnetic-flowmeter-capable
-- or manual-totalizer-only. All default true so existing trains keep today's
-- behavior (EM fields visible, EM preferred when entered) until explicitly
-- marked manual for a stream.
--
-- Used by:
--   - frontend/src/lib/trainEmMeter.ts (trainUsesEmForStream helper)
--   - frontend/src/pages/ROTrains/pretreatment/hooks/usePretreatmentCalculations.ts
--     (guards effXFlow so manual-only streams are never backfilled via
--      subtraction from the other two streams' EM values)
--   - frontend/src/pages/plants/config/sections/RoTrainsMeterSection.tsx
--     (per-train EM config UI)

ALTER TABLE ro_trains
  ADD COLUMN uses_em_meter      boolean NOT NULL DEFAULT true,
  ADD COLUMN em_all_streams     boolean NOT NULL DEFAULT true,
  ADD COLUMN em_stream_feed     boolean NOT NULL DEFAULT true,
  ADD COLUMN em_stream_permeate boolean NOT NULL DEFAULT true,
  ADD COLUMN em_stream_reject   boolean NOT NULL DEFAULT true;

-- No backfill needed: defaults preserve existing behavior.
