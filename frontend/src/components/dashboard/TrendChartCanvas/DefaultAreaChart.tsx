import React from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts';
import { C_PRODUCTION, C_CONSUMPTION, C_RECOVERY } from '@/lib/chartColors';

export function DefaultAreaChart({
  trendRows, metric, roDrillMode, formatYAxis, recoveryMinPct, permTdsMax: _permTdsMax, NegativeAwareTooltip,
}: {
  trendRows: any[];
  metric: string;
  roDrillMode: string;
  formatYAxis: (v: number) => string;
  recoveryMinPct: number;
  permTdsMax?: number;
  NegativeAwareTooltip: React.ComponentType<any>;
}) {
  const showProduction = metric === 'production';
  const showRecovery = metric === 'recovery' && roDrillMode === 'default';

  return (
    <ResponsiveContainer width="100%" height="100%">
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
    </AreaChart>
    </ResponsiveContainer>
  );
}

