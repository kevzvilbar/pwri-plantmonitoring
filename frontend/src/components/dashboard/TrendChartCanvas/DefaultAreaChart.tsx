import React, { useMemo } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts';
import { C_PRODUCTION, C_CONSUMPTION, C_RECOVERY } from '@/lib/chartColors';

export function DefaultAreaChart({
  trendRows, metric, roDrillMode, formatYAxis, recoveryMinPct, permTdsMax: _permTdsMax, NegativeAwareTooltip,
}: {
  trendRows: any[];
  metric: string;
  roDrillMode: string;
  formatYAxis: (v: number) => string;
  recoveryMinPct: number;
  permTdsMax?: number;
  NegativeAwareTooltip: React.ComponentType<any>;
}) {
  const showProduction = metric === 'production';
  const showRecovery = metric === 'recovery' && roDrillMode === 'default';

  // Compute latest non-null reading for the in-chart telemetry legend
  const latestRow = useMemo(() => {
    if (!trendRows || trendRows.length === 0) return null;
    for (let i = trendRows.length - 1; i >= 0; i--) {
      const r = trendRows[i];
      if (r && (r.production != null || r.consumption != null || r.recovery != null)) {
        return r;
      }
    }
    return trendRows[trendRows.length - 1];
  }, [trendRows]);

  return (
    <div className="w-full h-full flex flex-col">
      {/* ── In-chart Telemetry Legend Row ── */}
      {showProduction && latestRow && (
        <div className="flex items-center justify-end gap-3 px-2 py-0.5 text-2xs font-mono">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: C_PRODUCTION }} />
            <span className="text-muted-foreground">Production:</span>
            <span className="font-bold text-foreground tabular-nums">
              {latestRow.production != null ? `${Number(latestRow.production).toLocaleString(undefined, { maximumFractionDigits: 1 })} m³` : '—'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: C_CONSUMPTION }} />
            <span className="text-muted-foreground">Consumption:</span>
            <span className="font-bold text-foreground tabular-nums">
              {latestRow.consumption != null ? `${Number(latestRow.consumption).toLocaleString(undefined, { maximumFractionDigits: 1 })} m³` : '—'}
            </span>
          </div>
        </div>
      )}

      {showRecovery && latestRow && (
        <div className="flex items-center justify-end gap-3 px-2 py-0.5 text-2xs font-mono">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: C_RECOVERY }} />
            <span className="text-muted-foreground">Recovery:</span>
            <span className="font-bold text-foreground tabular-nums">
              {latestRow.recovery != null ? `${Number(latestRow.recovery).toFixed(1)}%` : '—'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground/80">
            <span className="w-2.5 h-[1.5px] bg-emerald-500" />
            <span>Target:</span>
            <span className="font-bold tabular-nums text-emerald-400">{recoveryMinPct}%</span>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={trendRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="productionFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={C_PRODUCTION} stopOpacity={0.25} />
                <stop offset="95%" stopColor={C_PRODUCTION} stopOpacity={0.03} />
              </linearGradient>
              <linearGradient id="consumptionFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={C_CONSUMPTION} stopOpacity={0.25} />
                <stop offset="95%" stopColor={C_CONSUMPTION} stopOpacity={0.03} />
              </linearGradient>
              <linearGradient id="recoveryFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={C_RECOVERY} stopOpacity={0.28} />
                <stop offset="95%" stopColor={C_RECOVERY} stopOpacity={0.03} />
              </linearGradient>
              {/* Tactical glow filters matching hero sparkline */}
              <filter id="productionGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor={C_PRODUCTION} floodOpacity="0.45" />
              </filter>
              <filter id="consumptionGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor={C_CONSUMPTION} floodOpacity="0.45" />
              </filter>
              <filter id="recoveryGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor={C_RECOVERY} floodOpacity="0.45" />
              </filter>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.25} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fontWeight: 500, fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)' }}
              stroke="hsl(var(--muted-foreground))"
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)' }}
              stroke="hsl(var(--muted-foreground))"
              tickFormatter={formatYAxis}
              width={44}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<NegativeAwareTooltip />} />
            {showProduction && (
              <>
                <Area
                  type="monotone"
                  dataKey="consumption"
                  stroke={C_CONSUMPTION}
                  strokeWidth={2.5}
                  fill="url(#consumptionFill)"
                  dot={false}
                  filter="url(#consumptionGlow)"
                  name="Consumption (m³)"
                />
                <Area
                  type="monotone"
                  dataKey="production"
                  stroke={C_PRODUCTION}
                  strokeWidth={2.5}
                  fill="url(#productionFill)"
                  dot={false}
                  filter="url(#productionGlow)"
                  name="Production (m³)"
                />
              </>
            )}
            {showRecovery && (
              <>
                <ReferenceLine
                  y={recoveryMinPct}
                  stroke="#10b981"
                  strokeDasharray="3 3"
                  strokeWidth={1.5}
                  label={{ value: `Min Target: ${recoveryMinPct}%`, fill: '#10b981', fontSize: 9, position: 'insideBottomLeft' }}
                />
                <Area
                  type="monotone"
                  dataKey="recovery"
                  stroke={C_RECOVERY}
                  strokeWidth={2.5}
                  fill="url(#recoveryFill)"
                  dot={false}
                  filter="url(#recoveryGlow)"
                  name="Recovery (%)"
                />
              </>
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

