import { cn } from '@/lib/utils';
import { fmtNum } from '../types';

export function DeltaBadge({ vol }: { vol: number | null }) {
  if (vol == null) return <span className="text-muted-foreground">—</span>;
  const isNeg = vol < 0;
  return (
    <span
      className={cn(
        'font-mono text-xs font-semibold',
        isNeg
          ? 'bg-destructive/15 text-destructive border border-destructive/30 px-1.5 py-0.5 rounded inline-flex items-center gap-0.5'
          : vol > 0
            ? 'text-accent'
            : 'text-muted-foreground'
      )}
    >
      {vol >= 0 ? '+' : ''}
      {fmtNum(vol)} m³
    </span>
  );
}