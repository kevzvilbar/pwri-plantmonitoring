import { useState, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, Loader2, CheckCircle2, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { ExportCategory, ExportTable } from './constants';
import { runExport } from './engine';
import { ALL_TABLES } from './constants';
import { ExportRow } from './ExportRow';

function CategorySection({
  category,
  plantId,
  from,
  to,
  defaultOpen,
  selectedTableIds,
  onToggleSelect,
}: {
  category: ExportCategory;
  plantId: string;
  from: string;
  to: string;
  defaultOpen: boolean;
  selectedTableIds: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [bulkState, setBulkState] = useState<'idle' | 'busy' | 'done'>('idle');
  const Icon = category.icon;

  const exportAll = useCallback(async () => {
    setBulkState('busy');
    let total = 0;
    const errors: string[] = [];
    for (const table of category.tables) {
      try {
        const res = await runExport(table, plantId, from, to);
        if (res) total += res.count;
      } catch (e: any) {
        errors.push(`${table.label}: ${e.message}`);
      }
    }
    setBulkState('done');
    if (errors.length) {
      toast.info(`${category.label}: ${errors.length} table(s) failed`);
    } else {
      toast.success(`${category.label}: exported ${total.toLocaleString()} rows across ${category.tables.length} tables`);
    }
    setTimeout(() => setBulkState('idle'), 3000);
  }, [category, plantId, from, to]);

  return (
    <Card className="overflow-hidden border-border/70">
      {/* Category header — clickable to expand/collapse */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-3.5 py-2.5 hover:bg-muted/30 transition-colors text-left"
      >
        <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', category.accent)}>
          <Icon className={cn('h-4 w-4', category.color)} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold">{category.label}</span>
            <Badge variant="outline" className="text-3xs py-0 h-4 font-normal text-muted-foreground">
              {category.tables.length} table{category.tables.length !== 1 ? 's' : ''}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          {/* Export all in category */}
          <div onClick={e => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground font-semibold"
              disabled={bulkState === 'busy'}
              onClick={exportAll}
            >
              {bulkState === 'busy' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : bulkState === 'done' ? (
                <CheckCircle2 className="h-3 w-3 text-accent" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              {bulkState === 'busy' ? 'Exporting…' : bulkState === 'done' ? 'Done' : 'Export category'}
            </Button>
          </div>
          <ChevronDown className={cn(
            'h-3.5 w-3.5 text-muted-foreground/60 transition-transform duration-150 shrink-0',
            open && 'rotate-180',
          )} />
        </div>
      </button>

      {/* Table rows */}
      {open && (
        <div className="border-t divide-y divide-border/40 px-1 py-1">
          {category.tables.map(t => (
            <ExportRow
              key={t.id}
              table={t}
              plantId={plantId}
              from={from}
              to={to}
              isSelected={selectedTableIds.has(t.id)}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

export { CategorySection };
