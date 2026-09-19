import { Sun } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { fmtNum } from '@/lib/calculations';
import { Loader2, BarChart2 } from 'lucide-react';
import { GridPylonIcon } from '@/components/icons/water-icons';
import type { PowerHistoryRow } from '../hooks/usePowerHistoryQuery';

interface PowerChartProps {
  chartRows: PowerHistoryRow[];
  hasSolar: boolean;
  hasGrid: boolean;
  isLoading: boolean;
  rangeAggregates: { totalKwh: number };
}

export function PowerChart({
  chartRows, hasSolar, hasGrid, isLoading, rangeAggregates,
}: PowerChartProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-60 gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading power telemetry…
      </div>
    );
  }

  if (chartRows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-60 gap-2 text-xs text-muted-foreground">
        <BarChart2 className="h-8 w-8 opacity-30" />
        <p>No power readings recorded for this plant in the selected period.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartRows}
            margin={{ top: 8, right: 8, bottom: 22, left: 4 }}
            barSize={Math.max(4, Math.min(18, 520 / chartRows.length))}
          >
            <defs>
              <linearGradient id="solarGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(48, 96%, 53%)" stopOpacity={0.95} />
                <stop offset="100%" stopColor="hsl(38, 92%, 48%)" stopOpacity={0.8} />
              </linearGradient>
              <linearGradient id="gridGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(213, 94%, 68%)" stopOpacity={0.95} />
                <stop offset="100%" stopColor="hsl(217, 91%, 55%)" stopOpacity={0.8} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.6} vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              tickFormatter={(v: string) => v.slice(5)}
              interval="preserveStartEnd"
              angle={-25}
              textAnchor="end"
              height={38}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              width={46}
              tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)}
            />
            <Tooltip
              formatter={(v: any, name: string) => [`${fmtNum(v)} kWh`, name === 'solar' ? '☀️ Solar' : '⚡ Grid']}
              labelFormatter={(label: string) => `Reading Date: ${label}`}
              labelStyle={{ fontSize: 12, fontWeight: 600 }}
              contentStyle={{
                fontSize: 12,
                borderRadius: 10,
                background: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                boxShadow: 'var(--shadow-elev)',
              }}
            />
            {hasSolar && (
              <Bar dataKey="solar" fill="url(#solarGradient)" name="solar" radius={[0, 0, 0, 0]} stackId="a" />
            )}
            {hasGrid && (
              <Bar dataKey="grid" fill="url(#gridGradient)" name="grid" radius={[3, 3, 0, 0]} stackId="a" />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Legend Strip */}
      <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/40">
        <div className="flex items-center gap-4">
          {hasSolar && (
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-warn shadow-xs" />
              <span className="font-medium text-foreground">Solar (kWh)</span>
            </div>
          )}
          {hasGrid && (
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-info shadow-xs" />
              <span className="font-medium text-foreground">Grid (kWh)</span>
            </div>
          )}
        </div>
        <span className="text-3xs text-muted-foreground font-mono">
          Total Energy {fmtNum(rangeAggregates.totalKwh)} kWh
        </span>
      </div>
    </div>
  );
}
