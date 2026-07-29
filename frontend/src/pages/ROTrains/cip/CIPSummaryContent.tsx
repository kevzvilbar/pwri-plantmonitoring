import { fmtNum } from '@/lib/calculations';
import { cn } from '@/lib/utils';

// ─── CIPSummaryContent ── lifted out of CIPLog to avoid remount on every render ─
export function CIPSummaryContent({
  liveCost,
  totalMassKg,
  totalVolumeL,
  comparisonPct,
}: {
  liveCost: number;
  totalMassKg: number;
  totalVolumeL: number;
  comparisonPct: string | null;
}) {
  return (
    <>
      <div>
        <p className="text-3xs text-primary-foreground/70 uppercase tracking-wide font-medium">Total Chemical Cost:</p>
        <p className="text-xl font-bold font-mono-num leading-tight">₱ {fmtNum(liveCost, 2)}</p>
      </div>
      <div>
        <p className="text-3xs text-primary-foreground/70 uppercase tracking-wide font-medium">Total Dosed Mass:</p>
        <p className="text-sm font-semibold font-mono-num">{fmtNum(totalMassKg, 3)} kg</p>
      </div>
      <div>
        <p className="text-3xs text-primary-foreground/70 uppercase tracking-wide font-medium">Total Dosed Volume:</p>
        <p className="text-sm font-semibold font-mono-num">{fmtNum(totalVolumeL, 2)} L</p>
      </div>
      {comparisonPct != null && (
        <div>
          <p className="text-3xs text-primary-foreground/70 uppercase tracking-wide font-medium">vs Last CIP:</p>
          <p className={cn('text-sm font-semibold', +comparisonPct <= 0 ? 'text-accent' : 'text-warn')}>
            {+comparisonPct > 0 ? '+' : ''}{comparisonPct}% Chemical Use
          </p>
        </div>
      )}
    </>
  );
}
