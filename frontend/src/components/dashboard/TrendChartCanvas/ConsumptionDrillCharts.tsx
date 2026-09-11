import React from 'react';
import { ResponsiveContainer,  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend  } from 'recharts';
import { makeDrillableBarShape } from '../TrendChartDrillKit';
import { INSTRUMENT_TOOLTIP_STYLE } from '@/lib/chartColors';
import { CHART_CURSOR, CHART_LEGEND_WRAPPER_STYLE } from './chartShell';

export function ConsumptionDrillDailyChart({
  focusedEntityRows, formatYAxis, handleLegendIsolate, visibleEntities,
}: {
  focusedEntityRows: any[];
  formatYAxis: (v: number) => string;
  handleLegendIsolate: (...args: any[]) => void;
  visibleEntities: { id: string; label: string; color: string }[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={focusedEntityRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
      <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
      <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={formatYAxis} width={44} axisLine={false} tickLine={false} />
      <Tooltip
        contentStyle={INSTRUMENT_TOOLTIP_STYLE}
        cursor={CHART_CURSOR}
        formatter={(v: any, name: string) => [v != null ? v.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—', name]}
      />
      <Legend
        wrapperStyle={CHART_LEGEND_WRAPPER_STYLE}
        onClick={handleLegendIsolate}
      />
      {visibleEntities.map(({ id, label, color }) => (
        <Line key={id} type="monotone" dataKey={id} name={label} stroke={color} strokeWidth={2} dot={false} />
      ))}
    </ComposedChart>
    </ResponsiveContainer>
  );
}

export function ConsumptionDrillBarChart({
  focusedEntityRows, formatYAxis, handleLegendIsolate, visibleEntities,
  stackMode, handleDrillBarActivate,
}: {
  focusedEntityRows: any[];
  formatYAxis: (v: number) => string;
  handleLegendIsolate: (...args: any[]) => void;
  visibleEntities: { id: string; label: string; color: string }[];
  stackMode: string;
  handleDrillBarActivate: (...args: any[]) => void;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={focusedEntityRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
      <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
      <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={formatYAxis} width={44} axisLine={false} tickLine={false} />
      <Tooltip
        contentStyle={INSTRUMENT_TOOLTIP_STYLE}
        cursor={CHART_CURSOR}
        formatter={(v: any, name: string) => [v != null ? v.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—', name]}
      />
      <Legend
        wrapperStyle={CHART_LEGEND_WRAPPER_STYLE}
        onClick={handleLegendIsolate}
      />
      {visibleEntities.map(({ id, label, color }) => (
        <Bar
          key={id}
          dataKey={id}
          name={label}
          fill={color}
          maxBarSize={28}
          radius={[3, 3, 0, 0]}
          stackId={stackMode === 'stacked' ? 'entities' : undefined}
          shape={makeDrillableBarShape(
            handleDrillBarActivate,
            (payload: any) => `Drill into ${payload.date as string ?? label}`,
          )}
        />
      ))}
    </ComposedChart>
    </ResponsiveContainer>
  );
}
