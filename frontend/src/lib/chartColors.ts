import type React from 'react';

/**
 * Shared, named chart-series colors — kept in one place so the same
 * metric always renders in the same color everywhere it appears.
 *
 * TrendChart.tsx (Dashboard) and EntityHistoryChart.tsx (per-entity
 * history) used to each hardcode their own copy of these hex values.
 * Most agreed by coincidence, but nothing enforced that, so they
 * could silently drift apart the next time either file changed.
 * Both now import from here instead.
 *
 * Backed by the --metric-* / --filter-* custom properties in
 * index.css.
 */
export const C_PRODUCTION  = 'hsl(var(--metric-production))';   // water produced
export const C_CONSUMPTION = 'hsl(var(--metric-consumption))';  // water consumed
export const C_NRW         = 'hsl(var(--metric-nrw))';          // non-revenue water
export const C_RAWWATER    = 'hsl(var(--metric-rawwater))';     // raw (untreated) water
export const C_RECOVERY    = 'hsl(var(--metric-recovery))';     // RO recovery rate
export const C_TDS         = 'hsl(var(--metric-tds))';          // permeate TDS
export const C_GRID_PV     = 'hsl(var(--metric-gridpv))';       // grid power / PV ratio
export const C_SOLAR       = 'hsl(var(--kpi-solar))';           // solar power generation
export const C_GRID        = 'hsl(var(--kpi-grid))';            // utility grid power
export const C_BLEND_PCT   = 'hsl(var(--metric-blendpct))';     // % of a well's raw output diverted to blending

/** Same fill BlendingVolumeCard.tsx uses for its "Total" blending bar/gradient
 *  — reused here so a well's own blended-volume bar (EntityHistoryChart.tsx)
 *  reads as the same series wherever it shows up. */
export const C_BLEND_VOLUME = 'hsl(var(--blend-total))';

/** FilterCostChart.tsx / FilterUsageChart.tsx categorical bar colors. */
export const C_FILTER_CARTRIDGE = 'hsl(var(--filter-cartridge))';
export const C_FILTER_BAG       = 'hsl(var(--filter-bag))';

/**
 * Production Cost (Power + Chemical) theme-independent colors.
 * Kept fixed so lines never collapse into the same color under amber/autumn themes.
 */
export const C_TOTAL_COST = '#0ea5e9'; // Sky Blue 500 — Prod Cost (Power + Chem)
export const C_POWER_COST = '#f59e0b'; // Amber 500 — Power Cost
export const C_CHEM_COST  = '#a855f7'; // Purple 500 — Chemical Cost

/**
 * Standardized Instrument Panel tooltip style for Recharts
 * Replaces copy-pasted styles across dashboard and plant telemetry charts.
 */
export const INSTRUMENT_TOOLTIP_STYLE: React.CSSProperties = {
  background: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border) / 0.8)',
  borderRadius: 12,
  fontSize: 11,
  boxShadow: 'var(--shadow-card)',
  color: 'hsl(var(--foreground))',
  padding: '8px 12px',
};

