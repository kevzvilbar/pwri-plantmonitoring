import React, { useState, useMemo, useCallback } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
} from 'recharts';
import {
  FlaskConical,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ShieldAlert,
  SlidersHorizontal,
  Info,
  Layers,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  CHLORINE_CONFIG,
  classifyChlorineReading,
  detectChlorineGaps,
  computeChlorineStats,
  type RawChlorinePoint,
  type ChlorineGap,
} from '@/lib/chlorineConfig';
import { DRILL_COLORS } from './TrendChartLegend';
import { CHART_CURSOR } from './TrendChartCanvas/chartShell';
import { INSTRUMENT_TOOLTIP_STYLE } from '@/shared/chartColors';

// All timestamps render in Plant time (Asia/Manila), never the viewer's device TZ.
const PH_TZ = 'Asia/Manila';
const AXIS_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: PH_TZ,
});
const FULL_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: PH_TZ,
});
const fmtAxis = (ts: number) => AXIS_FMT.format(new Date(ts));
const fmtFull = (ts: number) => FULL_FMT.format(new Date(ts));

/** Suspect readings are drawn pinned to this ceiling; the real value is shown in the tooltip. */
const Y_CAP = 3.5;
const SEG_SEP = '::';

export interface ChlorineReadingInput {
  id?: string;
  train_id?: string;
  reading_datetime?: string;
  chlorine_residual_mg_l?: number | string | null;
  verified?: boolean;
  /** ro_train_readings.norm_status: 'retracted' rows are dropped, 'normalized' counts as verified. */
  norm_status?: string | null;
}

export interface ChlorineResidualChartProps {
  roReadings?: ChlorineReadingInput[];
  roTrainEntities?: { id: string; label: string; color: string }[];
  plantNames?: Map<string, string>;
  roTrainNames?: Map<string, string>;
  compact?: boolean;
  selectedTrainIds?: Set<string> | null;
  onToggleTrain?: (trainId: string) => void;
  onSelectAllTrains?: () => void;
  onClearAllTrains?: () => void;
}

type GapViewMode = 'operator' | 'management';

export function ChlorineResidualChart({
  roReadings = [],
  roTrainEntities = [],
  roTrainNames,
  compact = false,
  selectedTrainIds,
  onToggleTrain,
  onSelectAllTrains,
  onClearAllTrains,
}: ChlorineResidualChartProps) {
  const [gapViewMode, setGapViewMode] = useState<GapViewMode>('operator');
  const [localSelectedTrains, setLocalSelectedTrains] = useState<Set<string> | null>(null);

  const activeTrainSet = selectedTrainIds !== undefined ? selectedTrainIds : localSelectedTrains;

  // Derive train entities if not provided from parent
  const availableTrainEntities = useMemo(() => {
    if (roTrainEntities.length > 0) return roTrainEntities;
    const ids = Array.from(
      new Set(roReadings.map((r) => r.train_id).filter(Boolean)),
    ) as string[];
    return ids
      .map((id, i) => ({
        id,
        label: roTrainNames?.get(id) ?? `Train ${id.slice(-4)}`,
        color: DRILL_COLORS[i % DRILL_COLORS.length],
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [roTrainEntities, roReadings, roTrainNames]);

  const handleTrainToggle = useCallback(
    (id: string) => {
      if (onToggleTrain) {
        onToggleTrain(id);
        return;
      }
      setLocalSelectedTrains((prev) => {
        const current = prev ?? new Set(availableTrainEntities.map((e) => e.id));
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next.size === availableTrainEntities.length ? null : next;
      });
    },
    [onToggleTrain, availableTrainEntities],
  );

  const handleSelectAll = useCallback(() => {
    if (onSelectAllTrains) {
      onSelectAllTrains();
      return;
    }
    setLocalSelectedTrains(null);
  }, [onSelectAllTrains]);

  const handleClearAll = useCallback(() => {
    if (onClearAllTrains) {
      onClearAllTrains();
      return;
    }
    setLocalSelectedTrains(new Set());
  }, [onClearAllTrains]);

  // Transform readings into RawChlorinePoint format.
  // Missing values (null/blank/NaN) and retracted rows are dropped here: a missing
  // reading is never a measurement, and the gap logic must see only real readings.
  const rawPoints = useMemo<RawChlorinePoint[]>(() => {
    const out: RawChlorinePoint[] = [];
    for (const r of roReadings) {
      if (!r.reading_datetime || !r.train_id) continue;
      if (r.norm_status === 'retracted') continue;
      if (r.chlorine_residual_mg_l == null || r.chlorine_residual_mg_l === '') continue;
      const val = Number(r.chlorine_residual_mg_l);
      if (!Number.isFinite(val)) continue;
      out.push({
        id: r.id,
        train_id: r.train_id,
        train_name: roTrainNames?.get(r.train_id) || `Train ${r.train_id.slice(-4)}`,
        reading_datetime: r.reading_datetime,
        chlorine_residual_mg_l: val,
        verified: r.verified === true || r.norm_status === 'normalized',
      });
    }
    return out;
  }, [roReadings, roTrainNames]);

  // Filter raw points by visible trains
  const filteredRawPoints = useMemo(() => {
    if (activeTrainSet === null) return rawPoints;
    return rawPoints.filter((p) => activeTrainSet.has(p.train_id));
  }, [rawPoints, activeTrainSet]);

  // Calculate stats & compliance
  const stats = useMemo(() => {
    return computeChlorineStats(filteredRawPoints, CHLORINE_CONFIG);
  }, [filteredRawPoints]);

  // Detect gaps based on current view mode threshold
  const gapThresholdMinutes =
    gapViewMode === 'operator'
      ? CHLORINE_CONFIG.gap_threshold_minutes.operator
      : CHLORINE_CONFIG.gap_threshold_minutes.management;

  const gaps = useMemo<ChlorineGap[]>(() => {
    return detectChlorineGaps(filteredRawPoints, gapThresholdMinutes, roTrainNames);
  }, [filteredRawPoints, gapThresholdMinutes, roTrainNames]);

  // One series per (train, continuous segment). A new segment starts after every gap
  // longer than the active threshold, so the line breaks across gaps and stays
  // connected across shorter ones (nulls from other trains' timestamps are skipped).
  const { chartRows, series, hasOffScale } = useMemo(() => {
    const gapEnds = new Map<string, number[]>();
    for (const g of gaps) {
      const list = gapEnds.get(g.train_id) ?? [];
      list.push(g.end_ts);
      gapEnds.set(g.train_id, list);
    }

    type Row = { ts: number; _meta: Map<string, RawChlorinePoint> } & Record<string, unknown>;
    const rowMap = new Map<number, Row>();
    const segCount = new Map<string, number>();
    let offScale = false;

    for (const pt of filteredRawPoints) {
      const ts = new Date(pt.reading_datetime).getTime();
      const val = pt.chlorine_residual_mg_l as number;
      const seg = (gapEnds.get(pt.train_id) ?? []).filter((end) => end <= ts).length;
      segCount.set(pt.train_id, Math.max(segCount.get(pt.train_id) ?? 0, seg + 1));

      let row = rowMap.get(ts);
      if (!row) {
        row = { ts, _meta: new Map() } as Row;
        rowMap.set(ts, row);
      }
      if (val > Y_CAP) offScale = true;
      row[`${pt.train_id}${SEG_SEP}${seg}`] = Math.min(val, Y_CAP);
      row._meta.set(pt.train_id, pt);
    }

    const seriesList: { key: string; trainId: string }[] = [];
    segCount.forEach((n, trainId) => {
      for (let i = 0; i < n; i++) seriesList.push({ key: `${trainId}${SEG_SEP}${i}`, trainId });
    });

    return {
      chartRows: Array.from(rowMap.values()).sort((x, y) => x.ts - y.ts),
      series: seriesList,
      hasOffScale: offScale,
    };
  }, [filteredRawPoints, gaps]);

  const trainMeta = useMemo(() => {
    const m = new Map<string, { label: string; color: string }>();
    availableTrainEntities.forEach((e) => m.set(e.id, { label: e.label, color: e.color }));
    return m;
  }, [availableTrainEntities]);

  // Y-axis always shows 0 to 1.5 (plus headroom); suspect values are pinned at Y_CAP.
  const yAxisMax = hasOffScale ? Y_CAP : (() => {
    const m = filteredRawPoints.reduce((mx, p) => Math.max(mx, p.chlorine_residual_mg_l ?? 0), 0);
    return m <= 1.8 ? 2.0 : Math.min(Y_CAP, +(m + 0.3).toFixed(1));
  })();

  interface CustomDotProps {
    cx?: number;
    cy?: number;
    value?: number | null;
    payload?: { _meta?: Map<string, RawChlorinePoint> };
    dataKey?: string;
    stroke?: string;
  }

  // Custom dot: colour by status of the REAL value (not the pinned plot value).
  const renderCustomDot = useCallback(
    (props: CustomDotProps): React.ReactElement => {
      const { cx, cy, value, dataKey, payload } = props;
      const empty = <circle key={`dot-empty-${dataKey}-${cx}`} cx={cx || 0} cy={cy || 0} r={0} opacity={0} />;
      if (value == null || !Number.isFinite(value) || cx == null || cy == null) return empty;

      const trainId = String(dataKey ?? '').split(SEG_SEP)[0];
      const pt = payload?._meta?.get(trainId);
      const real = pt?.chlorine_residual_mg_l ?? value;
      const status = classifyChlorineReading(real, CHLORINE_CONFIG);
      const unverifiedSuspect = status === 'suspect' && !pt?.verified;
      const k = `dot-${dataKey}-${cx}-${cy}`;

      if (unverifiedSuspect) {
        const offScale = real > Y_CAP;
        return (
          <g key={k}>
            <circle cx={cx} cy={cy} r={6} fill="#ffffff" stroke="#e11d48" strokeWidth={2} strokeDasharray="2 2" />
            {offScale && (
              <text x={cx} y={cy + 16} textAnchor="middle" fontSize={9} fontWeight={700} fill="#e11d48">
                {`▲ ${real.toFixed(1)}`}
              </text>
            )}
          </g>
        );
      }
      if (status === 'below_min') {
        return <circle key={k} cx={cx} cy={cy} r={4.5} fill="#f59e0b" stroke="#ffffff" strokeWidth={1.5} />;
      }
      if (status === 'above_max' || status === 'suspect') {
        // suspect + verified is a confirmed real exceedance
        return <circle key={k} cx={cx} cy={cy} r={4.5} fill="#ef4444" stroke="#ffffff" strokeWidth={1.5} />;
      }
      return <circle key={k} cx={cx} cy={cy} r={3} fill={props.stroke || '#10b981'} stroke="#ffffff" strokeWidth={1} />;
    },
    [],
  );

  interface TooltipEntry {
    value?: number | string | null;
    dataKey?: string;
    payload?: { ts?: number; _meta?: Map<string, RawChlorinePoint> };
  }

  interface CustomTooltipProps {
    active?: boolean;
    payload?: TooltipEntry[];
  }

  const statusBadge = (status: ReturnType<typeof classifyChlorineReading>, verified: boolean) => {
    if (status === 'below_min')
      return <Badge variant="outline" className="text-[10px] px-1 py-0 border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10">Below 0.3</Badge>;
    if (status === 'above_max')
      return <Badge variant="outline" className="text-[10px] px-1 py-0 border-rose-500/40 text-rose-600 dark:text-rose-400 bg-rose-500/10">Above 1.5</Badge>;
    if (status === 'suspect')
      return verified
        ? <Badge variant="outline" className="text-[10px] px-1 py-0 border-rose-500/40 text-rose-600 dark:text-rose-400 bg-rose-500/10">Above 1.5 (verified)</Badge>
        : <Badge variant="destructive" className="text-[10px] px-1 py-0 bg-red-600 text-white">Suspect (&gt;3.0)</Badge>;
    return <Badge variant="outline" className="text-[10px] px-1 py-0 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10">In Range</Badge>;
  };

  const CustomTooltip = ({ active, payload }: CustomTooltipProps) => {
    if (!active || !payload || !payload.length) return null;
    const row = payload[0]?.payload;
    const rows = payload
      .filter((e) => e.value != null)
      .map((e) => {
        const trainId = String(e.dataKey ?? '').split(SEG_SEP)[0];
        const pt = row?._meta?.get(trainId);
        return pt ? { trainId, pt } : null;
      })
      .filter((x): x is { trainId: string; pt: RawChlorinePoint } => x !== null);
    if (!rows.length) return null;

    const anySuspect = rows.some(({ pt }) =>
      classifyChlorineReading(pt.chlorine_residual_mg_l, CHLORINE_CONFIG) === 'suspect' && !pt.verified);

    return (
      <div style={INSTRUMENT_TOOLTIP_STYLE} className="p-3 min-w-[220px] max-w-[320px] space-y-2 text-xs">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-1.5 font-medium text-foreground">
          <div className="flex items-center gap-1.5">
            <FlaskConical className="h-3.5 w-3.5 text-emerald-500" />
            <span>Chlorine Residual</span>
          </div>
          <span className="text-[10px] text-muted-foreground font-mono">{row?.ts != null ? fmtFull(row.ts) : ''}</span>
        </div>
        <div className="space-y-1.5">
          {rows.map(({ trainId, pt }) => {
            const val = pt.chlorine_residual_mg_l as number;
            const meta = trainMeta.get(trainId);
            return (
              <div key={trainId} className="flex items-center justify-between gap-2 py-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta?.color }} />
                  <span className="font-medium text-muted-foreground">{meta?.label ?? pt.train_name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-foreground">{val.toFixed(2)} {CHLORINE_CONFIG.unit}</span>
                  {statusBadge(classifyChlorineReading(val, CHLORINE_CONFIG), pt.verified === true)}
                </div>
              </div>
            );
          })}
        </div>
        {anySuspect && (
          <div className="mt-2 pt-1.5 border-t border-destructive/20 text-[10px] text-destructive flex items-center gap-1">
            <ShieldAlert className="h-3 w-3 shrink-0" />
            <span>Readings &gt; 3.0 mg/L are excluded from compliance stats until verified.</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3" data-testid="chlorine-residual-chart-container">
      {/* Top Header & Sensitivity Mode Switch */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 pb-1">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <FlaskConical className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h4 className="text-sm font-semibold tracking-tight text-foreground">
                Free Chlorine Residual
              </h4>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-medium text-muted-foreground">
                PNSDW 0.3 – 1.5 mg/L
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Multi-train disinfection compliance & gap monitoring
            </p>
          </div>
        </div>

        {/* Gap Sensitivity Toggle (Operator 2h vs Management 4h) */}
        <div className="flex items-center gap-1.5 bg-muted/60 p-0.5 rounded-lg border border-border/60 text-xs">
          <button
            type="button"
            onClick={() => setGapViewMode('operator')}
            data-testid="gap-toggle-operator"
            className={`px-2.5 py-1 rounded-md transition-all text-xs font-medium ${
              gapViewMode === 'operator'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Operator (2h Gaps)
          </button>
          <button
            type="button"
            onClick={() => setGapViewMode('management')}
            data-testid="gap-toggle-management"
            className={`px-2.5 py-1 rounded-md transition-all text-xs font-medium ${
              gapViewMode === 'management'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Management (4h Gaps)
          </button>
        </div>
      </div>

      {/* KPI & Compliance Chips Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
        <div className="bg-muted/40 border border-border/60 rounded-lg p-2 flex flex-col justify-between">
          <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Valid Readings</span>
          <span className="text-base font-bold font-mono text-foreground mt-0.5">{stats.validCount}</span>
        </div>

        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2 flex flex-col justify-between">
          <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-medium uppercase tracking-wider flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> Compliance
          </span>
          <span className="text-base font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">
            {stats.compliancePct != null ? `${stats.compliancePct}%` : '—'}
          </span>
        </div>

        <div className="bg-muted/40 border border-border/60 rounded-lg p-2 flex flex-col justify-between">
          <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Avg Residual</span>
          <span className="text-base font-bold font-mono text-foreground mt-0.5">
            {stats.avgResidual != null ? `${stats.avgResidual} mg/L` : '—'}
          </span>
        </div>

        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2 flex flex-col justify-between">
          <span className="text-[10px] text-amber-700 dark:text-amber-400 font-medium uppercase tracking-wider">
            Below 0.3 mg/L
          </span>
          <span className="text-base font-bold font-mono text-amber-600 dark:text-amber-400 mt-0.5">
            {stats.belowMinCount}
          </span>
        </div>

        <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-2 flex flex-col justify-between">
          <span className="text-[10px] text-rose-700 dark:text-rose-400 font-medium uppercase tracking-wider">
            Above 1.5 mg/L
          </span>
          <span className="text-base font-bold font-mono text-rose-600 dark:text-rose-400 mt-0.5">
            {stats.aboveMaxCount}
          </span>
        </div>

        <div className={`rounded-lg p-2 flex flex-col justify-between border ${
          stats.suspectCount > 0 ? 'bg-red-500/15 border-red-500/40 text-red-600' : 'bg-muted/40 border-border/60 text-muted-foreground'
        }`}>
          <span className="text-[10px] font-medium uppercase tracking-wider flex items-center gap-1">
            <ShieldAlert className="h-3 w-3" /> Suspect (&gt;3.0)
          </span>
          <span className="text-base font-bold font-mono mt-0.5">
            {stats.suspectCount}
          </span>
        </div>
      </div>

      {/* Train Filter Selector Pills */}
      {availableTrainEntities.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="text-[11px] text-muted-foreground font-medium mr-1 flex items-center gap-1">
            <Layers className="h-3 w-3" /> Trains:
          </span>
          <Button
            variant={activeTrainSet === null ? 'default' : 'outline'}
            size="sm"
            className="h-6 text-[11px] px-2 rounded-md"
            onClick={handleSelectAll}
          >
            All ({availableTrainEntities.length})
          </Button>
          {availableTrainEntities.map((t) => {
            const isSelected = activeTrainSet === null || activeTrainSet.has(t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => handleTrainToggle(t.id)}
                className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-md text-[11px] font-medium border transition-all ${
                  isSelected
                    ? 'bg-background border-border text-foreground shadow-xs'
                    : 'bg-muted/30 border-transparent text-muted-foreground hover:bg-muted/60 opacity-60'
                }`}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />
                <span>{t.label}</span>
              </button>
            );
          })}
          {activeTrainSet !== null && activeTrainSet.size > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[11px] px-2 text-muted-foreground hover:text-foreground"
              onClick={handleClearAll}
            >
              Clear
            </Button>
          )}
        </div>
      )}

      {/* Detected Missing Data Gaps Notification Bar */}
      {gaps.length > 0 && (
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs">
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              <strong>{gaps.length} logging gap{gaps.length > 1 ? 's' : ''} detected</strong> (exceeding {gapThresholdMinutes / 60}h):{' '}
              {gaps.slice(0, 3).map((g, idx) => (
                <span key={idx} className="font-mono text-[11px] mr-2">
                  [{g.train_name}: {g.duration_hours}h gap]
                </span>
              ))}
              {gaps.length > 3 && <span>+{gaps.length - 3} more</span>}
            </span>
          </div>
          <span className="text-[10px] opacity-80">Line series disconnected across gap intervals</span>
        </div>
      )}

      {/* Main Chart Canvas */}
      <div className={`w-full ${compact ? 'h-[240px]' : 'h-[360px]'} min-w-0 transition-all`}>
        {chartRows.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2 border border-dashed rounded-xl bg-muted/20">
            <FlaskConical className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm font-medium">No Chlorine Residual readings for the selected range</p>
            <p className="text-xs text-muted-foreground">Operator readings logged under Pretreatment / RO logs will appear here</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartRows} margin={{ top: 12, right: 16, left: 0, bottom: 6 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} vertical={false} />

              <XAxis
                dataKey="ts"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={fmtAxis}
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                axisLine={{ stroke: 'hsl(var(--border))' }}
                tickLine={false}
              />

              <YAxis
                domain={[0, yAxisMax]}
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                axisLine={false}
                tickLine={false}
                unit=" mg/L"
                width={56}
              />

              {/* PNSDW Green Safe Compliance Zone (0.3 - 1.5 mg/L) */}
              <ReferenceArea
                y1={CHLORINE_CONFIG.min_limit}
                y2={CHLORINE_CONFIG.max_limit}
                fill="#10b981"
                fillOpacity={0.08}
                stroke="#10b981"
                strokeOpacity={0.25}
                strokeDasharray="3 3"
              />

              {/* Threshold Lines */}
              <ReferenceLine
                y={CHLORINE_CONFIG.min_limit}
                stroke="#f59e0b"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                label={{
                  value: `Min Limit (${CHLORINE_CONFIG.min_limit} mg/L)`,
                  position: 'insideBottomLeft',
                  fill: '#f59e0b',
                  fontSize: 9,
                  fontWeight: 600,
                }}
              />

              <ReferenceLine
                y={CHLORINE_CONFIG.max_limit}
                stroke="#ef4444"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                label={{
                  value: `Max Limit (${CHLORINE_CONFIG.max_limit} mg/L)`,
                  position: 'insideTopLeft',
                  fill: '#ef4444',
                  fontSize: 9,
                  fontWeight: 600,
                }}
              />

              {/* Suspect Outlier Boundary (3.0 mg/L) */}
              {yAxisMax >= 3.0 && (
                <ReferenceLine
                  y={CHLORINE_CONFIG.suspect_threshold}
                  stroke="#e11d48"
                  strokeDasharray="2 2"
                  strokeWidth={1}
                  label={{
                    value: `Suspect Review (${CHLORINE_CONFIG.suspect_threshold} mg/L)`,
                    position: 'insideTopRight',
                    fill: '#e11d48',
                    fontSize: 8,
                    fontWeight: 500,
                  }}
                />
              )}

              {/* Detected gaps: grey bands on a true time axis, so width = duration */}
              {gaps.map((gap, idx) => (
                <ReferenceArea
                  key={`gap-${gap.train_id}-${idx}`}
                  x1={gap.start_ts}
                  x2={gap.end_ts}
                  fill="#64748b"
                  fillOpacity={0.14}
                  stroke="#94a3b8"
                  strokeOpacity={0.35}
                  strokeDasharray="2 2"
                  ifOverflow="hidden"
                />
              ))}

              <Tooltip content={<CustomTooltip />} cursor={CHART_CURSOR} />

              {/* One Line per (train, segment); segments break at gaps */}
              {series.map(({ key, trainId }) => {
                const meta = trainMeta.get(trainId);
                return (
                  <Line
                    key={key}
                    type="linear"
                    dataKey={key}
                    name={meta?.label ?? trainId}
                    stroke={meta?.color ?? '#10b981'}
                    strokeWidth={2}
                    dot={renderCustomDot}
                    activeDot={{ r: 5, strokeWidth: 1.5, stroke: '#ffffff' }}
                    connectNulls
                    isAnimationActive={false}
                  />
                );
              })}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Legend & Guide Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-border/50 text-[11px] text-muted-foreground">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1 font-medium text-foreground">
            <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" /> In Range (0.3–1.5)
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-amber-500 inline-block" /> Low Disinfection (&lt;0.3)
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-rose-500 inline-block" /> High Residual (&gt;1.5)
          </span>
          <span className="flex items-center gap-1 text-red-600 dark:text-red-400 font-semibold">
            <span className="h-2.5 w-2.5 rounded-full border border-red-600 inline-flex items-center justify-center text-[7px]">!</span> Suspect (&gt;3.0)
          </span>
        </div>

        <div className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Info className="h-3 w-3 text-muted-foreground" />
          <span>Gaps span &gt;{gapThresholdMinutes / 60}h without logged readings.</span>
        </div>
      </div>
    </div>
  );
}
