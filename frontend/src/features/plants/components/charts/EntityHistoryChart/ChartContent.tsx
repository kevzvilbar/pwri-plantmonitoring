import React, { useState } from 'react';
import { DataState } from '@/components/DataState';
import { ResponsiveContainer, ComposedChart, BarChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Bar, Line, Area } from 'recharts';
import { C_PRODUCTION, C_CONSUMPTION, C_NRW, C_RAWWATER, C_BLEND_PCT, C_BLEND_VOLUME } from '@/lib/chartColors';

const SIBLING_PALETTE = [
  'hsl(199, 89%, 55%)', 'hsl(38, 92%, 55%)', 'hsl(271, 68%, 62%)',
  'hsl(330, 65%, 55%)', 'hsl(0, 72%, 60%)', 'hsl(24, 90%, 58%)',
  'hsl(291, 55%, 60%)', 'hsl(199, 40%, 70%)',
];

const siblingDataKey = (locatorId: string) => `sib_${locatorId}`;

export interface ChartContentProps {
  chartData: any[];
  aggregatedLength: number;
  hasSiblings: boolean;
  hasBlending: boolean;
  siblingStacked: boolean;
  setSiblingStacked: (v: boolean) => void;
  siblingLocators: { id: string; name: string }[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  customTooltip: (props: any) => React.ReactNode;
  onSelectNode?: (nodeId: string) => void;
}

export function ChartContent({
  chartData, aggregatedLength, hasSiblings, hasBlending, siblingStacked,
  setSiblingStacked, siblingLocators, isLoading, error, refetch, customTooltip,
}: ChartContentProps) {
  return (
    <DataState
      loading={isLoading}
      error={error}
      onRetry={() => refetch()}
      isEmpty={aggregatedLength === 0}
      emptyTitle="No readings in this period"
    >
      {hasSiblings ? (
        <div className="h-60 w-full flex flex-col">
          {(siblingLocators?.length ?? 0) > 1 && (
            <div className="flex items-center justify-end gap-1.5 mb-1 shrink-0">
              <span className="text-2xs text-muted-foreground">Locators:</span>
              <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
                {([
                  { key: false, label: 'Total' },
                  { key: true, label: 'Stacked' },
                ] as const).map(opt => (
                  <button
                    key={String(opt.key)}
                    onClick={() => setSiblingStacked(opt.key)}
                    className={`px-2 py-0.5 rounded text-2xs font-medium transition-colors ${
                      siblingStacked === opt.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >{opt.label}</button>
                ))}
              </div>
            </div>
          )}
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 20, left: 0 }} barSize={Math.max(3, Math.min(16, 400 / chartData.length))}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={(v: string) => v.slice(5)}
                  interval="preserveStartEnd"
                  angle={-30}
                  textAnchor="end"
                  height={36}
                />
                <YAxis
                  yAxisId="vol"
                  tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                  width={38}
                  tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : String(v)}
                />
                <YAxis
                  yAxisId="pct"
                  orientation="right"
                  tick={{ fontSize: 9, fill: C_NRW }}
                  width={30}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip content={customTooltip} />
                <Legend wrapperStyle={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.02em', paddingTop: 4 }} />
                <Bar yAxisId="vol" dataKey="consumption" fill={C_PRODUCTION} name="Mother Meter" radius={[2,2,0,0]} />
                {siblingStacked && (siblingLocators?.length ?? 0) > 1 ? (
                  (siblingLocators ?? []).map((l, i) => (
                    <Bar
                      key={l.id}
                      yAxisId="vol"
                      dataKey={siblingDataKey(l.id)}
                      stackId="siblings"
                      fill={SIBLING_PALETTE[i % SIBLING_PALETTE.length]}
                      name={l.name}
                      radius={i === (siblingLocators?.length ?? 0) - 1 ? [2, 2, 0, 0] : 0}
                    />
                  ))
                ) : (
                  <Bar yAxisId="vol" dataKey="siblingTotal" fill={C_CONSUMPTION} name="Locators Total" radius={[2,2,0,0]} />
                )}
                <Line yAxisId="pct" type="monotone" dataKey="nrw" stroke={C_NRW} strokeWidth={2} dot={{ r: 2.5, fill: C_NRW, strokeWidth: 0 }} name="NRW %" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : hasBlending ? (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 20, left: 0 }} barSize={Math.max(3, Math.min(16, 400 / chartData.length))}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(v: string) => v.slice(5)}
                interval="preserveStartEnd"
                angle={-30}
                textAnchor="end"
                height={36}
              />
              <YAxis
                yAxisId="vol"
                tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                width={38}
                tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : String(v)}
              />
              <YAxis
                yAxisId="pct"
                orientation="right"
                tick={{ fontSize: 9, fill: C_BLEND_PCT }}
                width={30}
                tickFormatter={(v: number) => `${v}%`}
              />
              <Tooltip content={customTooltip} />
              <Legend wrapperStyle={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.02em', paddingTop: 4 }} />
              <Bar yAxisId="vol" dataKey="consumption" fill={C_RAWWATER} name="Raw Water" radius={[2,2,0,0]} />
              <Bar yAxisId="vol" dataKey="blendedVolume" fill={C_BLEND_VOLUME} name="Blended" radius={[2,2,0,0]} />
              <Line yAxisId="pct" type="monotone" dataKey="blendedPct" stroke={C_BLEND_PCT} strokeWidth={2} dot={{ r: 2.5, fill: C_BLEND_PCT, strokeWidth: 0 }} name="% Blended" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={aggregatedLength > 0 ? chartData : []} margin={{ top: 4, right: 4, bottom: 20, left: 0 }} barSize={Math.max(3, Math.min(16, 400 / Math.max(1, aggregatedLength)))}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(v: string) => v.slice(5)}
                interval="preserveStartEnd"
                angle={-30}
                textAnchor="end"
                height={36}
              />
              <YAxis
                tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                width={38}
                tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : String(v)}
              />
              <Tooltip content={customTooltip} />
              <Bar dataKey="consumption" fill="hsl(174, 72%, 40%)" name="Consumption" radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </DataState>
  );
}
