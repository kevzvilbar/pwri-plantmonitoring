import { formatDistanceToNow } from 'date-fns';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataState } from '@/components/DataState';
import { useOperatorStats } from '@/data/hooks/useCorrections';
import { cn } from '@/lib/utils';

export function OperatorStatsTab() {
  const { data: stats = [], isLoading, error, refetch, isFetching } = useOperatorStats();

  const rateColor = (pct = 0) =>
    pct >= 20 ? 'text-destructive font-semibold' :
    pct >= 10 ? 'text-warn font-medium' :
    pct >= 5  ? 'text-warn' : 'text-accent';

  const rateBg = (pct = 0) =>
    pct >= 20 ? 'bg-destructive/10' :
    pct >= 10 ? 'bg-warn-soft' : '';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Rolling 30-day error rate across locator and well readings. Operators at ≥10% are highlighted.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5 shrink-0"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <DataState
        loading={isLoading}
        error={error}
        isEmpty={stats.length === 0}
        emptyTitle="No operator data available yet."
        onRetry={refetch}
      >
        <div className="border rounded-lg overflow-hidden text-xs">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="bg-muted/40">
                <tr>
                  {['Operator (Username)', 'Entries', 'Backward', 'Pending', 'Retracted', 'Error rate', 'Last entry'].map(h => (
                    <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground text-2xs uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.map((s, i) => {
                  const errorRate = s.error_rate_pct ?? (s.total_entries && s.error_count ? (s.error_count / s.total_entries) * 100 : 0);
                  const displayName = s.username
                    ? `@${s.username}`
                    : (s.first_name ? `${s.first_name} ${s.last_name ?? ''}`.trim() : (s.operator_email ?? '—'));

                  return (
                    <tr key={s.user_id ?? i} className={cn('border-t', rateBg(errorRate))}>
                      <td className="px-3 py-2.5 font-medium max-w-[180px]">
                        <div className="truncate" title={displayName}>
                          {displayName}
                        </div>
                        {errorRate >= 10 && (
                          <div className="text-2xs text-warn mt-0.5">Needs review</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground font-mono">{s.total_entries?.toLocaleString() ?? 0}</td>
                      <td className="px-3 py-2.5 font-mono">
                        {(s.backward_readings ?? 0) > 0 ? (
                          <span className="text-destructive font-medium">{s.backward_readings}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-mono">
                        {(s.pending_review ?? 0) > 0 ? (
                          <span className="text-warn font-medium">{s.pending_review}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-mono">
                        {(s.retracted ?? 0) > 0 ? (
                          <span className="text-muted-foreground">{s.retracted}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className={cn('font-mono', rateColor(errorRate))}>
                          {errorRate.toFixed(1)}%
                        </span>
                        <div className="w-full bg-muted rounded-full h-1 mt-1">
                          <div
                            className={cn('h-1 rounded-full', errorRate >= 20 ? 'bg-destructive' : errorRate >= 10 ? 'bg-warn' : 'bg-accent')}
                            style={{ width: `${Math.min(100, errorRate * 3)}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                        {s.last_entry_at
                          ? formatDistanceToNow(new Date(s.last_entry_at), { addSuffix: true })
                          : s.last_error_at
                          ? formatDistanceToNow(new Date(s.last_error_at), { addSuffix: true })
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </DataState>
    </div>
  );
}