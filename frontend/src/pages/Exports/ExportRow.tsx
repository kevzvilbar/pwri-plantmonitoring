import { useState, useCallback } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { ExportTable } from './constants';
import { runExport } from './engine';

function ExportRow({
  table,
  plantId,
  from,
  to,
  isSelected,
  onToggleSelect,
}: {
  table: ExportTable;
  plantId: string;
  from: string;
  to: string;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'empty'>('idle');
  const [count, setCount] = useState<number | null>(null);

  const doExport = useCallback(async () => {
    setState('busy');
    try {
      const res = await runExport(table, plantId, from, to);
      if (!res) {
        setState('empty');
        toast.info(`No rows found in ${table.label}`);
        setTimeout(() => setState('idle'), 2500);
      } else {
        setCount(res.count);
        setState('done');
        toast.success(`Exported ${res.count.toLocaleString()} rows from ${table.label}`);
        setTimeout(() => setState('idle'), 3000);
      }
    } catch (e) {
      setState('idle');
      toast.error(friendlyError(e));
    }
  }, [table, plantId, from, to]);

  return (
    <div className={cn(
      'flex items-center gap-3 py-2 px-3 hover:bg-muted/30 rounded-md transition-colors group',
      isSelected && 'bg-primary/5',
    )}>
      <Checkbox
        checked={isSelected}
        onCheckedChange={() => onToggleSelect(table.id)}
        className="h-4 w-4 shrink-0"
        aria-label={`Select ${table.label}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-semibold text-foreground leading-tight">{table.label}</span>
          {state === 'done' && count !== null && (
            <Badge variant="outline" className="text-3xs px-1.5 h-4 text-accent border-accent py-0">
              {count.toLocaleString()} rows
            </Badge>
          )}
          {table.noPlantFilter && (
            <Badge variant="outline" className="text-3xs px-1.5 h-4 text-muted-foreground py-0">global</Badge>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <code className="text-3xs font-mono text-muted-foreground/70">{table.id}</code>
          <span className="text-2xs text-muted-foreground hidden sm:block truncate">{table.description}</span>
        </div>
      </div>
      <Button
        onClick={doExport}
        variant="outline"
        size="sm"
        disabled={state === 'busy'}
        className={cn(
          'shrink-0 h-7 px-2.5 text-xs gap-1.5 transition-colors font-semibold',
          state === 'done' && 'border-accent text-accent',
          state === 'empty' && 'text-muted-foreground',
        )}
      >
        {state === 'busy' ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : state === 'done' ? (
          <CheckCircle2 className="h-3 w-3" />
        ) : (
          <Download className="h-3 w-3" />
        )}
        {state === 'busy' ? 'Exporting…' : state === 'done' ? 'Done' : state === 'empty' ? 'No data' : 'CSV'}
      </Button>
    </div>
  );
}

export { ExportRow };
