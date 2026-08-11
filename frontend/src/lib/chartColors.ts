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
export const C_BLEND_PCT   = 'hsl(var(--metric-blendpct))';     // % of a well's raw output diverted to blending

/** Same fill BlendingVolumeCard.tsx uses for its "Total" blending bar/gradient
 *  — reused here so a well's own blended-volume bar (EntityHistoryChart.tsx)
 *  reads as the same series wherever it shows up. */
export const C_BLEND_VOLUME = 'hsl(var(--blend-total))';

/** FilterCostChart.tsx / FilterUsageChart.tsx categorical bar colors. */
export const C_FILTER_CARTRIDGE = 'hsl(var(--filter-cartridge))';
export const C_FILTER_BAG       = 'hsl(var(--filter-bag))';
