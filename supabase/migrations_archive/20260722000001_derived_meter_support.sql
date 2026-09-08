-- Derived-meter support (Section 7.3 of master plan)
-- Allows a locator to be marked as "has no physical meter" with its value
-- derived from mother-meter minus all sibling locators. Optionally mirrors
-- the computed value into a product_meters row on another plant.

ALTER TABLE locators
  ADD COLUMN IF NOT EXISTS is_derived        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS derived_from_meter_id UUID REFERENCES product_meters(id);

ALTER TABLE product_meters
  ADD COLUMN IF NOT EXISTS is_derived             BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS derived_from_locator_id UUID REFERENCES locators(id);

-- Index for the cron sweep to find derived locators quickly
CREATE INDEX IF NOT EXISTS idx_locators_is_derived
  ON locators (is_derived) WHERE is_derived = true;

CREATE INDEX IF NOT EXISTS idx_product_meters_is_derived
  ON product_meters (is_derived) WHERE is_derived = true;

COMMENT ON COLUMN locators.is_derived IS
  'When true, this locator has no physical meter; its reading is computed as mother_meter − Σ(sibling locators).';
COMMENT ON COLUMN locators.derived_from_meter_id IS
  'The product meter (mother meter) this derived locator''s reading is subtracted from. NULL when is_derived=false.';
COMMENT ON COLUMN product_meters.is_derived IS
  'When true, this meter''s reading is a mirror of a derived locator from another plant.';
COMMENT ON COLUMN product_meters.derived_from_locator_id IS
  'The locator whose derived value is mirrored into this product meter row. NULL when is_derived=false.';
