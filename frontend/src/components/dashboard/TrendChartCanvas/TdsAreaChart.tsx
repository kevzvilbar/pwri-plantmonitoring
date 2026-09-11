import React from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts';
import { C_TDS } from '@/lib/chartColors';

export function TdsAreaChart({
  trendRows, formatYAxis, permTdsMax, NegativeAwareTooltip,
}: {
  trendRows: any[];
  formatYAxis: (v: number) => string;
  permTdsMax: number;
  NegativeAwareTooltip: React.ComponentType<any>;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={trendRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
      <defs>
        <linearGradient id="tdsFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%"  stopColor={C_TDS} stopOpacity={0.28} />
          <stop offset="95%" stopColor={C_TDS} stopOpacity={0.03} />
        </linearGradient>
      </defs>
      <CartesianGrid
        strokeDasharray="3 3"
        stroke="hsl(var(--border))"
        vertical={false}
        strokeOpacity={0.6}
      />
      <XAxis
        dataKey="date"
        tick={{ fontSize: 10, fontWeight: 500 }}
        stroke="hsl(var(--muted-foreground))"
        axisLine={false}
        tickLine={false}
      />
      <YAxis
        tick={{ fontSize: 10 }}
        stroke="hsl(var(--muted-foreground))"
        tickFormatter={formatYAxis}
        width={44}
        axisLine={false}
        tickLine={false}
      />
      <Tooltip content={<NegativeAwareTooltip />} />
      <ReferenceLine
        y={permTdsMax}
        stroke="#f59e0b"
        strokeDasharray="4 4"
        strokeWidth={1.5}
        label={{ value: `Limit: ${permTdsMax} ppm`, fill: '#f59e0b', fontSize: 10, position: 'top' }}
      />
      <Area
        type="monotone"
        dataKey="tds"
        stroke={C_TDS}
        strokeWidth={2.5}
        fill="url(#tdsFill)"
        dot={false}
        name="Permeate TDS (ppm)"
      />
    </AreaChart>
    </ResponsiveContainer>
  );
}
