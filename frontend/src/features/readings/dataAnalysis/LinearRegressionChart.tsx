import { type CorrectionRow } from '@/lib/regressionCorrection';
import { TrendingUp } from 'lucide-react';

// ── Linear Regression Mini-Chart ───────────────────────────────────────────────

export function LinearRegressionChart({
  corrections,
  slope,
  intercept,
  rSquared,
}: {
  corrections: CorrectionRow[];
  slope: number | null;
  intercept: number | null;
  rSquared: number | null;
}) {
  const valid = corrections.filter(c => c.original_value != null);
  if (valid.length < 3 || slope == null || intercept == null) return null;

  const W = 480, H = 108, PX = 8, PY = 10;

  const ys      = valid.map(c => c.original_value!);
  const corrYs  = valid.filter(c => c.corrected_value != null).map(c => c.corrected_value!);
  const allVals = [...ys, ...corrYs,
    slope * 0 + intercept,
    slope * (valid.length - 1) + intercept,
  ];
  const minY   = Math.min(...allVals);
  const maxY   = Math.max(...allVals);
  const rangeY = maxY - minY || 1;
  const n      = valid.length;

  const toX = (i: number) => PX + (i / Math.max(n - 1, 1)) * (W - 2 * PX);
  const toY = (v: number) => PY + (1 - (v - minY) / rangeY) * (H - 2 * PY);

  const regY0 = slope * 0 + intercept;
  const regYN = slope * (n - 1) + intercept;

  return (
    <div className="rounded border bg-card overflow-hidden">
      <div className="text-2xs text-muted-foreground px-3 pt-2 pb-0 font-semibold uppercase tracking-wide flex items-center justify-between">
        <span className="flex items-center gap-1"><TrendingUp className="h-3 w-3 text-primary" /> Linear Regression Fit</span>
        {rSquared != null && (
          <span className="font-mono text-2xs">R² = <span className="text-primary font-bold">{rSquared.toFixed(4)}</span></span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="w-full" style={{ height: 90 }}>
        {/* Gridlines */}
        {[0.25, 0.5, 0.75].map(t => (
          <line key={t}
            x1={PX} y1={PY + t * (H - 2 * PY)}
            x2={W - PX} y2={PY + t * (H - 2 * PY)}
            stroke="currentColor" strokeWidth={0.4} opacity={0.12}
          />
        ))}
        {/* OLS regression line */}
        <line
          x1={toX(0)} y1={toY(regY0)}
          x2={toX(n - 1)} y2={toY(regYN)}
          stroke="hsl(var(--primary))" strokeWidth={1.8}
          strokeDasharray="6 3" opacity={0.85}
        />
        {/* Normal data points */}
        {valid.map((c, i) =>
          !c.is_outlier ? (
            <circle key={c.reading_id}
              cx={toX(i)} cy={toY(c.original_value!)}
              r={2} fill="currentColor" opacity={0.35}
            />
          ) : null
        )}
        {/* Outlier + correction pairs */}
        {valid.map((c, i) =>
          c.is_outlier ? (
            <g key={c.reading_id}>
              {c.corrected_value != null && (
                <line
                  x1={toX(i)} y1={toY(c.original_value!)}
                  x2={toX(i)} y2={toY(c.corrected_value)}
                  stroke="hsl(var(--danger))" strokeWidth={1} opacity={0.4} strokeDasharray="2 1"
                />
              )}
              <circle cx={toX(i)} cy={toY(c.original_value!)} r={4} fill="hsl(var(--danger))" opacity={0.85} />
              {c.corrected_value != null && (
                <circle cx={toX(i)} cy={toY(c.corrected_value)} r={3.5} fill="hsl(var(--primary))" stroke="white" strokeWidth={1.2} />
              )}
            </g>
          ) : null
        )}
      </svg>
      <div className="flex items-center gap-4 px-3 pb-2 text-2xs text-muted-foreground border-t mt-0 pt-1.5">
        <span className="flex items-center gap-1.5">
          <svg width="14" height="6"><line x1="0" y1="3" x2="14" y2="3" stroke="hsl(var(--primary))" strokeWidth="1.5" strokeDasharray="5 3"/></svg>
          OLS line (slope={slope.toFixed(3)}/day)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full inline-block bg-danger opacity-85" /> Outlier
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full inline-block bg-accent" /> Corrected
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full inline-block bg-current opacity-35" /> Normal
        </span>
      </div>
    </div>
  );
}

