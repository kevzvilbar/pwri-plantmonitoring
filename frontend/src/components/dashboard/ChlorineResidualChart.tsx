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
import { format } from 'date-fns';
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

export interface ChlorineReadingInput {
  id?: string;
  train_id?: string;
  reading_datetime?: string;
  chlorine_residual_mg_l?: number | string | null;
  verified?: boolean;
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

  const visibleTrainEntities = useMemo(() => {
    if (activeTrainSet === null) return availableTrainEntities;
    return availableTrainEntities.filter((e) => activeTrainSet.has(e.id));
  }, [availableTrainEntities, activeTrainSet]);

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

  // Transform readings into RawChlorinePoint format
  const rawPoints = useMemo<RawChlorinePoint[]>(() => {
    return roReadings
      .filter((r): r is ChlorineReadingInput & { train_id: string; reading_datetime: string } =>
        Boolean(r.reading_datetime && r.train_id),
      )
      .map((r) => ({
        id: r.id,
        train_id: r.train_id,
        train_name: roTrainNames?.get(r.train_id) || `Train ${r.train_id.slice(-4)}`,
        reading_datetime: r.reading_datetime,
        chlorine_residual_mg_l:
          r.chlorine_residual_mg_l != null ? Number(r.chlorine_residual_mg_l) : null,
        verified: r.verified ?? false,
      }));
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

  // Build chart pivot rows grouped by timestamp
  const { chartRows, maxObservedValue } = useMemo(() => {
    const timestampMap = new Map<
      number,
      {
        timestamp: number;
        label: string;
        isoDatetime: string;
        [trainId: string]: number | string | Map<string, RawChlorinePoint> | undefined;
        _meta?: Map<string, RawChlorinePoint>;
      }
    >();

    let maxVal = 1.5;

    for (const pt of filteredRawPoints) {
      const dt = new Date(pt.reading_datetime);
      const ts = dt.getTime();

      let row = timestampMap.get(ts);
      if (!row) {
        row = {
          timestamp: ts,
          label: format(dt, 'MMM d, HH:mm'),
          isoDatetime: pt.reading_datetime,
          _meta: new Map<string, RawChlorinePoint>(),
        };
        timestampMap.set(ts, row);
      }

      if (pt.chlorine_residual_mg_l != null) {
        const val = pt.chlorine_residual_mg_l;
        row[pt.train_id] = val;
        row._meta!.set(pt.train_id, pt);
        if (val > maxVal) {
          maxVal = val;
        }
      }
    }

    const sortedRows = Array.from(timestampMap.values()).sort(
      (a, b) => a.timestamp - b.timestamp,
    );

    return {
      chartRows: sortedRows,
      maxObservedValue: maxVal,
    };
  }, [filteredRawPoints]);

  // Dynamic Y-axis ceiling: clamp at 3.5 mg/L to avoid squashing the 0.3 - 1.5 band when extreme outliers occur (>3.0)
  const yAxisMax = useMemo(() => {
    if (maxObservedValue <= 2.0) return 2.0;
    if (maxObservedValue <= 3.5) return +(maxObservedValue + 0.3).toFixed(1);
    return 3.5; // Cap at 3.5 to keep compliance band clearly legible
  }, [maxObservedValue]);

  interface CustomDotProps {
    cx?: number;
    cy?: number;
    value?: number | null;
    payload?: { _meta?: Map<string, RawChlorinePoint> };
    dataKey?: string;
    stroke?: string;
  }

  // Custom Dot Renderer
  const renderCustomDot = useCallback(
    (props: CustomDotProps): React.ReactElement => {
      const { cx, cy, value, dataKey } = props;
      if (value == null || isNaN(value) || cx == null || cy == null) {
        return <circle cx={cx || 0} cy={cy || 0} r={0} opacity={0} key={`dot-empty-${dataKey}-${cx}-${cy}`} />;
      }

      const isSuspect = value > CHLORINE_CONFIG.suspect_threshold;
      const isBelowMin = value < CHLORINE_CONFIG.min_limit;
      const isAboveMax = value > CHLORINE_CONFIG.max_limit && !isSuspect;

      if (isSuspect) {
        return (
          <g key={`dot-suspect-${dataKey}-${cx}-${cy}`}>
            <circle cx={cx} cy={cy} r={6} fill="none" stroke="#e11d48" strokeWidth={2.5} strokeDasharray="2 2" />
            <circle cx={cx} cy={cy} r={3} fill="#e11d48" />
          </g>
        );
      }

      if (isBelowMin) {
        return (
          <g key={`dot-low-${dataKey}-${cx}-${cy}`}>
            <circle cx={cx} cy={cy} r={4.5} fill="#f59e0b" stroke="#ffffff" strokeWidth={1.5} />
          </g>
        );
      }

      if (isAboveMax) {
        return (
          <g key={`dot-high-${dataKey}-${cx}-${cy}`}>
            <circle cx={cx} cy={cy} r={4.5} fill="#ef4444" stroke="#ffffff" strokeWidth={1.5} />
          </g>
        );
      }

      return (
        <circle
          key={`dot-ok-${dataKey}-${cx}-${cy}`}
          cx={cx}
          cy={cy}
          r={3}
          fill={props.stroke || '#10b981'}
          stroke="#ffffff"
          strokeWidth={1}
        />
      );
    },
    [],
  );

  interface TooltipEntry {
    value?: number | string | null;
    name?: string;
    color?: string;
    dataKey?: string;
    payload?: { isoDatetime?: string };
  }

  interface CustomTooltipProps {
    active?: boolean;
    payload?: TooltipEntry[];
    label?: string;
  }

  // Custom Tooltip
  const CustomTooltip = ({ active, payload, label }: CustomTooltipProps) => {
    if (!active || !payload || !payload.length) return null;

    const row = payload[0]?.payload;
    const dtStr = row?.isoDatetime ? format(new Date(row.isoDatetime), 'MMM d, yyyy · HH:mm:ss') : label;

    return (
      <div style={INSTRUMENT_TOOLTIP_STYLE} className="p-3 min-w-[220px] max-w-[320px] space-y-2 text-xs">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-1.5 font-medium text-foreground">
          <div className="flex items-center gap-1.5">
            <FlaskConical className="h-3.5 w-3.5 text-emerald-500" />
            <span>Chlorine Residual</span>
          </div>
          <span className="text-[10px] text-muted-foreground font-mono">{dtStr}</span>
        </div>

        <div className="space-y-1.5">
          {payload.map((entry) => {
            if (entry.value == null) return null;
            const val = +entry.value;
            const status = classifyChlorineReading(val, CHLORINE_CONFIG);

            let statusBadge = (
              <Badge variant="outline" className="text-[10px] px-1 py-0 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10">
                In Range
              </Badge>
            );

            if (status === 'below_min') {
              statusBadge = (
                <Badge variant="outline" className="text-[10px] px-1 py-0 border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10">
                  Below 0.3
                </Badge>
              );
            } else if (status === 'above_max') {
              statusBadge = (
                <Badge variant="outline" className="text-[10px] px-1 py-0 border-rose-500/40 text-rose-600 dark:text-rose-400 bg-rose-500/10">
                  Above 1.5
                </Badge>
              );
            } else if (status === 'suspect') {
              statusBadge = (
                <Badge variant="destructive" className="text-[10px] px-1 py-0 bg-red-600 text-white animate-pulse">
                  Suspect (&gt;3.0)
                </Badge>
              );
            }

            return (
              <div key={entry.dataKey} className="flex items-center justify-between gap-2 py-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
                  <span className="font-medium text-muted-foreground">{entry.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-foreground">
                    {val.toFixed(2)} {CHLORINE_CONFIG.unit}
                  </span>
                  {statusBadge}
                </div>
              </div>
            );
          })}
        </div>

        {/* Warning if any suspect value is present */}
        {payload.some((entry) => entry.value != null && +entry.value > CHLORINE_CONFIG.suspect_threshold) && (
          <div className="mt-2 pt-1.5 border-t border-destructive/20 text-[10px] text-destructive flex items-center gap-1">
            <ShieldAlert className="h-3 w-3 shrink-0" />
            <span>Outlier readings &gt; 3.0 mg/L excluded from compliance calculations.</span>
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
                dataKey="label"
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

              {/* Render Detected Gaps as grey ReferenceAreas */}
              {gaps.map((gap, idx) => {
                const startLabel = format(new Date(gap.start_iso), 'MMM d, HH:mm');
                const endLabel = format(new Date(gap.end_iso), 'MMM d, HH:mm');
                return (
                  <ReferenceArea
                    key={`gap-${idx}`}
                    x1={startLabel}
                    x2={endLabel}
                    fill="#64748b"
                    fillOpacity={0.12}
                    stroke="#94a3b8"
                    strokeOpacity={0.3}
                    strokeDasharray="2 2"
                  />
                );
              })}

              <Tooltip content={<CustomTooltip />} cursor={CHART_CURSOR} />

              {/* Series per active RO Train */}
              {visibleTrainEntities.map(({ id, label, color }) => (
                <Line
                  key={id}
                  type="monotone"
                  dataKey={id}
                  name={label}
                  stroke={color}
                  strokeWidth={2}
                  dot={renderCustomDot}
                  activeDot={{ r: 5, strokeWidth: 1.5, stroke: '#ffffff' }}
                  connectNulls={false} // Breaks line across gaps
                  isAnimationActive={false}
                />
              ))}
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
