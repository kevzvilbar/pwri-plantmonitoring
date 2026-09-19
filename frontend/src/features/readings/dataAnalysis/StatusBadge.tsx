import { cn } from '@/lib/utils';
import { RegressionResult } from './shared';

export function StatusBadge({ status }: { status: RegressionResult['status'] }) {
  const cfg = {
    pending:   { label: 'Pending',   cls: 'bg-warn-soft text-warn border-warn' },
    applied:   { label: 'Applied',   cls: 'bg-primary-soft  text-primary  border-primary'  },
    retracted: { label: 'Retracted', cls: 'bg-muted     text-muted-foreground border-border' },
  }[status];
  return (
    <span className={cn('inline-flex px-2 py-0.5 rounded text-2xs font-semibold border', cfg.cls)}>
      {cfg.label}
    </span>
  );
}
