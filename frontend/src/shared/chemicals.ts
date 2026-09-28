/**
 * Single source of truth for the plant's closed set of "dosed" chemicals —
 * the ones metered per-train and recorded on chemical_dosing_logs.
 *
 * This is deliberately narrower than the full chemical catalog:
 *  - CIP chemicals are a separate, open, plant-configurable list (built-ins
 *    like Caustic Soda / HCl / SLS plus free-text custom names) — see
 *    ROTrains/cip/CIPLog.tsx. They are NOT part of PLANT_CHEMICALS.
 *  - Costs → Prices needs to cover both the dosed chemicals below AND the
 *    CIP-only ones, so it extends this list rather than replacing it.
 *
 * Previously this name+unit list, and the name→dosing-log-column mapping
 * that goes with it, were independently hardcoded in four places
 * (plants/shared.tsx, Costs.tsx, ROTrains/inventory/ChemInventory.tsx, and
 * Compliance.tsx), with no way to know they'd all been kept in sync short
 * of diffing them by hand. Consolidated here so a future 5th dosed chemical
 * only needs to be added in one place.
 */
export const PLANT_CHEMICALS = [
  { name: 'Chlorine',     defaultUnit: 'kg' },
  { name: 'SMBS',         defaultUnit: 'kg' },
  { name: 'Anti Scalant', defaultUnit: 'L'  },
  { name: 'Soda Ash',     defaultUnit: 'kg' },
];

export const KNOWN_CHEMICALS = PLANT_CHEMICALS;

/**
 * Maps a PLANT_CHEMICALS name to its daily-usage column on
 * chemical_dosing_logs. CIP-only chemicals (Caustic Soda, HCl, SLS, and any
 * custom CIP names) aren't dosed per-train and intentionally have no entry
 * here.
 */
export const CHEM_DOSING_COLUMN: Record<string, string> = {
  'Chlorine':     'chlorine_kg',
  'SMBS':         'smbs_kg',
  'Anti Scalant': 'anti_scalant_l',
  'Soda Ash':     'soda_ash_kg',
};

export const PROCESS_DOSING_KEYS = [
  { key: 'chlorine_kg',    name: 'Chlorine',     unit: 'kg' },
  { key: 'smbs_kg',        name: 'SMBS',         unit: 'kg' },
  { key: 'anti_scalant_l', name: 'Anti Scalant', unit: 'L'  },
  { key: 'soda_ash_kg',    name: 'Soda Ash',     unit: 'kg' },
];

export const REAGENT_DOSING_KEYS = [
  { key: 'free_chlorine_reagent_pcs', name: 'Free Cl Reagent', unit: 'pcs' },
];

/**
 * Complete list of daily dosing keys that contribute to daily chemical usage & cost.
 * Includes both process chemicals and test consumables (reagents).
 */
export const DOSING_KEYS = [
  ...PROCESS_DOSING_KEYS,
  ...REAGENT_DOSING_KEYS,
];

/**
 * Computes standard chemical cost for a dosing log row against effective prices.
 * Returns total cost and any dosed chemicals that lacked an effective price.
 */
export function computeDosingLogCost(
  row: Record<string, any>,
  prices: Record<string, number> | undefined,
): { cost: number; unpriced: string[] } {
  let cost = 0;
  const unpriced: string[] = [];

  for (const { key, name, unit } of DOSING_KEYS) {
    const qty = +row[key] || 0;
    if (qty > 0) {
      // Look up by plain name, full "Name (unit)", or alternative reagent aliases
      const price =
        prices?.[name] ??
        prices?.[`${name} (${unit})`] ??
        (name === 'Free Cl Reagent' ? (prices?.['Free Chlorine Reagent'] ?? prices?.['Free Chlorine Reagent (pcs)']) : undefined);

      if (price !== undefined && price !== null) {
        cost += qty * price;
      } else {
        unpriced.push(name);
      }
    }
  }

  return { cost: +cost.toFixed(2), unpriced };
}

