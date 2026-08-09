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

/**
 * Accent colours for each CIP chemical card (built-ins first, then fallback
 * palette). Backed by the --chem-* tokens in index.css — see that file for
 * why these are their own identity-color set rather than reusing warn/danger.
 * (The `bg` field this used to carry was dead: every entry set it to the
 * same literal string and no call site ever read it — removed rather than
 * carried forward.)
 */
export const CIP_CHEM_ACCENTS: Record<string, {
  border: string; bar: string; badge: string;
}> = {
  'Caustic Soda': {
    border: 'border-chem-caustic bg-chem-caustic/10',
    bar:    'bg-chem-caustic',
    badge:  'bg-chem-caustic/15 text-chem-caustic',
  },
  'HCl': {
    border: 'border-chem-hcl bg-chem-hcl/10',
    bar:    'bg-chem-hcl',
    badge:  'bg-chem-hcl/15 text-chem-hcl',
  },
  'SLS': {
    border: 'border-chem-sls bg-chem-sls/10',
    bar:    'bg-chem-sls',
    badge:  'bg-chem-sls/15 text-chem-sls',
  },
};

/** Fallback accent for custom / user-defined CIP chemicals. */
export const CIP_CUSTOM_ACCENT = {
  border: 'border-chem-custom bg-chem-custom/10',
  bar:    'bg-chem-custom',
  badge:  'bg-chem-custom/15 text-chem-custom',
};
