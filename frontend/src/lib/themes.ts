/**
 * PWRI Plant Monitoring — Color Theme Definitions
 * ─────────────────────────────────────────────────
 * Each theme is derived from a curated color palette and maps onto the
 * CSS custom-property design system in index.css.
 *
 * Themes are applied by setting  data-theme="<id>"  on <html>.
 * CSS variable overrides live in index.css under [data-theme="<id>"].
 */

export interface ColorTheme {
  id: string;
  name: string;
  description: string;
  /** Preview swatches: [sidebar, primary, accent, background] */
  swatches: [string, string, string, string];
}

export const COLOR_THEMES: ColorTheme[] = [
  {
    id: 'default',
    name: 'Ocean Teal',
    description: 'Classic navy & teal — the original PWRI look.',
    swatches: ['#0b1e2e', '#0d9488', '#06b6d4', '#f1f5f9'],
  },
  {
    id: 'aerial-autumn',
    name: 'Aerial Autumn',
    description: 'Rusty warmth meets deep teal — inspired by an aerial river vista.',
    swatches: ['#07202E', '#008B7B', '#D59D3A', '#f7f3ec'],
  },
  {
    id: 'fire-ocean',
    name: 'Fire & Ocean',
    description: 'Deep navy darkness with vivid orange flame and steel blue depth.',
    swatches: ['#010313', '#326DA3', '#EF7D02', '#f0f4f8'],
  },
  {
    id: 'earth-jade',
    name: 'Earth & Jade',
    description: 'Ancient forest greens and golden amber — grounded, natural authority.',
    swatches: ['#020B0C', '#0D382C', '#DA9626', '#f4f6f2'],
  },
  {
    id: 'inferno-sky',
    name: 'Inferno Sky',
    description: 'Scorched earth rising to fiery amber — dramatic and high-contrast.',
    swatches: ['#120E0E', '#4571A4', '#FE960D', '#f5f2ef'],
  },
  {
    id: 'midnight-road',
    name: 'Midnight Road',
    description: 'Starless black with electric cyan and distant rust horizons.',
    swatches: ['#030816', '#0A97BE', '#0BC9F8', '#f0f6f8'],
  },
  {
    id: 'cosmic-spark',
    name: 'Cosmic Spark',
    description: 'Vivid purple & cobalt with golden energy — electric and bold.',
    swatches: ['#0A3383', '#047CDF', '#9344F4', '#f2f4fb'],
  },
];

export const DEFAULT_THEME_ID = 'default';
