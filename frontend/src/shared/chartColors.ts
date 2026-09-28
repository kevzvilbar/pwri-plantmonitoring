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

/** ReconciliationHealthCard's per-plant permeate-vs-product-meter bars. Off
 *  the green/amber/red family on purpose — that trio is already the card's
 *  balanced/marginal/alert status vocabulary. */
export const C_PERMEATE      = 'hsl(var(--metric-permeate))';      // RO train permeate reading
export const C_PRODUCT_METER = 'hsl(var(--metric-productmeter))';  // dedicated bulk product meter reading

/** Same fill BlendingVolumeCard.tsx uses for its "Total" blending bar/gradient
 *  — reused here so a well's own blended-volume bar (EntityHistoryChart.tsx)
 *  reads as the same series wherever it shows up. */
export const C_BLEND_VOLUME = 'hsl(var(--blend-total))';

/** FilterCostChart.tsx / FilterUsageChart.tsx categorical bar colors. */
export const C_FILTER_CARTRIDGE = 'hsl(var(--filter-cartridge))';
export const C_FILTER_BAG       = 'hsl(var(--filter-bag))';

/**
 * Production Cost (Power + Chemical) theme-harmonized colors with safety fallbacks.
 */
export const C_TOTAL_COST = 'hsl(var(--chart-1, 199 98% 48%))'; // Sky — Prod Cost
export const C_POWER_COST = 'hsl(var(--warn, 38 92% 50%))';      // Amber — Power Cost
export const C_CHEM_COST  = 'hsl(var(--chart-4, 258 90% 66%))';  // Violet — Chemical Cost

/**
 * Standardized Instrument Panel tooltip style for Recharts
 * Replaces copy-pasted styles across dashboard and plant telemetry charts.
 * Enhanced with Stitch glassmorphism and high micro-contrast.
 */
export const INSTRUMENT_TOOLTIP_STYLE: React.CSSProperties = {
  background: 'hsl(var(--card) / 0.94)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  border: '1px solid hsl(var(--border) / 0.8)',
  boxShadow: '0 8px 32px -4px hsl(var(--foreground) / 0.12), inset 0 1px 0 0 hsl(0 0% 100% / 0.15)',
  borderRadius: 10,
  fontSize: 11,
  fontWeight: 500,
  color: 'hsl(var(--foreground))',
  padding: '8px 12px',
};

