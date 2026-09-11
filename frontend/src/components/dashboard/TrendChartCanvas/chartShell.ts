import type React from 'react';

/** Standard animated crosshair cursor style across all trend charts */
export const CHART_CURSOR = {
  stroke: 'hsl(var(--highlight))',
  strokeWidth: 1,
  strokeDasharray: '3 3',
};

/** Shared subtle horizontal gridline styling */
export const CHART_GRID_DEFAULTS = {
  strokeDasharray: '3 3',
  stroke: 'hsl(var(--border))',
  vertical: false,
  strokeOpacity: 0.6,
};

/** Shared X-axis typography and boundary lines */
export const CHART_XAXIS_DEFAULTS = {
  tick: { fontSize: 10, fontWeight: 500 },
  stroke: 'hsl(var(--muted-foreground))',
  axisLine: false,
  tickLine: false,
};

/** Shared Y-axis typography, gutters, and boundary lines */
export const CHART_YAXIS_DEFAULTS = {
  tick: { fontSize: 10 },
  stroke: 'hsl(var(--muted-foreground))',
  width: 44,
  axisLine: false,
  tickLine: false,
};

/** Interactive clickable legend wrapper style for series isolation */
export const CHART_LEGEND_WRAPPER_STYLE: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.03em',
  paddingTop: 6,
  cursor: 'pointer',
};
