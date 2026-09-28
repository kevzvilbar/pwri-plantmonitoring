import { describe, it, expect } from 'vitest';
import {
  buildQuickUnitOptions,
  findQuickUnit,
  quickToBase,
  DEFAULT_QUICK_UNITS,
} from './quickUnits';
import type { CatalogUnitItem, ChemicalCatalogItem } from './useChemCatalog';

const product = (over: Partial<ChemicalCatalogItem>): ChemicalCatalogItem => ({
  id: 'p1',
  name: 'Soda Ash - Powder',
  price_key: 'Soda Ash - Powder (kg)',
  legacy_name: 'Soda Ash',
  family: 'soda_ash',
  category: 'process',
  form: 'powder',
  base_unit: 'kg',
  strength_pct: 99,
  strength_basis: 'w/w',
  density_kg_per_l: null,
  reference_basis: 'Na2CO3',
  methods: null,
  sample_volume_ml: null,
  qty_per_test: null,
  drops_per_test: null,
  ml_per_drop: null,
  process_stage: null,
  sort_order: 80,
  is_active: true,
  ...over,
});

const unit = (over: Partial<CatalogUnitItem>): CatalogUnitItem => ({
  id: 'u1',
  catalog_id: 'p1',
  plant_id: null,
  unit_label: 'Sack',
  factor_to_base: 40,
  is_default: false,
  ...over,
});

describe('quickToBase', () => {
  it('converts mass and volume units exactly', () => {
    expect(quickToBase('500', 0.001)).toBe(0.5); // 500 g -> kg
    expect(quickToBase('10', 0.45359237)).toBe(4.5359); // 10 lb -> kg
    expect(quickToBase('2', 25)).toBe(50); // 2 bags of 25 kg
    expect(quickToBase('250', 0.001)).toBe(0.25); // 250 mL -> L
    expect(quickToBase('5', 3.785411784)).toBe(18.9271); // 5 US gal -> L
  });

  it('keeps the base unit untouched', () => {
    expect(quickToBase('1.5', 1)).toBe(1.5);
  });

  it('treats empty and non-numeric input as 0, like the old +value || 0', () => {
    expect(quickToBase('', 25)).toBe(0);
    expect(quickToBase('abc', 25)).toBe(0);
    expect(quickToBase(undefined, 25)).toBe(0);
    expect(quickToBase(null, 25)).toBe(0);
  });

  it('returns 0 for an unusable factor instead of NaN or Infinity', () => {
    expect(quickToBase('5', 0)).toBe(0);
    expect(quickToBase('5', -1)).toBe(0);
    expect(quickToBase('5', NaN)).toBe(0);
  });
});

describe('buildQuickUnitOptions', () => {
  it('offers kg, g, lb and the standard containers for a mass chemical with no catalog', () => {
    const ids = buildQuickUnitOptions('smbs_kg', undefined, undefined, null).map((o) => o.id);
    expect(ids).toEqual(['kg', 'g', 'lb', 'c:Bag (25 kg)', 'c:Drum (50 kg)']);
  });

  it('offers L, mL, gal and volume containers for anti scalant', () => {
    const ids = buildQuickUnitOptions('anti_scalant_l', undefined, undefined, null).map((o) => o.id);
    expect(ids).toEqual(['L', 'mL', 'gal', 'c:Carboy (20 L)', 'c:Drum (200 L)', 'c:IBC Tote (1,000 L)']);
  });

  it('adds the 68 kg gas cylinder for chlorine only', () => {
    const cl = buildQuickUnitOptions('chlorine_kg', undefined, undefined, null).map((o) => o.id);
    const smbs = buildQuickUnitOptions('smbs_kg', undefined, undefined, null).map((o) => o.id);
    expect(cl).toContain('c:Gas Cylinder (68 kg)');
    expect(smbs).not.toContain('c:Gas Cylinder (68 kg)');
  });

  it('every option converts to a positive factor and the first is the base unit', () => {
    (['chlorine_kg', 'smbs_kg', 'soda_ash_kg', 'anti_scalant_l'] as const).forEach((k) => {
      const opts = buildQuickUnitOptions(k, undefined, undefined, null);
      expect(opts[0].id).toBe(DEFAULT_QUICK_UNITS[k]);
      expect(opts[0].factorToBase).toBe(1);
      opts.forEach((o) => expect(o.factorToBase).toBeGreaterThan(0));
    });
  });

  it('adds catalog units for the same family and base unit, labelled like the catalog cards', () => {
    const opts = buildQuickUnitOptions(
      'soda_ash_kg',
      [product({})],
      [unit({ unit_label: 'Sack', factor_to_base: 40 })],
      'plant-1',
    );
    const sack = opts.find((o) => o.id === 'c:Sack (40 kg)');
    expect(sack).toBeDefined();
    expect(sack?.factorToBase).toBe(40);
    expect(sack?.shortLabel).toBe('Sack');
  });

  it('does not duplicate a catalog unit that matches a standard container', () => {
    const opts = buildQuickUnitOptions(
      'soda_ash_kg',
      [product({})],
      [unit({ unit_label: 'Bag', factor_to_base: 25 })],
      null,
    );
    expect(opts.filter((o) => o.factorToBase === 25)).toHaveLength(1);
  });

  it('ignores units of other families, other base units, inactive products and other plants', () => {
    const catalog = [
      product({ id: 'p1' }),
      product({ id: 'p2', family: 'smbs', name: 'SMBS - Powder' }),
      product({ id: 'p3', base_unit: 'L', name: 'Soda Ash - Solution' }),
      product({ id: 'p4', is_active: false }),
    ];
    const units = [
      unit({ id: 'a', catalog_id: 'p2', unit_label: 'SmbsBag', factor_to_base: 30 }),
      unit({ id: 'b', catalog_id: 'p3', unit_label: 'Jug', factor_to_base: 5 }),
      unit({ id: 'c', catalog_id: 'p4', unit_label: 'Ghost', factor_to_base: 7 }),
      unit({ id: 'd', catalog_id: 'p1', plant_id: 'other-plant', unit_label: 'Elsewhere', factor_to_base: 9 }),
    ];
    const ids = buildQuickUnitOptions('soda_ash_kg', catalog, units, 'plant-1').map((o) => o.id);
    expect(ids).toEqual(['kg', 'g', 'lb', 'c:Bag (25 kg)', 'c:Drum (50 kg)']);
  });

  it('lets a plant-specific unit override a global one with the same label', () => {
    const opts = buildQuickUnitOptions(
      'soda_ash_kg',
      [product({})],
      [
        unit({ id: 'g1', plant_id: null, unit_label: 'Sack', factor_to_base: 40 }),
        unit({ id: 'g2', plant_id: 'plant-1', unit_label: 'Sack', factor_to_base: 35 }),
      ],
      'plant-1',
    );
    const sacks = opts.filter((o) => o.shortLabel === 'Sack');
    expect(sacks).toHaveLength(1);
    expect(sacks[0].factorToBase).toBe(35);
  });

  it('skips catalog rows with a bad factor and rows that just repeat the base unit', () => {
    const opts = buildQuickUnitOptions(
      'soda_ash_kg',
      [product({})],
      [
        unit({ id: 'x', unit_label: 'Broken', factor_to_base: 0 }),
        unit({ id: 'y', unit_label: 'kg', factor_to_base: 1 }),
      ],
      null,
    );
    expect(opts.map((o) => o.id)).toEqual(['kg', 'g', 'lb', 'c:Bag (25 kg)', 'c:Drum (50 kg)']);
  });
});

describe('findQuickUnit', () => {
  it('falls back to the base unit when the saved id is no longer offered', () => {
    const opts = buildQuickUnitOptions('smbs_kg', undefined, undefined, null);
    expect(findQuickUnit(opts, 'c:Removed (99 kg)').id).toBe('kg');
    expect(findQuickUnit(opts, undefined).id).toBe('kg');
    expect(findQuickUnit(opts, 'lb').factorToBase).toBeCloseTo(0.45359237, 8);
  });
});

// ── Litres on a kg column, kg on the litre column (through the catalog density) ──
describe('cross-dimension units (density from the catalog liquid product)', () => {
  const chlorineLiquid = product({
    id: 'cl-l', name: 'Chlorine - Liquid', family: 'chlorine', base_unit: 'L',
    density_kg_per_l: 1.2, sort_order: 10, strength_pct: 12, strength_basis: 'w/v',
  });
  const chlorineGranules = product({
    id: 'cl-g', name: 'Chlorine - Granules', family: 'chlorine', base_unit: 'kg',
    density_kg_per_l: null, sort_order: 20,
  });
  const antiScalantLiquid = product({
    id: 'as-l', name: 'Anti Scalant - Liquid', family: 'anti_scalant', base_unit: 'L',
    density_kg_per_l: 1.15, sort_order: 60,
  });

  it('offers litres, mL and litre containers on the chlorine column, converted to kg of product', () => {
    const opts = buildQuickUnitOptions('chlorine_kg', [chlorineLiquid, chlorineGranules], [], 'plant-1');
    const byId = Object.fromEntries(opts.map((o) => [o.id, o]));

    expect(byId['x:Litres (L)'].factorToBase).toBeCloseTo(1.2, 8);
    expect(byId['x:Millilitres (mL)'].factorToBase).toBeCloseTo(0.0012, 8);
    expect(byId['x:Carboy (20 L)'].factorToBase).toBeCloseTo(24, 8);
    expect(byId['x:Drum (200 L)'].factorToBase).toBeCloseTo(240, 8);
    expect(byId['x:Litres (L)'].group).toBe('Volume');
    expect(byId['x:Litres (L)'].note).toBe('1.2 kg/L, Chlorine - Liquid');
    // The column's own units are untouched and still come first.
    expect(opts[0].id).toBe('kg');
    expect(byId['kg'].group).toBe('Weight');
    // No US gallons on a converted column (kept to the metric units plants use).
    expect(byId['x:US gallons (gal)']).toBeUndefined();
  });

  it('20 L of 1.20 kg/L liquid chlorine is 24 kg; 500 mL is 0.6 kg', () => {
    const opts = buildQuickUnitOptions('chlorine_kg', [chlorineLiquid], [], null);
    const litres = findQuickUnit(opts, 'x:Litres (L)');
    const ml = findQuickUnit(opts, 'x:Millilitres (mL)');
    expect(quickToBase('20', litres.factorToBase)).toBe(24);
    expect(quickToBase('500', ml.factorToBase)).toBe(0.6);
  });

  it('offers kg, g and lb on the anti scalant (litre) column, converted to litres', () => {
    const opts = buildQuickUnitOptions('anti_scalant_l', [antiScalantLiquid], [], null);
    const kg = findQuickUnit(opts, 'x:Kilograms (kg)');
    expect(kg.group).toBe('Weight');
    expect(kg.note).toBe('1.15 kg/L, Anti Scalant - Liquid');
    expect(quickToBase('23', kg.factorToBase)).toBe(20); // 23 kg / 1.15 = 20 L
    expect(quickToBase('1000', findQuickUnit(opts, 'x:Grams (g)').factorToBase)).toBeCloseTo(0.8696, 4);
    expect(opts[0].id).toBe('L');
  });

  it('adds catalog container units of the liquid product, converted through the density', () => {
    const opts = buildQuickUnitOptions(
      'chlorine_kg',
      [chlorineLiquid],
      [unit({ id: 'j', catalog_id: 'cl-l', unit_label: 'Jerrycan', factor_to_base: 30 })],
      null,
    );
    const jerry = opts.find((o) => o.id === 'x:Jerrycan (30 L)');
    expect(jerry?.factorToBase).toBeCloseTo(36, 8);
  });

  it('offers no cross units when there is no liquid product or no density', () => {
    const idsOf = (cat: ChemicalCatalogItem[]) =>
      buildQuickUnitOptions('chlorine_kg', cat, [], null).map((o) => o.id);
    // no catalog at all, granules only, liquid without a density, liquid inactive
    expect(idsOf([])).not.toContain('x:Litres (L)');
    expect(idsOf([chlorineGranules])).not.toContain('x:Litres (L)');
    expect(idsOf([{ ...chlorineLiquid, density_kg_per_l: null }])).not.toContain('x:Litres (L)');
    expect(idsOf([{ ...chlorineLiquid, density_kg_per_l: 0 }])).not.toContain('x:Litres (L)');
    expect(idsOf([{ ...chlorineLiquid, is_active: false }])).not.toContain('x:Litres (L)');
    expect(
      buildQuickUnitOptions('anti_scalant_l', [{ ...antiScalantLiquid, density_kg_per_l: null }], [], null).map((o) => o.id),
    ).not.toContain('x:Kilograms (kg)');
  });

  it('uses the lowest sort_order liquid product when a family has more than one', () => {
    const second = { ...chlorineLiquid, id: 'cl-l2', name: 'Chlorine - Liquid 15%', density_kg_per_l: 1.25, sort_order: 15 };
    const opts = buildQuickUnitOptions('chlorine_kg', [second, chlorineLiquid], [], null);
    expect(findQuickUnit(opts, 'x:Litres (L)').note).toBe('1.2 kg/L, Chlorine - Liquid');
  });

  it('never mixes densities across families', () => {
    const opts = buildQuickUnitOptions('smbs_kg', [chlorineLiquid, antiScalantLiquid], [], null);
    expect(opts.some((o) => o.id.startsWith('x:'))).toBe(false);
  });

  it('a density of exactly 1 still counts as a converted unit (the hint must not hide it)', () => {
    const water = product({ id: 'w', name: 'Chlorine - Liquid', family: 'chlorine', base_unit: 'L', density_kg_per_l: 1 });
    const opts = buildQuickUnitOptions('chlorine_kg', [water], [], null);
    const l = findQuickUnit(opts, 'x:Litres (L)');
    expect(l.factorToBase).toBe(1);
    expect(l.id).not.toBe(opts[0].id);
  });

  it('every converted option has a positive factor, a group and a note', () => {
    (['chlorine_kg', 'anti_scalant_l'] as const).forEach((k) => {
      buildQuickUnitOptions(k, [chlorineLiquid, antiScalantLiquid], [], null)
        .filter((o) => o.id.startsWith('x:'))
        .forEach((o) => {
          expect(o.factorToBase).toBeGreaterThan(0);
          expect(o.group).toBeDefined();
          expect(o.note).toBeTruthy();
        });
    });
  });
});

