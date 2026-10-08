import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
} from 'recharts';
import { FlaskConical } from 'lucide-react';
import {
  CHLORINE_CONFIG,
  NO_RESIDUAL_MG_L,
  classifyChlorineReading,
  type HourlyChlorineSeries,
} from '@/lib/chlorineConfig';
import { INSTRUMENT_TOOLTIP_STYLE } from '@/lib/chartColors';
import { CHART_CURSOR } from './chartShell';

// Plant time, never the viewer's device timezone (same rule as ChlorineResidualChart).
const PH_TZ = 'Asia/Manila';
const AXIS_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', hour: 'numeric', hour12: true, timeZone: PH_TZ,
});
const FULL_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: PH_TZ,
});
const fmtAxis = (ts: number) => AXIS_FMT.format(new Date(ts));
const fmtFull = (ts: number) => FULL_FMT.format(new Date(ts));

interface TrainEntity { id: string; label: string; color: string }

function statusOf(v: number): { text: string; glyph: string; cls: string } {
  if (v <= NO_RESIDUAL_MG_L) return { text: 'No residual', glyph: '⚠', cls: 'text-rose-500' };
  const st = classifyChlorineReading(v, CHLORINE_CONFIG);
  if (st === 'below_min') return { text: 'Below 0.3', glyph: '▼', cls: 'text-amber-500' };
  if (st === 'above_max' || st === 'suspect') return { text: 'Above 1.5', glyph: '▲', cls: 'text-rose-500' };
  return { text: 'In range', glyph: '', cls: 'text-emerald-500' };
}

/**
 * Chlorine "Hourly" view: one line per RO train. Trains are never averaged together here.
 * The 0.3–1.5 mg/L band is always drawn. Lines break across gaps longer than the operator limit,
 * and unverified suspect (> 3.0 mg/L) readings are already excluded upstream.
 */
export function ChlorineHourlyByTrainChart({
  hourly,
  trainEntities,
  handleTrainLegendIsolate,
}: {
  hourly: HourlyChlorineSeries;
  trainEntities: TrainEntity[];
  handleTrainLegendIsolate?: (e: { dataKey: string }) => void;
}) {
  const meta = useMemo(() => new Map(trainEntities.map((t) => [t.id, t])), [trainEntities]);

  // Only draw trains that are currently visible (train filter).
  const series = useMemo(() => hourly.series.filter((s) => meta.has(s.trainId)), [hourly.series, meta]);

  const yMax = useMemo(() => {
    let m = 0;
    for (const row of hourly.rows) {
      for (const t of trainEntities) {
        const v = row[`val:${t.id}`];
        if (typeof v === 'number') m = Math.max(m, v);
      }
    }
    return m <= 1.8 ? 2.0 : +(m + 0.3).toFixed(1);
  }, [hourly.rows, trainEntities]);

  if (hourly.rows.length === 0 || series.length === 0) {
    return (
      <div
        className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2 border border-dashed rounded-xl bg-muted/20"
        data-testid="chlorine-hourly-empty"
      >
        <FlaskConical className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-medium">No valid hourly Chlorine Residual readings for the selected trains</p>
        <p className="text-xs text-muted-foreground">Readings above 3.0 mg/L are excluded until verified</p>
      </div>
    );
  }

  const HourlyTooltip = ({ active, payload }: { active?: boolean; payload?: { payload?: Record<string, number> }[] }) => {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload;
    if (!row) return null;
    const lines = trainEntities.filter((t) => typeof row[`val:${t.id}`] === 'number');
    if (lines.length === 0) return null;
    return (
      <div style={INSTRUMENT_TOOLTIP_STYLE} className="p-3 min-w-[200px] space-y-1.5 text-xs" data-testid="chlorine-hourly-tooltip">
        <div className="border-b border-border/60 pb-1 font-medium text-foreground">{fmtFull(row.ts)} · hourly average</div>
        {lines.map((t) => {
          const v = row[`val:${t.id}`];
          const st = statusOf(v);
          return (
            <div key={t.id} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />
                {t.label}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="font-mono font-bold text-foreground">{v.toFixed(2)} {CHLORINE_CONFIG.unit}</span>
                <span className={`text-[10px] font-medium ${st.cls}`}>{st.glyph} {st.text}</span>
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex h-full w-full flex-col" data-testid="chlorine-hourly-by-train">
      {/* Legend: one entry per train (the chart has several line segments per train, so a stock legend would repeat). */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 pb-1 text-[11px]">
        {trainEntities.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => handleTrainLegendIsolate?.({ dataKey: t.id })}
            data-testid={`chlorine-hourly-legend-${t.id}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-0.5 font-medium text-foreground hover:bg-muted"
            title="Click to isolate this train"
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />
            {t.label}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-muted-foreground">
          Hourly avg per train · band {CHLORINE_CONFIG.min_limit}–{CHLORINE_CONFIG.max_limit} {CHLORINE_CONFIG.unit} · lines break after &gt;{CHLORINE_CONFIG.gap_threshold_minutes.operator / 60}h without data
        </span>
      </div>

      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={hourly.rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
            <XAxis
              dataKey="ts"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={fmtAxis}
              tick={{ fontSize: 9, fontWeight: 500 }}
              stroke="hsl(var(--muted-foreground))"
              axisLine={false}
              tickLine={false}
              minTickGap={32}
            />
            <YAxis
              domain={[0, yMax]}
              tick={{ fontSize: 10 }}
              stroke="hsl(var(--muted-foreground))"
              width={44}
              axisLine={false}
              tickLine={false}
            />
            {/* Compliance band: always shown, identical for every train */}
            <ReferenceArea y1={CHLORINE_CONFIG.min_limit} y2={CHLORINE_CONFIG.max_limit} fill="#10b981" fillOpacity={0.08} stroke="#10b981" strokeOpacity={0.25} strokeDasharray="3 3" />
            <ReferenceLine y={CHLORINE_CONFIG.min_limit} stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={1.5} />
            <ReferenceLine y={CHLORINE_CONFIG.max_limit} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1.5} />
            <Tooltip content={<HourlyTooltip />} cursor={CHART_CURSOR} />
            {series.map(({ key, trainId }) => {
              const t = meta.get(trainId)!;
              return (
                <Line
                  key={key}
                  type="linear"
                  dataKey={key}
                  name={t.label}
                  stroke={t.color}
                  strokeWidth={2}
                  dot={{ r: 2.5, fill: t.color, stroke: '#ffffff', strokeWidth: 1 }}
                  activeDot={{ r: 4.5 }}
                  connectNulls
                  isAnimationActive={false}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
