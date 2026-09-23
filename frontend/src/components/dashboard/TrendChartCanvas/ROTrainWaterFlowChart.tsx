import React from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import { CHART_CURSOR } from './chartShell';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

interface ROTrainWaterFlowChartProps {
  trendRows: any[];
  formatYAxis: (v: number) => string;
}

/**
 * Custom Permeate Bar with centered Feed hairline and mass balance error indicator.
 */
function PermeateBarWithHairline(props: any) {
  const { x, y, width, height, payload } = props;
  if (!payload || width <= 0) return null;

  const cx = x + width / 2;
  const yZero = y + height;
  const permVal = Math.max(0, payload.permeate ?? 0);
  const rejVal = Math.max(0, payload.reject ?? 0);
  const feedVal = Math.max(0, payload.feed ?? 0);
  const hasDeviation = Boolean(payload.hasDeviation);
  const variance = payload.variance ?? (feedVal - (permVal + rejVal));

  // Determine vertical scale (pixels per m3)
  const pxPerM3 = permVal > 0 && height > 0 ? height / permVal : 0;

  // Expected feed aligns with total combined height (permeate + reject)
  // If feed is metered, compute hairline top offset
  const diff = feedVal > 0 ? feedVal - (permVal + rejVal) : 0;
  const yFeedTop = pxPerM3 > 0 ? y - (diff * pxPerM3) : y;

  const barRadius = Math.min(3, width / 4);

  return (
    <g className="ro-permeate-bar-group">
      {/* Upper Bar: Permeate (extends upwards from yZero) */}
      {height > 0 && (
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          rx={barRadius}
          ry={barRadius}
          fill="url(#permeateFlowGrad)"
          stroke="#06b6d4"
          strokeOpacity={0.6}
          strokeWidth={1}
        />
      )}

      {/* Thin Vertical Hairline: Feed Water Indicator (Upper / Permeate Section) */}
      {(feedVal > 0 || permVal > 0 || rejVal > 0) && (
        <>
          <line
            x1={cx}
            y1={Math.min(y, yFeedTop)}
            x2={cx}
            y2={yZero}
            stroke={hasDeviation ? '#fca5a5' : '#e2e8f0'}
            strokeWidth={1.5}
            strokeDasharray={hasDeviation ? '2 2' : 'none'}
            opacity={0.9}
          />

          {/* Hairline Center Baseline Anchor */}
          <circle cx={cx} cy={yZero} r={1.75} fill="#94a3b8" />

          {/* Hairline Top Crosshair / Cap */}
          <line
            x1={cx - 3.5}
            y1={yFeedTop}
            x2={cx + 3.5}
            y2={yFeedTop}
            stroke={hasDeviation ? '#ef4444' : '#f8fafc'}
            strokeWidth={2}
            strokeLinecap="round"
          />

          {/* Discrepancy Indicator: Red square marker and offset line */}
          {hasDeviation && (
            <g className="ro-discrepancy-marker">
              <circle
                cx={cx}
                cy={yFeedTop}
                r={6}
                fill="#ef4444"
                fillOpacity={0.25}
              />
              <rect
                x={cx - 3.5}
                y={yFeedTop - 3.5}
                width={7}
                height={7}
                fill="#ef4444"
                stroke="#ffffff"
                strokeWidth={1.5}
                rx={1}
              />
              {/* Offset indicator connecting feed level to bar edge */}
              <line
                x1={cx}
                y1={yFeedTop}
                x2={cx + width / 2 + 4}
                y2={yFeedTop}
                stroke="#ef4444"
                strokeWidth={1.2}
                strokeDasharray="2 2"
              />
              {/* Alert icon badge above bar */}
              <text
                x={cx}
                y={Math.min(y, yFeedTop) - 6}
                textAnchor="middle"
                fill="#ef4444"
                fontSize={9}
                fontWeight="bold"
              >
                !
              </text>
            </g>
          )}
        </>
      )}
    </g>
  );
}

/**
 * Custom Reject Bar (lower diverging bar extending downwards from 0)
 * with visible vertical Feed hairline across the reject section.
 */
function RejectBarShape(props: any) {
  const { x, y, width, height, payload } = props;
  if (!payload || width <= 0 || height === 0) return null;

  // Recharts' Bar.getComposedData computes geometry as:
  //   y = yAxis.scale(value[1])
  //   height = yAxis.scale(value[0]) - yAxis.scale(value[1])
  // Normalize to a top-left corner + positive height before drawing.
  const rectY = height >= 0 ? y : y + height;
  const rectHeight = Math.abs(height);
  const cx = x + width / 2;
  const yZero = rectY;
  const yRejBottom = rectY + rectHeight;
  const barRadius = Math.min(3, width / 4);
  const hasDeviation = Boolean(payload.hasDeviation);
  const rejVal = Math.max(0, payload.reject ?? 0);

  return (
    <g className="ro-reject-bar-group">
      <rect
        x={x}
        y={rectY}
        width={width}
        height={rectHeight}
        rx={barRadius}
        ry={barRadius}
        fill="url(#rejectFlowGrad)"
        stroke="#f43f5e"
        strokeOpacity={0.7}
        strokeWidth={1}
      />

      {/* Hairline on Reject: Thin vertical hairline in the center of the reject section */}
      {rejVal > 0 && rectHeight > 0 && (
        <>
          <line
            x1={cx}
            y1={yZero}
            x2={cx}
            y2={yRejBottom}
            stroke={hasDeviation ? '#fca5a5' : '#e2e8f0'}
            strokeWidth={1.5}
            strokeDasharray={hasDeviation ? '2 2' : 'none'}
            opacity={0.95}
          />

          {/* Bottom terminal crossbar on reject */}
          <line
            x1={cx - 3.5}
            y1={yRejBottom}
            x2={cx + 3.5}
            y2={yRejBottom}
            stroke={hasDeviation ? '#ef4444' : '#f8fafc'}
            strokeWidth={2}
            strokeLinecap="round"
          />

          {/* Center Baseline Anchor Dot */}
          <circle cx={cx} cy={yZero} r={1.5} fill="#94a3b8" />
        </>
      )}
    </g>
  );
}

/**
 * Instrument Panel Tooltip for RO Train Water Flow Balance.
 */
function ROTrainFlowTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  const permVal = +(row.permeate ?? 0).toFixed(1);
  const rejVal = +(row.reject ?? 0).toFixed(1);
  const feedVal = +(row.feed ?? 0).toFixed(1);
  const expectedFeed = +(permVal + rejVal).toFixed(1);
  const diff = +(feedVal - expectedFeed).toFixed(1);
  const hasDeviation = Boolean(row.hasDeviation);
  const variancePct = row.variancePct ?? (feedVal > 0 ? +((diff / feedVal) * 100).toFixed(1) : 0);

  const recoveryPct = feedVal > 0
    ? ((permVal / feedVal) * 100).toFixed(1)
    : expectedFeed > 0
      ? ((permVal / expectedFeed) * 100).toFixed(1)
      : null;

  return (
    <div
      style={{
        background: 'hsl(var(--card))',
        border: '1px solid hsl(var(--border))',
        borderRadius: 10,
        fontSize: 11,
        padding: '10px 14px',
        minWidth: 190,
        maxWidth: 320,
        boxShadow: 'var(--shadow-elev)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2 mb-2">
        <p className="font-bold text-xs text-foreground tracking-tight m-0">{label}</p>
        {hasDeviation ? (
          <span className="inline-flex items-center gap-1 text-2xs font-semibold text-rose-500 bg-rose-500/10 border border-rose-500/25 px-1.5 py-0.5 rounded">
            <AlertTriangle className="w-3 h-3" />
            Mismatch
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-2xs font-semibold text-emerald-500 bg-emerald-500/10 border border-emerald-500/25 px-1.5 py-0.5 rounded">
            <CheckCircle2 className="w-3 h-3" />
            Balanced
          </span>
        )}
      </div>

      <div className="space-y-1 text-xs">
        <div className="flex justify-between items-center text-cyan-400 font-medium">
          <span className="font-bold tracking-wide">PERMEATE:</span>
          <span className="font-bold font-mono">+{permVal.toLocaleString()} m³</span>
        </div>

        <div className="flex justify-between items-center text-rose-400 font-medium">
          <span className="font-bold tracking-wide">REJECT WATER:</span>
          <span className="font-bold font-mono">−{rejVal.toLocaleString()} m³</span>
        </div>

        <div className="flex justify-between items-center text-slate-300 font-medium pt-1 border-t border-border/40">
          <span>FEED WATER (Hairline):</span>
          <span className="font-bold font-mono text-foreground">{feedVal > 0 ? `${feedVal.toLocaleString()} m³` : '—'}</span>
        </div>

        <div className="flex justify-between items-center text-muted-foreground text-2xs">
          <span>EXPECTED (Perm + Rej):</span>
          <span className="font-mono">{expectedFeed.toLocaleString()} m³</span>
        </div>

        {hasDeviation && (
          <div className="mt-1.5 pt-1.5 border-t border-rose-500/30 flex justify-between items-center text-rose-400 text-2xs font-semibold">
            <span>Discrepancy:</span>
            <span className="font-mono font-bold">
              {diff > 0 ? `+${diff}` : `${diff}`} m³ ({variancePct > 0 ? `+${variancePct}` : `${variancePct}`}%)
            </span>
          </div>
        )}

        {recoveryPct && (
          <div className="flex justify-between items-center text-muted-foreground text-2xs pt-1">
            <span>Calculated Recovery:</span>
            <span className="font-semibold text-foreground font-mono">{recoveryPct}%</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function ROTrainWaterFlowChart({
  trendRows,
  formatYAxis,
}: ROTrainWaterFlowChartProps) {
  // Pre-process trendRows to ensure reject values are strictly negative for downward diverging bars
  // and compute tight, robust vertical headroom for maximum bar resolution.
  const { chartData, yDomain } = React.useMemo(() => {
    const rows = (trendRows ?? []).map((row) => ({
      ...row,
      permeate: Math.max(0, row.permeate ?? 0),
      rejectNeg: -Math.abs(row.reject ?? 0),
    }));

    let maxPermeate = 0;
    let maxReject = 0;
    for (const r of rows) {
      if (r.permeate > maxPermeate) maxPermeate = r.permeate;
      const rej = Math.abs(r.reject ?? 0);
      if (rej > maxReject) maxReject = rej;
    }

    if (maxPermeate === 0 && maxReject === 0) {
      return { chartData: rows, yDomain: [-1000, 1000] as [number, number] };
    }

    // Add clean 12% headroom so feed hairlines and markers breathe without excessive empty space
    const topLimit = Math.ceil((maxPermeate * 1.12) / 1000) * 1000;
    const botLimit = -Math.ceil((maxReject * 1.12) / 1000) * 1000;

    return {
      chartData: rows,
      yDomain: [botLimit, topLimit] as [number, number],
    };
  }, [trendRows]);

  return (
    <div className="relative w-full h-full flex flex-col">
      {/* Chart Legend Header */}
      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-2xs mb-1 px-1 text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-xs bg-gradient-to-t from-sky-600 to-cyan-400 inline-block shadow-xs" />
          <span className="font-bold text-xs tracking-wider text-cyan-400">PERMEATE</span>
          <span className="text-2xs text-muted-foreground">Permeate (+)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-xs bg-gradient-to-t from-orange-600 to-rose-500 inline-block shadow-xs" />
          <span className="font-bold text-xs tracking-wider text-rose-400">REJECT WATER</span>
          <span className="text-2xs text-muted-foreground">Reject (−)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 bg-slate-200 inline-block rounded-full" />
          <span className="font-medium text-slate-300">Feed Hairline</span>
        </div>
        <div className="flex items-center gap-1.5 text-rose-400">
          <span className="w-2 h-2 rounded-xs bg-rose-500 border border-white inline-block shadow-xs" />
          <span className="font-medium">Mismatch Marker</span>
        </div>
      </div>

      <div className="flex-1 w-full min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            stackOffset="sign"
            margin={{ top: 8, right: 8, left: -10, bottom: 2 }}
          >
            <defs>
              <linearGradient id="permeateFlowGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.95} />
                <stop offset="100%" stopColor="#0284c7" stopOpacity={0.8} />
              </linearGradient>

              <linearGradient id="rejectFlowGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.85} />
                <stop offset="100%" stopColor="#ea580c" stopOpacity={0.95} />
              </linearGradient>
            </defs>

            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(var(--border))"
              vertical={false}
              strokeOpacity={0.5}
            />

            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fontWeight: 500 }}
              stroke="hsl(var(--muted-foreground))"
              axisLine={false}
              tickLine={false}
            />

            <YAxis
              domain={yDomain}
              tick={{ fontSize: 10 }}
              stroke="hsl(var(--muted-foreground))"
              tickFormatter={(v: number) => formatYAxis(Math.abs(v))}
              width={42}
              axisLine={false}
              tickLine={false}
            />

            <ReferenceLine
              y={0}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="3 3"
              strokeWidth={1.5}
              strokeOpacity={0.7}
            />

            <Tooltip
              content={<ROTrainFlowTooltip />}
              cursor={CHART_CURSOR}
            />

            {/* Upper Permeate Bar with Centered Feed Hairline & Mismatch Indicator */}
            <Bar
              dataKey="permeate"
              name="Permeate (m³)"
              stackId="roFlow"
              maxBarSize={48}
              shape={<PermeateBarWithHairline />}
            />

            {/* Lower Diverging Reject Bar */}
            <Bar
              dataKey="rejectNeg"
              name="Reject (m³)"
              stackId="roFlow"
              maxBarSize={48}
              shape={<RejectBarShape />}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

