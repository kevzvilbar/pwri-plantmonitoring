import { cn } from '@/lib/utils';
import { CheckCircle2, XCircle } from 'lucide-react';
import type { ParsedRow, ImportTypeConfig } from './types';

interface PreviewTableProps {
  rows: ParsedRow[];
  config: ImportTypeConfig;
  filterMode: 'all' | 'valid' | 'errors';
}

export function PreviewTable({ rows, config, filterMode }: PreviewTableProps) {
  const visibleCols = config.columns.slice(0, 6);
  const displayRows = rows.filter(r => {
    if (filterMode === 'valid') return r.valid;
    if (filterMode === 'errors') return !r.valid;
    return true;
  });

  return (
    <div className="rounded-lg border overflow-hidden border-border/70">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/50 border-b text-muted-foreground">
              <th className="w-8 px-2.5 py-2 text-left font-semibold">#</th>
              {visibleCols.map(c => (
                <th key={c.key} className="px-2.5 py-2 text-left font-semibold whitespace-nowrap">
                  {c.label}
                </th>
              ))}
              <th className="px-2.5 py-2 text-left font-semibold">Validation</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {displayRows.slice(0, 50).map(row => (
              <tr
                key={row.rowIndex}
                className={cn(
                  'transition-colors',
                  row.valid ? 'hover:bg-muted/20' : 'bg-danger-soft/40',
                )}
              >
                <td className="px-2.5 py-1.5 text-muted-foreground tabular-nums">{row.rowIndex + 1}</td>
                {visibleCols.map(c => (
                  <td key={c.key} className="px-2.5 py-1.5 max-w-[140px] truncate" title={row.data[c.key]}>
                    {row.data[c.key] || <span className="text-muted-foreground/40">—</span>}
                  </td>
                ))}
                <td className="px-2.5 py-1.5 whitespace-nowrap">
                  {row.valid ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-accent">
                      <CheckCircle2 className="h-3 w-3" /> Valid
                    </span>
                  ) : (
                    <span
                      className="inline-flex items-center gap-1 font-semibold text-danger cursor-help"
                      title={row.errors.join('; ')}
                    >
                      <XCircle className="h-3 w-3" />
                      {row.errors.length} error{row.errors.length > 1 ? 's' : ''} ({row.errors[0]})
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {displayRows.length > 50 && (
        <div className="px-3 py-2 border-t bg-muted/30 text-xs text-muted-foreground">
          Showing first 50 of {displayRows.length} rows in view
        </div>
      )}
    </div>
  );
}
