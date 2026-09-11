import React from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

export function CostAreaChart({
  data, dataKey, strokeColor, fillId, name, formatYAxis, NegativeAwareTooltip,
}: {
  data: any[];
  dataKey: string;
  strokeColor: string;
  fillId: string;
  name: string;
  formatYAxis: (v: number) => string;
  NegativeAwareTooltip: React.ComponentType<any>;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%"  stopColor={strokeColor} stopOpacity={0.28} />
          <stop offset="95%" stopColor={strokeColor} stopOpacity={0.03} />
        </linearGradient>
      </defs>
      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
      <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
      <YAxis tick={{ fontSize: 10 }} stroke={strokeColor} tickFormatter={formatYAxis} width={44} axisLine={false} tickLine={false} />
      <Tooltip content={<NegativeAwareTooltip />} />
      <Area
        type="monotone"
        dataKey={dataKey}
        stroke={strokeColor}
        strokeWidth={2.5}
        fill={`url(#${fillId})`}
        dot={false}
        name={name}
      />
    </AreaChart>
    </ResponsiveContainer>
  );
}
