import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { DataState } from '@/components/DataState';
import { cn } from '@/lib/utils';
import { OperatorStat } from '../types';

export function OperatorStatsTab() {
  const { data: stats = [], isLoading, error, refetch } = useQuery({
    queryKey: ['operator-error-rates'],
    queryFn: async () => {
      const { data } = await supabase
        .from('operator_error_rates_30d')
        .select('*');
      return (data ?? []) as unknown as OperatorStat[];
    },
    staleTime: 5 * 60_000,
  });

  const rateColor = (pct = 0) =>
    pct >= 20 ? 'text-destructive font-semibold' :
    pct >= 10 ? 'text-warn font-medium' :
    pct >= 5  ? 'text-warn' : 'text-accent';

  const rateBg = (pct = 0) =>
    pct >= 20 ? 'bg-destructive/10' :
    pct >= 10 ? 'bg-warn-soft' : '';

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Rolling 30-day error rate across locator and well readings. Operators at ≥10% are highlighted.</p>
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
                  return (
                    <tr key={s.user_id ?? i} className={cn('border-t', rateBg(errorRate))}>
                      <td className="px-3 py-2.5 font-medium max-w-[180px]">
                        <div className="truncate" title={s.username ? `@${s.username}` : s.operator_email}>
                          {s.username ? `@${s.username}` : (s.operator_email ?? '—')}
                        </div>
                        {errorRate >= 10 && (
                          <div className="text-2xs text-warn mt-0.5">Needs review</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{s.total_entries?.toLocaleString() ?? '—'}</td>
                      <td className="px-3 py-2.5">
                        {(s.backward_readings ?? 0) > 0 ? (
                          <span className="text-destructive font-medium">{s.backward_readings}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {(s.pending_review ?? 0) > 0 ? (
                          <span className="text-warn font-medium">{s.pending_review}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
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