import { type NormStatus } from '@/lib/regressionCorrection';
import { cn } from '@/lib/utils';

export function NormBadge({ status }: { status?: NormStatus }) {
  if (!status || status === 'normal') return null;
  const cfg: Record<string, { emoji: string; cls: string }> = {
    erroneous:  { emoji: '⚠️', cls: 'border-warn text-warn bg-warn-soft' },
    normalized: { emoji: '🔄', cls: 'border-primary  text-primary  bg-primary-soft '  },
    retracted:  { emoji: '⏪', cls: 'border-border    text-muted-foreground bg-muted'                    },
  };
  const c = cfg[status];
  if (!c) return null;
  return (
    <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-medium border', c.cls)}>
      {c.emoji} {status}
    </span>
  );
}
