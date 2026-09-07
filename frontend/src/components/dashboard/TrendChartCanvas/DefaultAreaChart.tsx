import React from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts';
import { C_PRODUCTION, C_CONSUMPTION, C_RECOVERY, C_TDS } from '@/lib/chartColors';

const INSTRUMENT_TOOLTIP_STYLE: React.CSSProperties = {
  background: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border) / 0.8)',
  borderRadius: 12,
  fontSize: 11,
  boxShadow: 'var(--shadow-card)',
  color: 'hsl(var(--foreground))',
  padding: '8px 12px',
};

export function DefaultAreaChart({
  trendRows, metric, roDrillMode, formatYAxis, recoveryMinPct, permTdsMax, NegativeAwareTooltip,
}: {
  trendRows: any[];
  metric: string;
  roDrillMode: string;
  formatYAxis: (v: number) => string;
  recoveryMinPct: number;
  permTdsMax: number;
  NegativeAwareTooltip: React.ComponentType<any>;
}) {
  const showProduction = metric === 'production';
  const showRecovery = metric === 'recovery' && roDrillMode === 'default';
  const showTds = metric === 'tds' && roDrillMode === 'default';

  return (
    <AreaChart data={trendRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
      <defs>
        <linearGradient id="productionFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%"  stopColor={C_PRODUCTION} stopOpacity={0.25} />
          <stop offset="95%" stopColor={C_PRODUCTION} stopOpacity={0.03} />
        </linearGradient>
        <linearGradient id="consumptionFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%"  stopColor={C_CONSUMPTION} stopOpacity={0.25} />
          <stop offset="95%" stopColor={C_CONSUMPTION} stopOpacity={0.03} />
        </linearGradient>
        <linearGradient id="recoveryFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%"  stopColor={C_RECOVERY} stopOpacity={0.28} />
          <stop offset="95%" stopColor={C_RECOVERY} stopOpacity={0.03} />
        </linearGradient>
      </defs>
      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
      <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
      <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={formatYAxis} width={44} axisLine={false} tickLine={false} />
      <Tooltip content={<NegativeAwareTooltip />} />
      {showProduction && (<>
        <Area type="monotone" dataKey="consumption" stroke={C_CONSUMPTION} strokeWidth={2.5} fill="url(#consumptionFill)" dot={false} name="Consumption (m³)" />
        <Area type="monotone" dataKey="production" stroke={C_PRODUCTION} strokeWidth={2.5} fill="url(#productionFill)" dot={false} name="Production (m³)" />
      </>)}
      {showRecovery && (
        <>
          <ReferenceLine
            y={recoveryMinPct}
            stroke="#10b981"
            strokeDasharray="3 3"
            strokeWidth={1.5}
            label={{ value: `Min Target: ${recoveryMinPct}%`, fill: '#10b981', fontSize: 9, position: 'insideBottomLeft' }}
          />
          <Area type="monotone" dataKey="recovery" stroke={C_RECOVERY} strokeWidth={2.5} fill="url(#recoveryFill)" dot={false} name="Recovery (%)" />
        </>
      )}
      {showTds && (
        <>
          <ReferenceLine
            y={permTdsMax}
            stroke="#f59e0b"
            strokeDasharray="4 4"
            strokeWidth={1.5}
            label={{ value: `Limit: ${permTdsMax} ppm`, fill: '#f59e0b', fontSize: 10, position: 'top' }}
          />
          <Area type="monotone" dataKey="tds" stroke={C_TDS} strokeWidth={2.5} fill="url(#tdsFill)" dot={false} name="Permeate TDS (ppm)" />
        </>
      )}
    </AreaChart>
  );
}
