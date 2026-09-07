import { cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import { RegressionResult } from '../shared';

interface RegressionDetailStatsProps {
  result: RegressionResult;
  outliers: any[];
  gapFillRows: any[];
}

export function RegressionDetailStats({
  result,
  outliers,
  gapFillRows,
}: RegressionDetailStatsProps) {
  const resetCount = outliers.filter(c => c.note?.includes('reset anomaly')).length;
  const olsCount = outliers.length - resetCount;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-6 gap-y-2 sm:gap-y-0 divide-x-0 sm:divide-x text-center px-0 py-2 border-b">
      {[
        { label: 'Rows', value: result.row_count, color: result.truncated ? 'text-warn' : '' },
        { label: 'Resets', value: resetCount, color: resetCount > 0 ? 'text-kpi-solar' : '' },
        { label: 'OLS', value: olsCount, color: olsCount > 0 ? 'text-warn' : '' },
        { label: 'Gaps', value: gapFillRows.length, color: gapFillRows.length > 0 ? 'text-info' : '' },
        { label: 'R²', value: result.r_squared != null ? result.r_squared.toFixed(4) : '—', color: '' },
        { label: 'Run at', value: result.created_at ? format(parseISO(result.created_at), 'MMM d HH:mm') : '—', color: '' },
      ].map(s => (
        <div key={s.label} className="px-3 py-1">
          <div className="text-2xs text-muted-foreground uppercase tracking-wide">{s.label}</div>
          <div className={cn('font-mono text-sm font-semibold', s.color)}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}
