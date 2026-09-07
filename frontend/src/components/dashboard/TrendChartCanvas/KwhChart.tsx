import React from 'react';
import { ComposedChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

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
        <p style={{ margin: '1px 0', color: 'hsl(48,96%,40%)' }}>
          ☀ Solar: <strong>{fmt(solarVal)} kWh</strong>
        </p>
      )}
      {hasGridData && kwhSource !== 'solar' && gridVal > 0 && (
        <p style={{ margin: '1px 0', color: 'hsl(213,94%,55%)' }}>
          ⚡ Grid: <strong>{fmt(gridVal)} kWh</strong>
        </p>
      )}
      {total > 0 && (
        <div style={{ marginTop: 5, paddingTop: 5, borderTop: '1px solid hsl(var(--border))' }}>
          <p style={{ margin: '1px 0', color: 'hsl(var(--foreground))', fontWeight: 600 }}>
            Total: {fmt(total)} kWh
          </p>
          {pct && hasSolarData && kwhSource === 'both' && (
            <p style={{ margin: '2px 0 0', fontSize: 10, color: 'hsl(var(--muted-foreground))' }}>
              Solar: <span style={{ color: 'hsl(48,96%,40%)', fontWeight: 600 }}>{pct}%</span> of mix
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
    <ComposedChart
      data={kwhChartRows}
      margin={{ top: 8, right: 8, left: -8, bottom: 20 }}
      barSize={barSize}
    >
      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
      <XAxis
        dataKey="date"
        tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
        angle={-30}
        textAnchor="end"
        height={36}
        interval="preserveStartEnd"
        axisLine={false}
        tickLine={false}
      />
      <YAxis
        tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
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
        <Bar dataKey="solarKwh" name="☀ Solar (kWh)" fill="hsl(48,96%,53%)"
          stackId={stackMode === 'stacked' ? 'kwh' : undefined}
          radius={stackMode === 'stacked' ? [0, 0, 0, 0] : [3, 3, 0, 0]} />
      )}
      {hasGridData && kwhSource !== 'solar' && (
        <Bar dataKey="gridKwh"  name="⚡ Grid (kWh)"  fill="hsl(213,94%,68%)"
          stackId={stackMode === 'stacked' ? 'kwh' : undefined}
          radius={[3, 3, 0, 0]} />
      )}
    </ComposedChart>
  );
}
