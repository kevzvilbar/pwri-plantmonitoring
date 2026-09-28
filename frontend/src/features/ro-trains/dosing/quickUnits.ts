/**
 * quickUnits.ts
 *
 * Unit choices for Quick Mode entry on the Chemical Dosing form.
 *
 * Quick Mode always STORES the legacy columns in their base unit
 * (chlorine_kg / smbs_kg / soda_ash_kg in kg, anti_scalant_l in L), exactly as
 * before. The operator may TYPE the amount in another unit (g, lb, a bag, a
 * drum, mL, gallons ...). This module turns what was typed into the base unit.
 *
 * Two kinds of unit are offered:
 *  - Same dimension as the column (kg columns: g, lb, bags, drums; the L column:
 *    mL, gallons, carboys, drums). These are exact.
 *  - The other dimension (litres for a kg column, kg for the L column). These
 *    need a density, taken from the catalog's liquid product for that chemical
 *    (for example Chlorine - Liquid, 1.20 kg/L). If the catalog has no density
 *    for the chemical, the cross options are simply not offered; nothing is
 *    guessed.
 *
 * A converted amount is the kg (or L) of PRODUCT, the same meaning the Quick
 * Mode columns have always had. It is not kg as Cl2 or another active basis;
 * that lives in Catalog & Containers.
 */

import type { CatalogUnitItem, ChemicalCatalogItem } from './useChemCatalog';

export type QuickChemKey = 'chlorine_kg' | 'smbs_kg' | 'anti_scalant_l' | 'soda_ash_kg';

export type QuickBaseUnit = 'kg' | 'L';

export interface QuickUnitOption {
  /** Stable id kept in component state, for example "kg" or "c:Bag (25 kg)". */
  id: string;
  /** Full label shown in the dropdown list. */
  label: string;
  /** Short label shown on the card next to the number. */
  shortLabel: string;
  /** How many base units (kg or L) one of this unit is. */
  factorToBase: number;
  /** Dropdown section: the column's own dimension first, the converted one second. */
  group?: 'Weight' | 'Volume';
  /** Set on converted (cross-dimension) units: which density was used. */
  note?: string;
}

/** Which catalog family and base unit each Quick Mode field belongs to. */
export const QUICK_CHEMICALS: Record<QuickChemKey, { family: string; baseUnit: QuickBaseUnit }> = {
  chlorine_kg: { family: 'chlorine', baseUnit: 'kg' },
  smbs_kg: { family: 'smbs', baseUnit: 'kg' },
  soda_ash_kg: { family: 'soda_ash', baseUnit: 'kg' },
  anti_scalant_l: { family: 'anti_scalant', baseUnit: 'L' },
};

export const DEFAULT_QUICK_UNITS: Record<QuickChemKey, string> = {
  chlorine_kg: 'kg',
  smbs_kg: 'kg',
  soda_ash_kg: 'kg',
  anti_scalant_l: 'L',
};

// Exact conversion constants (international pound, US liquid gallon).
const LB_TO_KG = 0.45359237;
const US_GAL_TO_L = 3.785411784;

const MASS_UNITS: QuickUnitOption[] = [
  { id: 'kg', label: 'Kilograms (kg)', shortLabel: 'kg', factorToBase: 1 },
  { id: 'g', label: 'Grams (g)', shortLabel: 'g', factorToBase: 0.001 },
  { id: 'lb', label: 'Pounds (lb)', shortLabel: 'lb', factorToBase: LB_TO_KG },
];

const VOLUME_UNITS: QuickUnitOption[] = [
  { id: 'L', label: 'Litres (L)', shortLabel: 'L', factorToBase: 1 },
  { id: 'mL', label: 'Millilitres (mL)', shortLabel: 'mL', factorToBase: 0.001 },
  { id: 'gal', label: 'US gallons (gal)', shortLabel: 'gal', factorToBase: US_GAL_TO_L },
];

/** Same container presets the Catalog & Containers cards offer, so both modes match. */
const CONTAINER_PRESETS: Record<QuickBaseUnit, Array<{ label: string; factor: number; family?: string }>> = {
  kg: [
    { label: 'Bag (25 kg)', factor: 25 },
    { label: 'Drum (50 kg)', factor: 50 },
    { label: 'Gas Cylinder (68 kg)', factor: 68, family: 'chlorine' },
  ],
  L: [
    { label: 'Carboy (20 L)', factor: 20 },
    { label: 'Drum (200 L)', factor: 200 },
    { label: 'IBC Tote (1,000 L)', factor: 1000 },
  ],
};

function fmtFactor(n: number): string {
  return Number(n.toFixed(4)).toLocaleString('en-US', { maximumFractionDigits: 4 });
}

/** Catalog unit rows for a set of products: global first, plant rows override, smallest first. */
function collectCatalogUnits(
  productIds: Set<string>,
  units: CatalogUnitItem[] | undefined,
  plantId: string | null | undefined,
): CatalogUnitItem[] {
  const byProductAndLabel = new Map<string, CatalogUnitItem>();
  const relevant = (units ?? []).filter(
    (u) => productIds.has(u.catalog_id) && (u.plant_id === null || u.plant_id === plantId),
  );
  const put = (u: CatalogUnitItem) => byProductAndLabel.set(`${u.catalog_id}|${u.unit_label.toLowerCase()}`, u);
  relevant.filter((u) => u.plant_id === null).forEach(put);
  relevant.filter((u) => u.plant_id !== null).forEach(put);
  return Array.from(byProductAndLabel.values()).sort((a, b) => a.factor_to_base - b.factor_to_base);
}

/** True when a catalog row just repeats the base unit ("kg", "L") and would be a duplicate entry. */
function repeatsBaseUnit(u: CatalogUnitItem): boolean {
  return u.factor_to_base === 1 && ['kg', 'l', 'kilogram', 'litre', 'liter'].includes(u.unit_label.toLowerCase());
}

/**
 * Builds the unit list for one Quick Mode field: the column's own units first
 * (plain units, standard containers, then any container units the plant's
 * catalog defines for the same family and base unit), then, where the catalog
 * has a density, the other dimension. Plant-specific catalog rows override
 * global rows that share the same product and label.
 */
export function buildQuickUnitOptions(
  key: QuickChemKey,
  catalog: ChemicalCatalogItem[] | undefined,
  units: CatalogUnitItem[] | undefined,
  plantId: string | null | undefined,
): QuickUnitOption[] {
  const { family, baseUnit } = QUICK_CHEMICALS[key];
  const ownGroup = baseUnit === 'kg' ? 'Weight' : 'Volume';
  const options: QuickUnitOption[] = (baseUnit === 'kg' ? MASS_UNITS : VOLUME_UNITS).map((o) => ({
    ...o,
    group: ownGroup,
  }));
  const seen = new Set<string>();

  const push = (
    idPrefix: string,
    group: 'Weight' | 'Volume',
    label: string,
    shortLabel: string,
    factor: number,
    note?: string,
  ) => {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const dedupe = `${idPrefix}|${label.toLowerCase()}|${factor}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    options.push({ id: `${idPrefix}${label}`, label, shortLabel, factorToBase: factor, group, ...(note ? { note } : {}) });
  };

  // ── Same dimension as the column ─────────────────────────────────────────
  CONTAINER_PRESETS[baseUnit]
    .filter((p) => !p.family || p.family === family)
    .forEach((p) => push('c:', ownGroup, p.label, p.label.replace(/\s*\(.*\)$/, ''), p.factor));

  const activeOfFamily = (catalog ?? []).filter((p) => p.family === family && p.is_active);

  const sameIds = new Set(activeOfFamily.filter((p) => p.base_unit === baseUnit).map((p) => p.id));
  collectCatalogUnits(sameIds, units, plantId)
    .filter((u) => !repeatsBaseUnit(u))
    .forEach((u) =>
      push('c:', ownGroup, `${u.unit_label} (${fmtFactor(u.factor_to_base)} ${baseUnit})`, u.unit_label, u.factor_to_base),
    );

  // ── The other dimension, through the catalog density ─────────────────────
  // The density comes from the family's liquid product: the lowest sort_order
  // active product in litres that has a density. None found means no cross
  // options (for a kg column: no litres; for the L column: no kg).
  const liquid = activeOfFamily
    .filter((p) => p.base_unit === 'L' && (p.density_kg_per_l ?? 0) > 0)
    .sort((a, b) => a.sort_order - b.sort_order)[0];

  if (liquid && liquid.density_kg_per_l) {
    const density = liquid.density_kg_per_l; // kg per litre of product
    const note = `${fmtFactor(density)} kg/L, ${liquid.name}`;

    if (baseUnit === 'kg') {
      // Litre-type units on a kg column: kg = litres x density.
      VOLUME_UNITS.filter((v) => v.id !== 'gal').forEach((v) =>
        push('x:', 'Volume', v.label, v.shortLabel, v.factorToBase * density, note),
      );
      CONTAINER_PRESETS.L.forEach((p) =>
        push('x:', 'Volume', p.label, p.label.replace(/\s*\(.*\)$/, ''), p.factor * density, note),
      );
      collectCatalogUnits(new Set([liquid.id]), units, plantId)
        .filter((u) => !repeatsBaseUnit(u))
        .forEach((u) =>
          push('x:', 'Volume', `${u.unit_label} (${fmtFactor(u.factor_to_base)} L)`, u.unit_label, u.factor_to_base * density, note),
        );
    } else {
      // Weight units on the litre column: litres = kg / density.
      MASS_UNITS.forEach((m) => push('x:', 'Weight', m.label, m.shortLabel, m.factorToBase / density, note));
    }
  }

  return options;
}

/** Finds an option by id, falling back to the base unit if the id is no longer offered. */
export function findQuickUnit(options: QuickUnitOption[], id: string | undefined): QuickUnitOption {
  return options.find((o) => o.id === id) ?? options[0];
}

/**
 * Converts what the operator typed into the base unit (kg or L), rounded to 4
 * decimals to match how the form stores it. Empty or non-numeric input gives 0,
 * the same as the form's existing `+value || 0`; the value is otherwise passed
 * through unchanged, so validation of odd numbers stays where it already was.
 */
export function quickToBase(raw: string | number | null | undefined, factorToBase: number): number {
  const qty = typeof raw === 'number' ? raw : +(raw ?? '');
  if (!Number.isFinite(qty) || qty === 0 || !Number.isFinite(factorToBase) || factorToBase <= 0) return 0;
  return +(qty * factorToBase).toFixed(4);
}
