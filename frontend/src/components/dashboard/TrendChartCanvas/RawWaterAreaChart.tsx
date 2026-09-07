import React from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { C_RAWWATER } from '@/lib/chartColors';

const INSTRUMENT_TOOLTIP_STYLE: React.CSSProperties = {
  background: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border) / 0.8)',
  borderRadius: 12,
  fontSize: 11,
  boxShadow: 'var(--shadow-card)',
  color: 'hsl(var(--foreground))',
  padding: '8px 12px',
};

export function RawWaterAreaChart({
  trendRows, formatYAxis, NegativeAwareTooltip,
}: {
  trendRows: any[];
  formatYAxis: (v: number) => string;
  NegativeAwareTooltip: React.ComponentType<any>;
}) {
  return (
    <AreaChart data={trendRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
      <defs>
        <linearGradient id="rawWaterFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%"  stopColor={C_RAWWATER} stopOpacity={0.28} />
          <stop offset="95%" stopColor={C_RAWWATER} stopOpacity={0.03} />
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
      <Area
        type="monotone"
        dataKey="rawwater"
        stroke={C_RAWWATER}
        strokeWidth={2.5}
        fill="url(#rawWaterFill)"
        dot={false}
        name="Raw Water (m³)"
      />
    </AreaChart>
  );
}
