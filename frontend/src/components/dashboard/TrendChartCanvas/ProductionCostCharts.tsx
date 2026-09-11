import React from 'react';
import { ResponsiveContainer, BarChart, LineChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { INSTRUMENT_TOOLTIP_STYLE } from '@/lib/chartColors';
import { CHART_CURSOR } from './chartShell';

export function ProductionCostStackedChart({
  trendRows, formatYAxis, showPowerCostLine, showChemCostLine,
}: {
  trendRows: any[];
  formatYAxis: (v: number) => string;
  showPowerCostLine: boolean;
  showChemCostLine: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={trendRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
      <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
      <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--accent))" tickFormatter={(v) => `₱${formatYAxis(v)}`} width={44} axisLine={false} tickLine={false} />
      <Tooltip
        contentStyle={INSTRUMENT_TOOLTIP_STYLE}
        cursor={CHART_CURSOR}
        formatter={(v: any, name: string) => [v != null ? `₱${(+v).toFixed(4)}/m³` : '—', name]}
      />
      {showPowerCostLine && (
        <Bar dataKey="powerCost" name="Power (₱/m³)" fill="hsl(var(--chart-6))" stackId="cost" radius={[0, 0, 0, 0]} maxBarSize={32} />
      )}
      {showChemCostLine && (
        <Bar dataKey="chemCost" name="Chem (₱/m³)" fill="hsl(var(--highlight))" stackId="cost" radius={[3, 3, 0, 0]} maxBarSize={32} />
      )}
    </BarChart>
    </ResponsiveContainer>
  );
}

export function ProductionCostLineChart({
  trendRows, formatYAxis, showTotalCostLine, showPowerCostLine, showChemCostLine,
}: {
  trendRows: any[];
  formatYAxis: (v: number) => string;
  showTotalCostLine: boolean;
  showPowerCostLine: boolean;
  showChemCostLine: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={trendRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
      <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
      <YAxis
        tick={{ fontSize: 10 }}
        stroke="hsl(var(--accent))"
        tickFormatter={(v) => `₱${formatYAxis(v)}`}
        width={44}
        axisLine={false}
        tickLine={false}
      />
      <Tooltip
        contentStyle={INSTRUMENT_TOOLTIP_STYLE}
        cursor={CHART_CURSOR}
        formatter={(v: any, name: string) => [
          v != null ? `₱${(+v).toFixed(4)}/m³` : '—',
          name,
        ]}
      />
      {showTotalCostLine && (
        <Line type="monotone" dataKey="totalCost" stroke="hsl(var(--accent))" strokeWidth={2.5} dot={{ r: 2 }} name="Prod Cost (₱/m³)" />
      )}
      {showPowerCostLine && (
        <Line type="monotone" dataKey="powerCost" stroke="hsl(var(--chart-6))" strokeWidth={2} dot={false} name="Power (₱/m³)" />
      )}
      {showChemCostLine && (
        <Line type="monotone" dataKey="chemCost" stroke="hsl(var(--highlight))" strokeWidth={2} dot={false} name="Chem (₱/m³)" />
      )}
    </LineChart>
    </ResponsiveContainer>
  );
}
