import React from 'react';
import { ResponsiveContainer, ComposedChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { C_SOLAR, C_GRID } from '@/lib/chartColors';
import { Sun, Zap } from 'lucide-react';
import { CHART_CURSOR } from './chartShell';

function KwhTooltip({ active, payload, label, hasSolarData, hasGridData, kwhSource }: any) {
  if (!active || !payload?.length) return null;
  const solarVal = payload.find((p: any) => p.dataKey === 'solarKwh')?.value ?? 0;
  const gridVal  = payload.find((p: any) => p.dataKey === 'gridKwh')?.value  ?? 0;
  const total    = solarVal + gridVal;
  const pct      = total > 0 ? ((solarVal / total) * 100).toFixed(1) : null;
  const fmt      = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 1 });

  return (
    <div style={{
      background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))',
      borderRadius: 8, fontSize: 11, padding: '8px 10px',
      minWidth: 160, boxShadow: 'var(--shadow-elev)', opacity: 0.92, backdropFilter: 'blur(4px)',
    }}>
      <p style={{ margin: '0 0 5px', fontWeight: 600, color: 'hsl(var(--foreground))' }}>{label}</p>
      {hasSolarData && kwhSource !== 'grid' && solarVal > 0 && (
        <p style={{ margin: '1px 0', color: C_SOLAR }} className="flex items-center gap-1.5">
          <Sun className="h-3 w-3 inline text-kpi-solar shrink-0" />
          <span>Solar: <strong>{fmt(solarVal)} kWh</strong></span>
        </p>
      )}
      {hasGridData && kwhSource !== 'solar' && gridVal > 0 && (
        <p style={{ margin: '1px 0', color: C_GRID }} className="flex items-center gap-1.5">
          <Zap className="h-3 w-3 inline text-kpi-grid shrink-0" />
          <span>Grid: <strong>{fmt(gridVal)} kWh</strong></span>
        </p>
      )}
      {total > 0 && (
        <div style={{ marginTop: 5, paddingTop: 5, borderTop: '1px solid hsl(var(--border))' }}>
          <p style={{ margin: '1px 0', color: 'hsl(var(--foreground))', fontWeight: 600 }}>
            Total: {fmt(total)} kWh
          </p>
          {pct && hasSolarData && kwhSource === 'both' && (
            <p style={{ margin: '2px 0 0', fontSize: 10, color: 'hsl(var(--muted-foreground))' }}>
              Solar: <span style={{ color: C_SOLAR, fontWeight: 600 }}>{pct}%</span> of mix
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function KwhChart({
  kwhChartRows, formatYAxis, hasSolarData, hasGridData, kwhSource, stackMode,
}: {
  kwhChartRows: any[];
  formatYAxis: (v: number) => string;
  hasSolarData: boolean;
  hasGridData: boolean;
  kwhSource: string;
  stackMode: string;
}) {
  const barSize = Math.max(3, Math.min(18, 400 / Math.max(kwhChartRows.length, 1)));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
      data={kwhChartRows}
      margin={{ top: 8, right: 8, left: -8, bottom: 20 }}
      barSize={barSize}
    >
      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.25} />
      <XAxis
        dataKey="date"
        tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))', fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)' }}
        angle={-30}
        textAnchor="end"
        height={36}
        interval="preserveStartEnd"
        axisLine={false}
        tickLine={false}
      />
      <YAxis
        tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))', fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)' }}
        tickFormatter={formatYAxis}
        width={44}
        axisLine={false}
        tickLine={false}
      />
      <Tooltip
        content={<KwhTooltip hasSolarData={hasSolarData} hasGridData={hasGridData} kwhSource={kwhSource} />}
        cursor={CHART_CURSOR}
      />
      {hasSolarData && kwhSource !== 'grid' && (
        <Bar dataKey="solarKwh" name="Solar (kWh)" fill={C_SOLAR}
          stackId={stackMode === 'stacked' ? 'kwh' : undefined}
          radius={stackMode === 'stacked' ? [0, 0, 0, 0] : [3, 3, 0, 0]} />
      )}
      {hasGridData && kwhSource !== 'solar' && (
        <Bar dataKey="gridKwh" name="Grid (kWh)" fill={C_GRID}
          stackId={stackMode === 'stacked' ? 'kwh' : undefined}
          radius={[3, 3, 0, 0]} />
      )}
    </ComposedChart>
    </ResponsiveContainer>
  );
}
