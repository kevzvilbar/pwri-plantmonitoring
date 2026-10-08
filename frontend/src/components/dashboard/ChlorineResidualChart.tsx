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
  Info,
  Layers,
  TrendingUp,
  TrendingDown,
  Minus,
  RotateCcw,
  Edit3,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/store/appStore';
import { CorrectionRequestDialog, type CorrectionTarget } from '@/components/CorrectionRequestDialog';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';
import {
  CHLORINE_CONFIG,
  classifyChlorineReading,
  detectChlorineGaps,
  computeChlorineStats,
  computeDailyChlorineAverages,
  summarizeChlorineGaps,
  latestChlorineByTrain,
  NO_RESIDUAL_MG_L,
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
const DATE_KEY_FMT = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: PH_TZ,
});
const fmtAxis = (ts: number) => AXIS_FMT.format(new Date(ts));
const fmtFull = (ts: number) => FULL_FMT.format(new Date(ts));
const DAY_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: PH_TZ });
const fmtDay = (ts: number) => DAY_FMT.format(new Date(ts));
const HALF_DAY_MS = 43_200_000;

type ViewMode = 'daily' | 'readings';

const STATUS_TONE: Record<string, { text: string; border: string; bg: string }> = {
  in_range: { text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-500/40', bg: 'bg-emerald-500/10' },
  below_min: { text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-500/40', bg: 'bg-amber-500/10' },
  above_max: { text: 'text-rose-600 dark:text-rose-400', border: 'border-rose-500/40', bg: 'bg-rose-500/10' },
  suspect: { text: 'text-rose-600 dark:text-rose-400', border: 'border-rose-500/40', bg: 'bg-rose-500/10' },
  // Effectively no residual (<= NO_RESIDUAL_MG_L): worse than a plain low reading, so it gets the alarm colour.
  critical_low: { text: 'text-rose-600 dark:text-rose-400', border: 'border-rose-500/60', bg: 'bg-rose-500/15' },
  missing: { text: 'text-muted-foreground', border: 'border-border/60', bg: 'bg-muted/30' },
};

/** Tile/hero status for a daily value: adds `critical_low` on top of the reading classifier. */
function dayTone(value: number | null): string {
  if (value == null) return 'missing';
  if (value <= NO_RESIDUAL_MG_L) return 'critical_low';
  return classifyChlorineReading(value, CHLORINE_CONFIG);
}

/** Icon + word so status never depends on colour alone. */
function StatusGlyph({ status, className = 'h-2.5 w-2.5' }: { status: string; className?: string }) {
  if (status === 'critical_low') return <AlertTriangle className={className} aria-hidden />;
  if (status === 'below_min') return <ArrowDown className={className} aria-hidden />;
  if (status === 'above_max' || status === 'suspect') return <ArrowUp className={className} aria-hidden />;
  return null;
}

const STATUS_WORD: Record<string, string> = {
  in_range: 'in range',
  below_min: 'below minimum',
  above_max: 'above maximum',
  suspect: 'suspect',
  critical_low: 'no residual',
  missing: 'no valid readings',
};

/** Scale of the latest-reading band bars (mg/L). Values above are pinned to the right edge with an arrow. */
const BAR_MAX = 2.0;
const barPct = (v: number) => Math.min(100, Math.max(0, (v / BAR_MAX) * 100));

/** Suspect readings are drawn pinned to this ceiling; the real value is shown in the tooltip. */
const Y_CAP = 3.5;
const SEG_SEP = '::';

export interface ChlorineReadingInput {
  id?: string;
  train_id?: string;
  train_name?: string;
  plant_id?: string;
  reading_datetime?: string;
  chlorine_residual_mg_l?: number | string | null;
  verified?: boolean;
  /** ro_train_readings.norm_status: 'retracted' rows are dropped, 'normalized' counts as verified. */
  norm_status?: string | null;
}

export interface ChlorineResidualChartProps {
  plantId?: string;
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
  plantId,
  roReadings = [],
  roTrainEntities = [],
  roTrainNames,
  compact = false,
  selectedTrainIds,
  onToggleTrain,
  onSelectAllTrains,
  onClearAllTrains,
}: ChlorineResidualChartProps) {
  const storePlantId = useAppStore((s) => s.selectedPlantId);
  const activePlantId = plantId ?? storePlantId ?? '';

  const [gapViewMode, setGapViewMode] = useState<GapViewMode>('operator');
  const [localSelectedTrains, setLocalSelectedTrains] = useState<Set<string> | null>(null);
  const [showOverallAvg, setShowOverallAvg] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('daily');
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [correctionTarget, setCorrectionTarget] = useState<CorrectionTarget | null>(null);
  const [suspectListOpen, setSuspectListOpen] = useState(false);

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
        train_name: r.train_name || roTrainNames?.get(r.train_id) || `Train ${r.train_id.slice(-4)}`,
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

  const gapSummary = useMemo(() => summarizeChlorineGaps(gaps), [gaps]);

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

    // Compute overall daily averages across valid (non-suspect) readings
    const dayPointsAcc = new Map<string, { sum: number; count: number }>();
    for (const pt of filteredRawPoints) {
      const val = pt.chlorine_residual_mg_l as number;
      const status = classifyChlorineReading(val, CHLORINE_CONFIG);
      if (status === 'suspect' && !pt.verified) continue;
      const dt = new Date(pt.reading_datetime);
      const dk = DATE_KEY_FMT.format(dt);
      const cur = dayPointsAcc.get(dk) ?? { sum: 0, count: 0 };
      dayPointsAcc.set(dk, { sum: cur.sum + val, count: cur.count + 1 });
    }

    const dayAvgMap = new Map<string, number>();
    dayPointsAcc.forEach((v, dk) => {
      if (v.count > 0) dayAvgMap.set(dk, +(v.sum / v.count).toFixed(2));
    });

    for (const row of rowMap.values()) {
      const dk = DATE_KEY_FMT.format(new Date(row.ts));
      const dayAvg = dayAvgMap.get(dk);
      if (dayAvg != null) {
        row.overall_daily_avg = dayAvg;
      }
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

  // Daily averages (Plant calendar day), the default view.
  const dailyDays = useMemo(
    () => computeDailyChlorineAverages(filteredRawPoints, CHLORINE_CONFIG),
    [filteredRawPoints],
  );

  const dailyRows = useMemo(
    () =>
      dailyDays.map((d) => {
        const row: Record<string, number | string | null> = {
          ts: d.ts, overall: d.overall, _n: d.overallCount,
          _min: d.min, _max: d.max, _below: d.belowCount, _above: d.aboveCount,
        };
        Object.entries(d.perTrain).forEach(([id, v]) => { row[id] = v.avg; });
        return row;
      }),
    [dailyDays],
  );

  const dailySummary = useMemo(() => {
    const withData = dailyDays.filter((d) => d.overall != null);
    if (withData.length === 0) return null;
    const latest = withData[withData.length - 1];
    const prev = withData.length > 1 ? withData[withData.length - 2] : null;
    const periodAvg = +(withData.reduce((a, d) => a + (d.overall as number), 0) / withData.length).toFixed(2);
    const inBand = withData.filter(
      (d) => classifyChlorineReading(d.overall as number, CHLORINE_CONFIG) === 'in_range',
    ).length;
    const noResidualReadings = withData.reduce((a, d) => a + d.noResidualCount, 0);
    const exclDays = withData.filter((d) => d.overallExclNoResidual != null);
    const periodAvgExcl = exclDays.length > 0
      ? +(exclDays.reduce((a, d) => a + (d.overallExclNoResidual as number), 0) / exclDays.length).toFixed(2)
      : null;
    return { latest, prev, periodAvg, periodAvgExcl, noResidualReadings, daysWithData: withData.length, inBand };
  }, [dailyDays]);

  // Active focused day (user-selected or latest day with readings)
  const activeDay = useMemo(() => {
    if (selectedDayKey) {
      const found = dailyDays.find((d) => d.dateKey === selectedDayKey);
      if (found) return found;
    }
    return dailySummary?.latest ?? null;
  }, [dailyDays, selectedDayKey, dailySummary]);

  // Chronological predecessor of the active day
  const activeDayPrev = useMemo(() => {
    if (!activeDay) return null;
    const idx = dailyDays.findIndex((d) => d.dateKey === activeDay.dateKey);
    if (idx <= 0) return null;
    return dailyDays[idx - 1];
  }, [dailyDays, activeDay]);

  const activeDayDelta = useMemo(() => {
    if (!activeDay || activeDay.overall == null || !activeDayPrev || activeDayPrev.overall == null) return null;
    return +(activeDay.overall - activeDayPrev.overall).toFixed(2);
  }, [activeDay, activeDayPrev]);

  // Suspect unverified readings available for review / correction
  const suspectPoints = useMemo(() => {
    return filteredRawPoints.filter((pt) => {
      const val = pt.chlorine_residual_mg_l;
      return val != null && classifyChlorineReading(val, CHLORINE_CONFIG) === 'suspect' && !pt.verified;
    });
  }, [filteredRawPoints]);

  const trainMeta = useMemo(() => {
    const m = new Map<string, { label: string; color: string }>();
    availableTrainEntities.forEach((e) => m.set(e.id, { label: e.label, color: e.color }));
    return m;
  }, [availableTrainEntities]);

  const latestByTrain = useMemo(
    () => latestChlorineByTrain(filteredRawPoints, CHLORINE_CONFIG),
    [filteredRawPoints],
  );

  const handleOpenSuspectReview = useCallback((pt?: RawChlorinePoint) => {
    if (pt) {
      setCorrectionTarget({
        id: pt.id || '',
        sourceTable: 'ro_train_readings',
        plantId: activePlantId,
        entityName: pt.train_name || trainMeta.get(pt.train_id)?.label || `Train ${pt.train_id.slice(-4)}`,
        currentReading: Number(pt.chlorine_residual_mg_l),
        previousReading: null,
        dailyVolume: null,
        readingDatetime: pt.reading_datetime,
      });
      return;
    }
    if (suspectPoints.length === 1) {
      const single = suspectPoints[0];
      setCorrectionTarget({
        id: single.id || '',
        sourceTable: 'ro_train_readings',
        plantId: activePlantId,
        entityName: single.train_name || trainMeta.get(single.train_id)?.label || `Train ${single.train_id.slice(-4)}`,
        currentReading: Number(single.chlorine_residual_mg_l),
        previousReading: null,
        dailyVolume: null,
        readingDatetime: single.reading_datetime,
      });
    } else if (suspectPoints.length > 1) {
      setSuspectListOpen(true);
    }
  }, [suspectPoints, activePlantId, trainMeta]);

  const dailyYMax = useMemo(() => {
    let m = 0;
    for (const d of dailyDays) {
      if (d.overall != null) m = Math.max(m, d.overall);
      Object.values(d.perTrain).forEach((v) => { m = Math.max(m, v.avg); });
    }
    return m <= 1.8 ? 2.0 : +(m + 0.3).toFixed(1);
  }, [dailyDays]);

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
    payload?: { ts?: number; _meta?: Map<string, RawChlorinePoint>; overall_daily_avg?: number } & Record<string, unknown>;
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

    const suspectRows = rows.filter(({ pt }) =>
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
        {showOverallAvg && row?.overall_daily_avg != null && (
          <div className="flex items-center justify-between gap-2 py-1 border-t border-border/60 mt-1 pt-1">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-sky-400" />
              <span className="font-semibold text-foreground">Overall Daily Avg</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="font-mono font-bold text-sky-500">{Number(row.overall_daily_avg).toFixed(2)} {CHLORINE_CONFIG.unit}</span>
              {statusBadge(classifyChlorineReading(Number(row.overall_daily_avg), CHLORINE_CONFIG), false)}
            </div>
          </div>
        )}
        {suspectRows.length > 0 && (
          <div className="mt-2 pt-1.5 border-t border-destructive/20 text-[10px] text-destructive flex flex-col gap-1.5">
            <div className="flex items-center gap-1">
              <ShieldAlert className="h-3 w-3 shrink-0" />
              <span>Readings &gt; 3.0 mg/L are excluded from stats until verified.</span>
            </div>
            {suspectRows.map(({ pt }) => (
              <button
                key={`suspect-tt-${pt.id || pt.train_id}`}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenSuspectReview(pt);
                }}
                data-testid="tooltip-correct-suspect-btn"
                className="w-full inline-flex items-center justify-center gap-1 px-2 py-1 rounded bg-red-500/15 border border-red-500/30 text-[10px] font-semibold text-red-700 dark:text-red-300 hover:bg-red-500/25 transition-colors cursor-pointer"
              >
                <Edit3 className="h-2.5 w-2.5" /> Flag / Correct Outlier
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const DailyTooltip = ({ active, payload }: { active?: boolean; payload?: { payload?: Record<string, number | string | null> }[] }) => {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload;
    if (!row) return null;
    const overall = row.overall as number | null;
    return (
      <div style={INSTRUMENT_TOOLTIP_STYLE} className="p-3 min-w-[200px] max-w-[300px] space-y-2 text-xs">
        <div className="border-b border-border/60 pb-1.5 font-medium text-foreground">{fmtDay(Number(row.ts))} · daily average</div>
        {overall == null ? (
          <div className="text-muted-foreground">No valid readings this day</div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-sky-500">Overall</span>
            <span className="flex items-center gap-2">
              <span className="font-mono font-bold text-foreground">{overall.toFixed(2)} {CHLORINE_CONFIG.unit}</span>
              {statusBadge(classifyChlorineReading(overall, CHLORINE_CONFIG), false)}
            </span>
          </div>
        )}
        {overall != null && <div className="text-[10px] text-muted-foreground">{String(row._n)} valid reading(s)</div>}
        {overall != null && row._min != null && row._max != null && (
          <div className="text-[10px] text-muted-foreground">
            Range {Number(row._min).toFixed(2)}–{Number(row._max).toFixed(2)}
            {Number(row._below) + Number(row._above) > 0 && (
              <span className="text-amber-600 dark:text-amber-400 font-semibold">
                {' '}· {Number(row._below)} below, {Number(row._above)} above limits
              </span>
            )}
          </div>
        )}
        {availableTrainEntities
          .filter((t) => row[t.id] != null)
          .map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />{t.label}
              </span>
              <span className="font-mono font-semibold text-foreground">{Number(row[t.id]).toFixed(2)}</span>
            </div>
          ))}
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

      {/* Daily average hero & Interactive Day Focus Strip */}
      {dailySummary && activeDay && (() => {
        const { periodAvg, periodAvgExcl, noResidualReadings, daysWithData, inBand } = dailySummary;
        const lv = activeDay.overall as number | null;
        const st = dayTone(lv);
        const activeOut = activeDay.belowCount + activeDay.aboveCount;
        const deltaVsPeriod = lv != null ? +(lv - periodAvg).toFixed(2) : null;
        const tone = STATUS_TONE[st] ?? STATUS_TONE.missing;
        const delta = activeDayDelta;
        const isInspectingNonLatest = selectedDayKey !== null && selectedDayKey !== dailySummary.latest.dateKey;
        const recent = dailyDays.slice(-14);

        return (
          <div
            className="rounded-xl border border-border/60 bg-muted/20 p-3 flex flex-col lg:flex-row lg:items-center gap-3"
            data-testid="daily-avg-hero"
          >
            <div className="shrink-0 min-w-[195px]">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
                  Daily average · {fmtDay(activeDay.ts)}
                </span>
                {isInspectingNonLatest && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedDayKey(null)}
                    data-testid="reset-day-focus-btn"
                    className="h-5 text-[10px] px-1.5 py-0 text-sky-600 dark:text-sky-400 hover:text-sky-700 inline-flex items-center gap-0.5"
                    title="Reset to latest day"
                  >
                    <RotateCcw className="h-2.5 w-2.5" /> Latest
                  </Button>
                )}
              </div>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className={`text-3xl font-bold font-mono ${tone.text}`} data-testid="daily-avg-latest">
                  {lv != null ? lv.toFixed(2) : '—'}
                </span>
                <span className="text-xs text-muted-foreground">{CHLORINE_CONFIG.unit}</span>
                {lv != null && (st === 'critical_low'
                  ? <Badge variant="destructive" className="text-[10px] px-1 py-0 bg-red-600 text-white">No residual</Badge>
                  : statusBadge(st as ReturnType<typeof classifyChlorineReading>, false))}
              </div>
              {/* A daily mean can sit in range while individual readings are not. Say so. */}
              {lv != null && activeOut > 0 && (
                <div
                  className="mt-1 inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300"
                  data-testid="daily-avg-out-of-range"
                >
                  <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
                  {activeOut} reading{activeOut > 1 ? 's' : ''} out of range
                  {activeDay.min != null && activeDay.max != null && ` (${activeDay.min.toFixed(2)}–${activeDay.max.toFixed(2)})`}
                </div>
              )}
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-1">
                {delta != null && (
                  <span className="inline-flex items-center gap-0.5 font-medium">
                    {delta > 0 ? <TrendingUp className="h-3 w-3" /> : delta < 0 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                    {delta > 0 ? '+' : ''}{delta.toFixed(2)} vs {activeDayPrev ? fmtDay(activeDayPrev.ts) : ''}
                  </span>
                )}
                <span>{activeDay.overallCount} readings</span>
              </div>
              {deltaVsPeriod != null && daysWithData > 1 && (
                <div className="text-[11px] text-muted-foreground mt-0.5" data-testid="daily-avg-vs-period">
                  {deltaVsPeriod > 0 ? '+' : ''}{deltaVsPeriod.toFixed(2)} vs period avg
                </div>
              )}
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Period avg <span className="font-mono font-semibold text-foreground">{periodAvg.toFixed(2)}</span> ·{' '}
                {inBand}/{daysWithData} days in range
              </div>
              {noResidualReadings > 0 && periodAvgExcl != null && (
                <div className="text-[11px] text-rose-600 dark:text-rose-400 mt-0.5" data-testid="period-avg-excl-no-residual">
                  {periodAvgExcl.toFixed(2)} excl. {noResidualReadings} no-residual reading{noResidualReadings > 1 ? 's' : ''}
                </div>
              )}
              {stats.compliancePct != null && (
                <div className="text-[11px] text-muted-foreground mt-0.5" data-testid="readings-compliance">
                  {stats.compliancePct}% of individual readings in range
                </div>
              )}
            </div>
            <div className="flex gap-1.5 overflow-x-auto px-1.5 py-1.5 min-w-0" data-testid="daily-avg-chips">
              {recent.map((d) => {
                const dst = dayTone(d.overall);
                const t = STATUS_TONE[dst] ?? STATUS_TONE.missing;
                const isFocused = activeDay.dateKey === d.dateKey;
                const outN = d.belowCount + d.aboveCount;
                const hiddenExcursion = d.overall != null && dst === 'in_range' && outN > 0;
                return (
                  <button
                    key={d.dateKey}
                    type="button"
                    onClick={() => setSelectedDayKey((prev) => (prev === d.dateKey ? null : d.dateKey))}
                    aria-pressed={isFocused}
                    data-testid={`daily-chip-${d.dateKey}`}
                    className={`shrink-0 w-[58px] rounded-lg border px-1.5 py-1 text-center transition-all cursor-pointer hover:shadow-xs focus:outline-none ${t.border} ${t.bg} ${
                      isFocused
                        ? 'ring-2 ring-sky-500 ring-offset-1 ring-offset-background font-bold shadow-sm'
                        : 'hover:border-foreground/30 opacity-90 hover:opacity-100'
                    }`}
                    aria-label={
                      d.overall == null
                        ? `${fmtDay(d.ts)}: no valid readings`
                        : `${fmtDay(d.ts)}: average ${d.overall.toFixed(2)} mg/L, ${STATUS_WORD[dst]}${outN > 0 ? `, ${outN} individual reading${outN > 1 ? 's' : ''} out of range` : ''}`
                    }
                    title={
                      d.overall == null
                        ? `${fmtDay(d.ts)}: no valid readings`
                        : `${fmtDay(d.ts)}: ${d.overall.toFixed(2)} mg/L (${d.overallCount} readings, ${d.min?.toFixed(2)}–${d.max?.toFixed(2)})${outN > 0 ? `, ${outN} out of range` : ''} - click to inspect`
                    }
                  >
                    <div className="text-[9px] text-muted-foreground">{fmtDay(d.ts)}</div>
                    <div className={`text-sm font-bold font-mono inline-flex items-center justify-center gap-0.5 ${t.text}`}>
                      <StatusGlyph status={dst} />
                      {d.overall == null ? '—' : d.overall.toFixed(2)}
                    </div>
                    {d.overall != null && d.min != null && d.max != null && (
                      <div
                        className={`text-[8px] font-mono leading-tight ${hiddenExcursion ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-muted-foreground'}`}
                        data-testid={`daily-chip-range-${d.dateKey}`}
                      >
                        {d.min.toFixed(1)}–{d.max.toFixed(1)}{hiddenExcursion ? ' !' : ''}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Latest reading per train: position on the fixed 0.3–1.5 band. "Latest in the loaded range", not live. */}
      {latestByTrain.length > 0 && (
        <div className="rounded-xl border border-border/60 bg-muted/20 p-3 space-y-2" data-testid="latest-readings">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
              Latest reading per train
            </span>
            <span className="text-[10px] text-muted-foreground">Band {CHLORINE_CONFIG.min_limit}–{CHLORINE_CONFIG.max_limit} {CHLORINE_CONFIG.unit} · same limit for every train</span>
          </div>
          <div className="space-y-1.5">
            {latestByTrain.map((r) => {
              const tone = dayTone(r.value);
              const t = STATUS_TONE[tone] ?? STATUS_TONE.missing;
              const label = trainMeta.get(r.train_id)?.label ?? r.train_name;
              const color = trainMeta.get(r.train_id)?.color;
              const behind = r.behindMinutes > gapThresholdMinutes;
              const over = r.value > BAR_MAX;
              return (
                <div
                  key={r.train_id}
                  className="grid grid-cols-[minmax(80px,120px)_1fr_auto] items-center gap-3 text-xs"
                  data-testid={`latest-row-${r.train_id}`}
                  role="img"
                  aria-label={`${label}: latest ${r.value.toFixed(2)} ${CHLORINE_CONFIG.unit}, ${STATUS_WORD[tone]}, at ${fmtAxis(r.ts)}`}
                >
                  <span className="flex items-center gap-1.5 truncate font-medium text-foreground">
                    {color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />}
                    <span className="truncate">{label}</span>
                  </span>

                  {/* Flat band bar: green zone = compliance band; marker = latest value */}
                  <div className="relative h-5">
                    <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted" />
                    <div
                      className="absolute top-1/2 h-3 -translate-y-1/2 rounded-sm bg-emerald-500/25 border-x border-emerald-500/60"
                      style={{ left: `${barPct(CHLORINE_CONFIG.min_limit)}%`, width: `${barPct(CHLORINE_CONFIG.max_limit) - barPct(CHLORINE_CONFIG.min_limit)}%` }}
                    />
                    <div
                      className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background ${
                        tone === 'in_range' ? 'bg-emerald-500 h-3 w-3' : tone === 'below_min' ? 'bg-amber-500 h-3.5 w-3.5' : 'bg-rose-500 h-3.5 w-3.5'
                      }`}
                      style={{ left: `${barPct(r.value)}%` }}
                    />
                    <span className="absolute -bottom-2.5 -translate-x-1/2 text-[8px] font-mono text-muted-foreground" style={{ left: `${barPct(CHLORINE_CONFIG.min_limit)}%` }}>{CHLORINE_CONFIG.min_limit}</span>
                    <span className="absolute -bottom-2.5 -translate-x-1/2 text-[8px] font-mono text-muted-foreground" style={{ left: `${barPct(CHLORINE_CONFIG.max_limit)}%` }}>{CHLORINE_CONFIG.max_limit}</span>
                  </div>

                  <div className="text-right leading-tight">
                    <span className={`inline-flex items-center gap-1 font-mono text-sm font-bold ${t.text}`} data-testid={`latest-value-${r.train_id}`}>
                      <StatusGlyph status={tone} />
                      {over && '▲ '}{r.value.toFixed(2)}
                      <span className="text-[10px] font-normal text-muted-foreground">{CHLORINE_CONFIG.unit}</span>
                    </span>
                    <div className="text-[10px] text-muted-foreground font-mono">{fmtAxis(r.ts)}</div>
                  </div>

                  {(behind || r.newerSuspect) && (
                    <div className="col-span-3 -mt-0.5 flex flex-wrap gap-x-3 pl-1 text-[10px]">
                      {behind && (
                        <span className="text-amber-600 dark:text-amber-400" data-testid={`latest-behind-${r.train_id}`}>
                          Trails the newest train reading by {(r.behindMinutes / 60).toFixed(1)}h
                        </span>
                      )}
                      {r.newerSuspect && (
                        <span className="text-rose-600 dark:text-rose-400" data-testid={`latest-suspect-${r.train_id}`}>
                          Newer suspect reading {r.newerSuspect.value.toFixed(2)} ({fmtAxis(new Date(r.newerSuspect.iso).getTime())}) awaiting verification
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* View mode */}
      <div className="flex items-center gap-1.5 bg-muted/60 p-0.5 rounded-lg border border-border/60 text-xs w-fit">
        {([['daily', 'Daily average'], ['readings', 'All readings']] as [ViewMode, string][]).map(([m, label]) => (
          <button
            key={m}
            type="button"
            onClick={() => setViewMode(m)}
            data-testid={`view-mode-${m}`}
            className={`px-2.5 py-1 rounded-md transition-all text-xs font-medium ${
              viewMode === m ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
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
          <button
            type="button"
            onClick={() => setShowOverallAvg((prev) => !prev)}
            data-testid="toggle-overall-avg"
            className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-md text-[11px] font-medium border transition-all ${
              showOverallAvg
                ? 'bg-sky-500/15 border-sky-500/40 text-sky-600 dark:text-sky-400 shadow-xs font-semibold'
                : 'bg-muted/30 border-transparent text-muted-foreground hover:bg-muted/60 opacity-60'
            }`}
          >
            <span className="h-2 w-2 rounded-full bg-sky-400" />
            <span>Overall Daily Avg</span>
          </button>
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

      {/* Main Chart Canvas */}
      <div className={`w-full ${compact ? 'h-[240px]' : 'h-[360px]'} min-w-0 transition-all`}>
        {viewMode === 'daily' ? (
          dailyRows.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2 border border-dashed rounded-xl bg-muted/20">
              <FlaskConical className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm font-medium">
                {filteredRawPoints.length === 0
                  ? 'No Chlorine Residual readings for the selected range'
                  : 'No valid daily averages for the selected range'}
              </p>
              <p className="text-xs text-muted-foreground">
                {filteredRawPoints.length === 0
                  ? 'Operator readings logged under Pretreatment / RO logs will appear here'
                  : 'Readings above 3.0 mg/L are excluded until verified'}
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dailyRows} margin={{ top: 22, right: 16, left: 0, bottom: 6 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} vertical={false} />
                <XAxis
                  dataKey="ts"
                  type="number"
                  scale="time"
                  domain={[(dailyRows[0].ts as number) - HALF_DAY_MS, (dailyRows[dailyRows.length - 1].ts as number) + HALF_DAY_MS]}
                  ticks={dailyRows.length <= 16 ? dailyRows.map((r) => r.ts as number) : undefined}
                  tickFormatter={fmtDay}
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={{ stroke: 'hsl(var(--border))' }}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, dailyYMax]}
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={false}
                  tickLine={false}
                  unit=" mg/L"
                  width={56}
                />
                <ReferenceArea y1={CHLORINE_CONFIG.min_limit} y2={CHLORINE_CONFIG.max_limit} fill="#10b981" fillOpacity={0.08} stroke="#10b981" strokeOpacity={0.25} strokeDasharray="3 3" />
                <ReferenceLine y={CHLORINE_CONFIG.min_limit} stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={1.5} />
                <ReferenceLine y={CHLORINE_CONFIG.max_limit} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1.5} />
                {dailyRows
                  .filter((r) => r.overall == null)
                  .map((r) => (
                    <ReferenceArea
                      key={`nodata-${r.ts}`}
                      x1={(r.ts as number) - HALF_DAY_MS}
                      x2={(r.ts as number) + HALF_DAY_MS}
                      fill="#64748b"
                      fillOpacity={0.14}
                      stroke="#94a3b8"
                      strokeOpacity={0.35}
                      strokeDasharray="2 2"
                    />
                  ))}
                <Tooltip content={<DailyTooltip />} cursor={CHART_CURSOR} />
                {availableTrainEntities
                  .filter((t) => dailyDays.some((d) => d.perTrain[t.id]))
                  .map((t) => (
                    <Line
                      key={t.id}
                      type="linear"
                      dataKey={t.id}
                      name={t.label}
                      stroke={t.color}
                      strokeWidth={1.5}
                      strokeOpacity={0.7}
                      dot={{ r: 2.5, fill: t.color, stroke: '#ffffff', strokeWidth: 1 }}
                      activeDot={{ r: 4 }}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  ))}
                {showOverallAvg && (
                  <Line
                    type="linear"
                    dataKey="overall"
                    name="Overall daily average"
                    stroke="#38bdf8"
                    strokeWidth={3}
                    dot={{ r: 4.5, fill: '#38bdf8', stroke: '#ffffff', strokeWidth: 1.5 }}
                    activeDot={{ r: 6, strokeWidth: 2, stroke: '#ffffff', fill: '#0284c7' }}
                    connectNulls={false}
                    isAnimationActive={false}
                    label={
                      dailyRows.length <= 14
                        ? { position: 'top', fontSize: 10, fontWeight: 600, fill: '#38bdf8', formatter: (v: unknown) => (v == null ? '' : Number(v).toFixed(2)) }
                        : undefined
                    }
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          )
        ) : chartRows.length === 0 ? (
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

              {/* Overall Daily Average Trend Line */}
              {showOverallAvg && (
                <Line
                  type="monotone"
                  dataKey="overall_daily_avg"
                  name="Overall Daily Avg"
                  stroke="#38bdf8"
                  strokeWidth={2.5}
                  strokeDasharray="4 4"
                  dot={{ r: 3, fill: '#38bdf8', stroke: '#ffffff', strokeWidth: 1.5 }}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: '#ffffff', fill: '#0284c7' }}
                  connectNulls
                  isAnimationActive={false}
                />
              )}

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

      {/* KPI & Compliance Chips Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2 text-xs">
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

        <div
          className={`rounded-lg p-2 flex flex-col justify-between border ${
            gapSummary.count > 0 ? 'bg-slate-500/10 border-slate-500/30' : 'bg-muted/40 border-border/60'
          }`}
          data-testid="gap-kpi"
        >
          <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1">
            <Clock className="h-3 w-3" aria-hidden /> Gaps &gt;{gapThresholdMinutes / 60}h
          </span>
          <span className="text-base font-bold font-mono text-foreground mt-0.5">
            {gapSummary.count}
            {gapSummary.count > 0 && (
              <span className="ml-1 text-[10px] font-normal text-muted-foreground">longest {gapSummary.longestHours}h</span>
            )}
          </span>
        </div>

        <div className={`rounded-lg p-2 flex flex-col justify-between border ${
          stats.suspectCount > 0 ? 'bg-red-500/15 border-red-500/40 text-red-600' : 'bg-muted/40 border-border/60 text-muted-foreground'
        }`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wider flex items-center gap-1">
              <ShieldAlert className="h-3 w-3" /> Suspect (&gt;3.0)
            </span>
            {stats.suspectCount > 0 && (
              <button
                type="button"
                onClick={() => handleOpenSuspectReview()}
                data-testid="review-suspect-btn"
                className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-600 hover:text-rose-700 dark:text-rose-400 underline underline-offset-2 cursor-pointer"
              >
                <Edit3 className="h-2.5 w-2.5" /> Review
              </button>
            )}
          </div>
          <span className="text-base font-bold font-mono mt-0.5">
            {stats.suspectCount}
          </span>
        </div>
      </div>

      {/* Detected Missing Data Gaps Notification Bar */}
      {viewMode === 'readings' && gaps.length > 0 && (
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
          <span className="flex items-center gap-1 text-rose-600 dark:text-rose-400">
            <AlertTriangle className="h-2.5 w-2.5" aria-hidden /> No residual (≤{NO_RESIDUAL_MG_L})
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded border border-border/60 bg-muted/30 inline-block" /> No valid data
          </span>
          <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <span className="font-mono text-[9px] font-semibold">min–max !</span> Avg in range, a reading was not
          </span>
          <span className="flex items-center gap-1 text-red-600 dark:text-red-400 font-semibold">
            <span className="h-2.5 w-2.5 rounded-full border border-red-600 inline-flex items-center justify-center text-[7px]">!</span> Suspect (&gt;3.0)
          </span>
          <span className="flex items-center gap-1 text-sky-600 dark:text-sky-400 font-medium">
            <span className="h-0.5 w-3 bg-sky-400 border-b border-dashed inline-block" /> Overall Daily Avg
          </span>
        </div>

        <div className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Info className="h-3 w-3 text-muted-foreground" />
          <span>Gaps span &gt;{gapThresholdMinutes / 60}h without logged readings.</span>
        </div>
      </div>

      {/* Suspect Readings Selection Modal (when multiple suspects exist) */}
      {suspectListOpen && (
        <ResponsiveDialog
          open
          onOpenChange={(o) => { if (!o) setSuspectListOpen(false); }}
          title={`Suspect Chlorine Readings (${suspectPoints.length})`}
          description="Readings exceeding 3.0 mg/L are excluded from compliance calculations until verified or corrected."
          className="max-w-md"
          footer={(
            <Button variant="outline" size="sm" onClick={() => setSuspectListOpen(false)}>
              Close
            </Button>
          )}
        >
          <div className="space-y-2 py-2 max-h-[340px] overflow-y-auto" data-testid="suspect-readings-list">
            {suspectPoints.map((pt) => {
              const val = Number(pt.chlorine_residual_mg_l);
              const name = pt.train_name || trainMeta.get(pt.train_id)?.label || `Train ${pt.train_id.slice(-4)}`;
              const dt = fmtFull(new Date(pt.reading_datetime).getTime());
              return (
                <div
                  key={pt.id || `${pt.train_id}-${pt.reading_datetime}`}
                  className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-red-500/30 bg-red-500/5 text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="font-semibold text-foreground flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-red-500" />
                      <span>{name}</span>
                      <span className="font-mono font-bold text-red-600 dark:text-red-400 ml-1">
                        {val.toFixed(2)} mg/L
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground font-mono">{dt}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-red-500/40 text-red-600 hover:bg-red-500/10 shrink-0"
                    onClick={() => {
                      setSuspectListOpen(false);
                      handleOpenSuspectReview(pt);
                    }}
                  >
                    <Edit3 className="h-3 w-3 mr-1" /> Request Correction
                  </Button>
                </div>
              );
            })}
          </div>
        </ResponsiveDialog>
      )}

      {/* Direct Outlier Correction Request Dialog */}
      {correctionTarget && (
        <CorrectionRequestDialog
          target={correctionTarget}
          onClose={() => setCorrectionTarget(null)}
          onSubmitted={() => setCorrectionTarget(null)}
        />
      )}
    </div>
  );
}
