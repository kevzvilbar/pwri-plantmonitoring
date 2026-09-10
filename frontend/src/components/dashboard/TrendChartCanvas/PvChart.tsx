import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts';
import { C_PRODUCTION, C_GRID_PV } from '@/lib/chartColors';

export function PvChart({
  trendRows, pvLimitMax, PvTooltip,
}: {
  trendRows: any[];
  pvLimitMax: number;
  PvTooltip: React.ComponentType<any>;
}) {
  const yDomain = [
    0,
    (dataMax: number) => {
      if (dataMax <= 0) return 2;
      if (dataMax < 1)  return Math.ceil(dataMax * 10) / 10 + 0.1;
      if (dataMax < 4)  return Math.ceil(dataMax * 4)  / 4;
      return Math.ceil(dataMax);
    },
  ];

  const tickFormatter = (v: number) => +v.toFixed(2) === 0 ? '0' : v.toFixed(v < 1 ? 2 : 1);

  return (
    <LineChart data={trendRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
      <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
      <YAxis
        tick={{ fontSize: 10 }}
        stroke={C_GRID_PV}
        width={44}
        axisLine={false}
        tickLine={false}
        domain={yDomain as any}
        tickCount={6}
        tickFormatter={tickFormatter}
      />
      <Tooltip content={<PvTooltip />} />
      <ReferenceLine
        y={pvLimitMax}
        stroke="#f59e0b"
        strokeDasharray="4 4"
        strokeWidth={1.5}
        label={{ value: `Target: ≤ ${pvLimitMax}`, fill: '#f59e0b', fontSize: 10, position: 'top' }}
      />
      <Line
        type="monotone"
        dataKey={(d: any) => d.production > 0 ? +(d.kwh / d.production).toFixed(2) : null}
        stroke={C_GRID_PV}
        strokeWidth={2.5}
        dot={false}
        name="Grid PV (kWh/m³)"
      />
      <Line
        type="monotone"
        dataKey={(d: any) => d.production > 0 && (d.kwh + d.solarKwh) > 0
          ? +((d.kwh + d.solarKwh) / d.production).toFixed(2)
          : null}
        stroke={C_PRODUCTION}
        strokeWidth={2}
        strokeDasharray="4 3"
        dot={false}
        name="(Grid+Solar) PV (kWh/m³)"
      />
    </LineChart>
  );
}
