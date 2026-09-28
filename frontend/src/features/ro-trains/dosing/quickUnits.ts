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
 * Only same-dimension conversions live here (mass to kg, volume to L). Mass to
 * volume needs a density and belongs to the Catalog & Containers view, so it is
 * deliberately not offered in Quick Mode.
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

/**
 * Builds the unit list for one Quick Mode field: plain units first, then the
 * standard containers, then any container units the plant's catalog defines for
 * products in the same family with the same base unit. Plant-specific catalog
 * rows override global rows that share the same product and label.
 */
export function buildQuickUnitOptions(
  key: QuickChemKey,
  catalog: ChemicalCatalogItem[] | undefined,
  units: CatalogUnitItem[] | undefined,
  plantId: string | null | undefined,
): QuickUnitOption[] {
  const { family, baseUnit } = QUICK_CHEMICALS[key];
  const options: QuickUnitOption[] = [...(baseUnit === 'kg' ? MASS_UNITS : VOLUME_UNITS)];
  const seen = new Set<string>();

  const push = (label: string, shortLabel: string, factor: number) => {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const dedupe = `${label.toLowerCase()}|${factor}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    options.push({ id: `c:${label}`, label, shortLabel, factorToBase: factor });
  };

  CONTAINER_PRESETS[baseUnit]
    .filter((p) => !p.family || p.family === family)
    .forEach((p) => push(p.label, p.label.replace(/\s*\(.*\)$/, ''), p.factor));

  const productIds = new Set(
    (catalog ?? [])
      .filter((p) => p.family === family && p.base_unit === baseUnit && p.is_active)
      .map((p) => p.id),
  );

  // Global rows first, then plant rows replace them (same product + label).
  const byProductAndLabel = new Map<string, CatalogUnitItem>();
  const relevant = (units ?? []).filter(
    (u) => productIds.has(u.catalog_id) && (u.plant_id === null || u.plant_id === plantId),
  );
  relevant
    .filter((u) => u.plant_id === null)
    .forEach((u) => byProductAndLabel.set(`${u.catalog_id}|${u.unit_label.toLowerCase()}`, u));
  relevant
    .filter((u) => u.plant_id !== null)
    .forEach((u) => byProductAndLabel.set(`${u.catalog_id}|${u.unit_label.toLowerCase()}`, u));

  Array.from(byProductAndLabel.values())
    .sort((a, b) => a.factor_to_base - b.factor_to_base)
    .forEach((u) => {
      // The base unit itself (factor 1, label kg / L) is already in the list.
      if (u.factor_to_base === 1 && ['kg', 'l', 'kilogram', 'litre', 'liter'].includes(u.unit_label.toLowerCase())) return;
      push(`${u.unit_label} (${fmtFactor(u.factor_to_base)} ${baseUnit})`, u.unit_label, u.factor_to_base);
    });

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
