import React from 'react';
import { ResponsiveContainer,  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine  } from 'recharts';
import { C_PRODUCTION, C_CONSUMPTION, C_NRW } from '@/lib/chartColors';
import { makeDrillableBarShape } from '../TrendChartDrillKit';

const CHART_CURSOR = {
  stroke: 'hsl(var(--highlight))',
  strokeWidth: 1,
  strokeDasharray: '3 3',
};

export function NrwChart({
  focusedTrendRows, formatYAxis, handleDrillBarActivate, nrwLimitPct, stackMode,
  NegativeAwareTooltip,
}: {
  focusedTrendRows: any[];
  formatYAxis: (v: number) => string;
  handleDrillBarActivate: (...args: any[]) => void;
  nrwLimitPct: number;
  stackMode: string;
  NegativeAwareTooltip: React.ComponentType<any>;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={focusedTrendRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
      <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
      <YAxis yAxisId="vol" tick={{ fontSize: 10 }} stroke={C_PRODUCTION} tickFormatter={formatYAxis} width={44} axisLine={false} tickLine={false} />
      <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 10 }} stroke={C_NRW} width={32} tickFormatter={(v) => `${v}%`} axisLine={false} tickLine={false} />
      <Tooltip content={<NegativeAwareTooltip />} cursor={CHART_CURSOR} />
      <Bar
        yAxisId="vol" dataKey="production" fill={C_PRODUCTION} name="Production (m³)" radius={[3, 3, 0, 0]} maxBarSize={32}
        stackId={stackMode === 'stacked' ? 'nrw' : undefined}
        shape={makeDrillableBarShape(handleDrillBarActivate, (p) => `Drill into ${p.date as string}`)}
      />
      <Bar
        yAxisId="vol" dataKey="consumption" fill={C_CONSUMPTION} name="Consumption (m³)" radius={[3, 3, 0, 0]} maxBarSize={32}
        stackId={stackMode === 'stacked' ? 'nrw' : undefined}
        shape={makeDrillableBarShape(handleDrillBarActivate, (p) => `Drill into ${p.date as string}`)}
      />
      <ReferenceLine
        yAxisId="pct"
        y={nrwLimitPct}
        stroke="#ef4444"
        strokeDasharray="4 4"
        strokeWidth={1.5}
        label={{ value: `Limit: ${nrwLimitPct}%`, fill: '#ef4444', fontSize: 10, position: 'top' }}
      />
      <Line yAxisId="pct" type="monotone" dataKey="nrw" stroke={C_NRW} strokeWidth={2.5} dot={{ r: 3.5, fill: C_NRW, strokeWidth: 0 }} name="NRW %" />
    </ComposedChart>
    </ResponsiveContainer>
  );
}
