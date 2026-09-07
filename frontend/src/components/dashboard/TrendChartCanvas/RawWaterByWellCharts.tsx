import React from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { makeDrillableBarShape } from '../TrendChartDrillKit';

const INSTRUMENT_TOOLTIP_STYLE: React.CSSProperties = {
  background: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border) / 0.8)',
  borderRadius: 12,
  fontSize: 11,
  boxShadow: 'var(--shadow-card)',
  color: 'hsl(var(--foreground))',
  padding: '8px 12px',
};

const CHART_CURSOR = {
  stroke: 'hsl(var(--highlight))',
  strokeWidth: 1,
  strokeDasharray: '3 3',
};

export function RawWaterByWellDailyChart({
  wellEntityRows, formatYAxis, handleWellLegendIsolate, visibleWellEntities,
}: {
  wellEntityRows: any[];
  formatYAxis: (v: number) => string;
  handleWellLegendIsolate: (...args: any[]) => void;
  visibleWellEntities: { id: string; label: string; color: string }[];
}) {
  return (
    <ComposedChart data={wellEntityRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
      <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
      <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={formatYAxis} width={44} axisLine={false} tickLine={false} />
      <Tooltip
        contentStyle={INSTRUMENT_TOOLTIP_STYLE}
        cursor={CHART_CURSOR}
        formatter={(v: any, name: string) => [v != null ? v.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—', name]}
      />
      <Legend
        wrapperStyle={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.03em', paddingTop: 6, cursor: 'pointer' }}
        onClick={handleWellLegendIsolate}
      />
      {visibleWellEntities.map(({ id, label, color }) => (
        <Line key={id} type="monotone" dataKey={id} name={label} stroke={color} strokeWidth={2} dot={false} />
      ))}
    </ComposedChart>
  );
}

export function RawWaterByWellBarChart({
  wellEntityRows, formatYAxis, handleWellLegendIsolate, visibleWellEntities,
  stackMode, drillFocusRange, handleDrillBarActivate,
}: {
  wellEntityRows: any[];
  formatYAxis: (v: number) => string;
  handleWellLegendIsolate: (...args: any[]) => void;
  visibleWellEntities: { id: string; label: string; color: string }[];
  stackMode: string;
  drillFocusRange: { startKey: string; endKey: string } | null;
  handleDrillBarActivate: (...args: any[]) => void;
}) {
  const data = drillFocusRange
    ? wellEntityRows.filter((r: any) => r.isoDate >= drillFocusRange.startKey && r.isoDate <= drillFocusRange.endKey)
    : wellEntityRows;

  return (
    <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
      <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
      <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={formatYAxis} width={44} axisLine={false} tickLine={false} />
      <Tooltip
        contentStyle={INSTRUMENT_TOOLTIP_STYLE}
        cursor={CHART_CURSOR}
        formatter={(v: any, name: string) => [v != null ? v.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—', name]}
      />
      <Legend
        wrapperStyle={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.03em', paddingTop: 6, cursor: 'pointer' }}
        onClick={handleWellLegendIsolate}
      />
      {visibleWellEntities.map(({ id, label, color }) => (
        <Bar
          key={id}
          dataKey={id}
          name={label}
          fill={color}
          maxBarSize={28}
          radius={[3, 3, 0, 0]}
          stackId={stackMode === 'stacked' ? 'wells' : undefined}
          shape={makeDrillableBarShape(handleDrillBarActivate, (p) => `Drill into ${p.date as string}`)}
        />
      ))}
    </ComposedChart>
  );
}
