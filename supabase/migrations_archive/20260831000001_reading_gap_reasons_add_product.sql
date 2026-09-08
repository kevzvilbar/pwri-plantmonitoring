-- =============================================================================
-- Migration: 20260831000001_reading_gap_reasons_add_product.sql
-- Extends reading_gap_reasons entity_type check to include 'product' meters.
-- =============================================================================

ALTER TABLE reading_gap_reasons DROP CONSTRAINT IF EXISTS reading_gap_reasons_entity_type_check;
ALTER TABLE reading_gap_reasons ADD CONSTRAINT reading_gap_reasons_entity_type_check
  CHECK (entity_type IN ('well', 'locator', 'ro_train', 'blending', 'product'));

