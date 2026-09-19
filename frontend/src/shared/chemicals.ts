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
