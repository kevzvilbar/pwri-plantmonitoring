import { format } from 'date-fns';
import { DataState } from '@/components/DataState';
import { cn } from '@/lib/utils';
import { SourceTable, tableLabel, fmtNum } from '../types';
import { useEditHistory } from '@/data/hooks/useCorrections';

export function EditHistoryTab() {
  const { data: rows = [], isLoading, error, refetch } = useEditHistory(200);

  const actionBadge = (action: string) => {
    const cfg: Record<string, string> = {
      normalize: 'bg-primary-soft text-primary',
      retract:   'bg-muted text-muted-foreground',
      tag:       'bg-warn-soft text-warn',
    };
    return <span className={cn('text-2xs px-1.5 py-0.5 rounded font-medium', cfg[action] ?? 'bg-muted text-muted-foreground')}>{action}</span>;
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Last 200 normalization actions across all tables.</p>
      <DataState
        loading={isLoading}
        error={error}
        isEmpty={rows.length === 0}
        emptyTitle="No normalization history yet."
        onRetry={refetch}
      >
        <div className="border rounded-lg overflow-hidden text-xs">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="bg-muted/40">
                <tr>
                  {['Date', 'Table', 'Action', 'Original', 'Adjusted', 'Note', 'By'].map(h => (
                    <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground text-2xs uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-t hover:bg-muted/20">
                    <td className="px-3 py-2 font-mono whitespace-nowrap">
                      {r.performed_at ? format(new Date(r.performed_at), 'dd MMM yy HH:mm') : '—'}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                      {tableLabel[r.source_table as SourceTable] ?? r.source_table}
                    </td>
                    <td className="px-3 py-2">{actionBadge(r.action)}</td>
                    <td className="px-3 py-2 font-mono text-right">{fmtNum(r.original_value)}</td>
                    <td className="px-3 py-2 font-mono text-right">{fmtNum(r.adjusted_value)}</td>
                    <td className="px-3 py-2 text-muted-foreground max-w-[160px] truncate" title={r.note ?? undefined}>
                      {r.note ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{r.performed_role ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </DataState>
    </div>
  );
}