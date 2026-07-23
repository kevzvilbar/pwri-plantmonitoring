/**
 * ro-trains/constants.ts
 *
 * Chemical dosing constants and CIP chemical configuration for the RO Train
 * operator log.  Extracted from ROTrains.tsx (§4 item 2 decomposition).
 */

// ─── Chemical Dosing ──────────────────────────────────────────────────────────
// HCl, SLS, and Caustic Soda are CIP-only chemicals — they are NOT listed here.
// They are always used during CIP and are entered exclusively in the CIP tab.
export const KNOWN_CHEMICALS = [
  { name: 'Chlorine',     defaultUnit: 'kg' },
  { name: 'SMBS',         defaultUnit: 'kg' },
  { name: 'Anti Scalant', defaultUnit: 'L'  },
  { name: 'Soda Ash',     defaultUnit: 'kg' },
];

export const CHEM_UNITS = ['kg', 'g', 'L', 'mL', 'pcs', 'gal', '__custom__'];

export const DOSING_KEYS = [
  { key: 'chlorine_kg',    name: 'Chlorine',     unit: 'kg' },
  { key: 'smbs_kg',        name: 'SMBS',         unit: 'kg' },
  { key: 'anti_scalant_l', name: 'Anti Scalant', unit: 'L'  },
  { key: 'soda_ash_kg',    name: 'Soda Ash',     unit: 'kg' },
];

// ─── CIP Chemical constants ────────────────────────────────────────────────────
// These are the default 3 CIP chemicals; plant config (cip_chemicals) can override.
// "Built-in" chemicals map to dedicated DB columns; custom ones are serialised
// into the remarks field as __cip_extra:{...} so no migration is needed.

export const DEFAULT_CIP_CHEMICALS: Array<{ name: string; unit: string }> = [
  { name: 'Caustic Soda', unit: 'kg' },
  { name: 'HCl',          unit: 'L'  },
  { name: 'SLS',          unit: 'g'  },
];

/** Maps CIP chemical name → cip_logs DB column (built-ins only). */
export const CIP_BUILTIN_DB_MAP: Record<string, string> = {
  'Caustic Soda': 'caustic_soda_kg',
  'HCl':          'hcl_l',
  'SLS':          'sls_g',
};

/** Accent colours for each CIP chemical card (built-ins first, then fallback palette). */
export const CIP_CHEM_ACCENTS: Record<string, {
  border: string; bg: string; bar: string; badge: string;
}> = {
  'Caustic Soda': {
    border: 'border-teal-400 bg-teal-50/40 dark:bg-teal-950/30',
    bg:     'border-border bg-muted/20',
    bar:    'bg-teal-500',
    badge:  'bg-teal-100 dark:bg-teal-900 text-teal-700 dark:text-teal-300',
  },
  'HCl': {
    border: 'border-amber-400 bg-amber-50/40 dark:bg-amber-950/30',
    bg:     'border-border bg-muted/20',
    bar:    'bg-amber-400',
    badge:  'bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300',
  },
  'SLS': {
    border: 'border-yellow-400 bg-yellow-50/40 dark:bg-yellow-950/30',
    bg:     'border-border bg-muted/20',
    bar:    'bg-yellow-400',
    badge:  'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300',
  },
};

/** Fallback accent for custom / user-defined CIP chemicals. */
export const CIP_CUSTOM_ACCENT = {
  border: 'border-purple-400 bg-purple-50/40 dark:bg-purple-950/30',
  bg:     'border-border bg-muted/20',
  bar:    'bg-purple-400',
  badge:  'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300',
};
