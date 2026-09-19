import type { DailyRow } from '../types';

interface SparklineProps {
  data: DailyRow[];
  metricKey: string;
  threshold: number;
  comparator: string;
}

export function Sparkline({ data, metricKey, threshold, comparator }: SparklineProps) {
  const values = data
    .slice()
    .reverse()
    .map((r) => ({ date: r.summary_date, val: r[metricKey] ?? null }));

  const nums = values.map((v) => v.val).filter((v) => v !== null) as number[];
  if (nums.length === 0) {
    return <p className="text-xs text-muted-foreground italic">No daily data available.</p>;
  }

  const W = 280;
  const H = 60;
  const PAD = 8;
  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;

  const minVal = Math.min(...nums, comparator === '<' ? threshold : threshold * 0.8);
  const maxVal = Math.max(...nums, comparator === '>' ? threshold : threshold * 1.2);
  const range = maxVal - minVal || 1;

  const toX = (i: number) => PAD + (i / Math.max(values.length - 1, 1)) * innerW;
  const toY = (v: number) => PAD + innerH - ((v - minVal) / range) * innerH;
  const thY = toY(threshold);

  const pts = values
    .map((v, i) => (v.val !== null ? `${toX(i)},${toY(v.val)}` : null))
    .filter(Boolean)
    .join(' ');

  return (
    <div className="mt-2">
      <svg width={W} height={H} className="overflow-visible">
        {/* Threshold line */}
        <line
          x1={PAD} y1={thY} x2={W - PAD} y2={thY}
          stroke="hsl(var(--danger))" strokeWidth="1" strokeDasharray="4 2" opacity="0.7"
        />
        {/* Sparkline */}
        <polyline
          points={pts}
          fill="none"
          stroke="hsl(var(--muted-foreground))"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Dots — red if breaching */}
        {values.map((v, i) => {
          if (v.val === null) return null;
          const breached = comparator === '>' ? v.val > threshold : v.val < threshold;
          return (
            <circle
              key={i}
              cx={toX(i)}
              cy={toY(v.val)}
              r="2.5"
              fill={breached ? 'hsl(var(--danger))' : 'hsl(var(--muted-foreground))'}
            />
          );
        })}
        {/* Threshold label */}
        <text x={W - PAD + 2} y={thY + 3} fontSize="8" fill="hsl(var(--danger))">
          {threshold}
        </text>
      </svg>
      <div className="flex justify-between text-2xs text-muted-foreground mt-0.5 px-[8px]">
        <span>{values[0]?.date?.slice(5)}</span>
        <span>{values[values.length - 1]?.date?.slice(5)}</span>
      </div>
    </div>
  );
}
