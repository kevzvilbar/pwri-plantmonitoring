import React from 'react';
import { ResponsiveContainer, 
  ComposedChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, LineChart, Line,
 } from 'recharts';
import { C_PRODUCTION, C_CONSUMPTION, C_NRW, INSTRUMENT_TOOLTIP_STYLE } from '@/lib/chartColors';
import { makeDrillableBarShape } from '../TrendChartDrillKit';

const CHART_CURSOR = {
  stroke: 'hsl(var(--highlight))',
  strokeWidth: 1,
  strokeDasharray: '3 3',
};

export function RoDrillByTrainChart({
  roTrainDrillData, roUnit, handleTrainLegendIsolate, visibleTrainEntities,
}: {
  roTrainDrillData: any[];
  roUnit: string;
  handleTrainLegendIsolate: (...args: any[]) => void;
  visibleTrainEntities: { id: string; label: string; color: string }[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={roTrainDrillData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
      <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
      <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={44} axisLine={false} tickLine={false} />
      <Tooltip
        contentStyle={INSTRUMENT_TOOLTIP_STYLE}
        cursor={CHART_CURSOR}
        formatter={(v: any, name: string) => [v != null ? `${v} ${roUnit}` : '—', name]}
      />
      <Legend
        wrapperStyle={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.03em', paddingTop: 6, cursor: 'pointer' }}
        onClick={handleTrainLegendIsolate}
      />
      {visibleTrainEntities.map(({ id, label, color }) => (
        <Line key={id} type="monotone" dataKey={id} name={label} stroke={color} strokeWidth={2} dot={false} />
      ))}
    </LineChart>
    </ResponsiveContainer>
  );
}

export function RoDrillByTrainBarChart({
  roTrainDrillData, roUnit, handleTrainLegendIsolate, visibleTrainEntities,
  stackMode, drillFocusRange, handleDrillBarActivate,
}: {
  roTrainDrillData: any[];
  roUnit: string;
  handleTrainLegendIsolate: (...args: any[]) => void;
  visibleTrainEntities: { id: string; label: string; color: string }[];
  stackMode: string;
  drillFocusRange: { startKey: string; endKey: string } | null;
  handleDrillBarActivate: (...args: any[]) => void;
}) {
  const data = drillFocusRange
    ? roTrainDrillData.filter((r: any) => r.isoDate >= drillFocusRange.startKey && r.isoDate <= drillFocusRange.endKey)
    : roTrainDrillData;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
      <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 500 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
      <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={44} axisLine={false} tickLine={false} />
      <Tooltip
        contentStyle={INSTRUMENT_TOOLTIP_STYLE}
        cursor={CHART_CURSOR}
        formatter={(v: any, name: string) => [v != null ? `${v} ${roUnit}` : '—', name]}
      />
      <Legend
        wrapperStyle={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.03em', paddingTop: 6, cursor: 'pointer' }}
        onClick={handleTrainLegendIsolate}
      />
      {visibleTrainEntities.map(({ id, label, color }) => (
        <Bar
          key={id}
          dataKey={id}
          name={label}
          fill={color}
          maxBarSize={28}
          radius={[3, 3, 0, 0]}
          stackId={stackMode === 'stacked' ? 'trains' : undefined}
          shape={makeDrillableBarShape(
            handleDrillBarActivate,
            (p) => `Drill into ${p.date as string}`,
          )}
        />
      ))}
    </ComposedChart>
    </ResponsiveContainer>
  );
}
