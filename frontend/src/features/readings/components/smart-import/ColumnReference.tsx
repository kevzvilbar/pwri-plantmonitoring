import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Download, Info } from 'lucide-react';
import type { ImportTypeConfig } from './types';
import { downloadTemplate } from './registry';

interface ColumnReferenceProps {
  config: ImportTypeConfig;
  plantId?: string;
  plants?: Array<{ id: string; name: string }>;
}

export function ColumnReference({ config, plantId, plants }: ColumnReferenceProps) {
  return (
    <div className="rounded-lg border bg-muted/30 overflow-hidden border-border/70">
      <div className="px-3.5 py-2 border-b bg-muted/50 flex items-center justify-between">
        <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          Expected CSV Schema Columns ({config.columns.length})
        </span>
        <button
          onClick={() => downloadTemplate(config, plantId, plants)}
          className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline transition-colors"
        >
          <Download className="h-3 w-3" /> Download Template (.csv)
        </button>
      </div>
      <div className="divide-y divide-border/40">
        {config.columns.map(col => (
          <div key={col.key} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/20">
            <code className="text-2xs font-mono bg-background border rounded px-1.5 py-px shrink-0 whitespace-nowrap leading-tight">
              {col.key}
            </code>
            <span className="text-xs font-medium flex-1 min-w-0 truncate leading-tight" title={col.label}>
              {col.label}
            </span>
            <span className="flex items-center gap-1 shrink-0">
              {col.required && (
                <Badge variant="outline" className="text-3xs px-1 py-0 h-4 border-danger/60 text-danger leading-none">
                  required
                </Badge>
              )}
              <Badge variant="outline" className="text-3xs px-1 py-0 h-4 text-muted-foreground leading-none">
                {col.type}
              </Badge>
              {col.hint && (
                <span className="text-3xs text-muted-foreground/60 italic hidden sm:inline max-w-[120px] truncate" title={col.hint}>
                  {col.hint}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
      {config.entityTable && (
        <div className="flex items-start gap-2 px-3 py-2 border-t bg-warn-soft/60">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-warn" />
          <p className="text-2xs text-warn">
            <span className="font-semibold">{config.entityNameKey?.replace(/_/g, ' ')}</span> is matched by name to existing{' '}
            {config.entityTable} in the selected plant facility.
          </p>
        </div>
      )}
    </div>
  );
}
