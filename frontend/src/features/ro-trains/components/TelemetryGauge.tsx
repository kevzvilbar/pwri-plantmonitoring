import { ResponsiveContainer, AreaChart, Area, ReferenceLine, ReferenceArea, YAxis } from 'recharts';

export interface TelemetryGaugeProps {
  label: string;
  data: { i: number; v: number }[];
  currentValue?: string;
  unit?: string;
  status?: 'ok' | 'warn' | 'danger';
  band?: { min: number; max: number };
  thresholdMax?: number;
  height?: number;
}

export function TelemetryGauge({
  label,
  data,
  status = 'ok',
  band,
  thresholdMax,
  height = 36,
}: TelemetryGaugeProps) {
  const strokeColor =
    status === 'danger'
      ? 'hsl(var(--danger))'
      : status === 'warn'
      ? 'hsl(var(--warn))'
      : 'hsl(var(--accent))';

  const gradId = `telemetry-gauge-${label.replace(/[^a-zA-Z0-9]/g, '')}-${status}`;

  if (!data || data.length < 2) {
    return (
      <div className="h-7 flex items-center justify-end text-3xs text-muted-foreground/40 font-mono">
        <span>—</span>
      </div>
    );
  }

  const values = data.map((d) => d.v);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const yDomain: [number, number] = [
    band ? Math.min(minVal, band.min - 2) : minVal * 0.95,
    thresholdMax
      ? Math.max(maxVal, thresholdMax * 1.05)
      : band
      ? Math.max(maxVal, band.max + 2)
      : maxVal * 1.05,
  ];

  return (
    <div className="w-full relative shrink-0" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 1, left: 1, bottom: 1 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={strokeColor} stopOpacity={0.35} />
              <stop offset="100%" stopColor={strokeColor} stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <YAxis domain={yDomain} hide />
          {band && (
            <ReferenceArea
              y1={band.min}
              y2={band.max}
              fill="hsl(var(--accent))"
              fillOpacity={0.12}
              stroke="none"
            />
          )}
          {thresholdMax != null && (
            <ReferenceLine
              y={thresholdMax}
              stroke="hsl(var(--danger))"
              strokeDasharray="2 2"
              strokeOpacity={0.6}
            />
          )}
          <Area
            type="monotone"
            dataKey="v"
            stroke={strokeColor}
            strokeWidth={1.5}
            fill={`url(#${gradId})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
