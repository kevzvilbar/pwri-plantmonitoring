import { useState, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowRight } from 'lucide-react';
import { SourceTable, tableLabel, fmtNum, fmtDt } from '../types';

export interface RecentCorrection {
  key: string;
  label: string;
  plantName: string;
  sourceTable: SourceTable;
  oldValue: number;
  newValue: number;
  correctedAt: string;
}

export function useRecentCorrections() {
  const [items, setItems] = useState<RecentCorrection[]>([]);
  const add = useCallback((c: Omit<RecentCorrection, 'key' | 'correctedAt'>) => {
    if (c.oldValue === c.newValue) return;
    setItems(prev => [
      { ...c, key: `${c.sourceTable}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, correctedAt: new Date().toISOString() },
      ...prev,
    ].slice(0, 8));
  }, []);
  const clear = useCallback(() => setItems([]), []);
  return { items, add, clear };
}

export function RecentCorrectionsPanel({ items, onClear }: { items: RecentCorrection[]; onClear: () => void }) {
  if (!items.length) return null;
  return (
    <div className="space-y-2 pb-1">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <p className="text-xs font-bold text-foreground uppercase tracking-wide">Just Corrected</p>
          <Badge variant="outline" className="text-3xs px-2 py-0 font-bold border-accent/40 bg-background">
            this session
          </Badge>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-2xs text-muted-foreground hover:text-foreground underline underline-offset-2"
        >
          Clear
        </button>
      </div>
      <div className="grid gap-2">
        {items.map(c => (
          <Card key={c.key} className="p-3 border-accent/30 bg-accent-soft/30">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <span className="text-xs font-semibold truncate">{c.label}</span>
                <Badge variant="outline" className="text-2xs px-1.5 py-0">{c.plantName}</Badge>
                <Badge variant="outline" className="text-2xs px-1.5 py-0">{tableLabel[c.sourceTable]}</Badge>
              </div>
              <span className="text-3xs text-muted-foreground whitespace-nowrap">{fmtDt(c.correctedAt)}</span>
            </div>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap text-xs">
              <span className="text-3xs uppercase font-bold text-muted-foreground tracking-wider">Corrected value</span>
              <span className="font-mono font-medium text-destructive line-through decoration-destructive/60">{fmtNum(c.oldValue)}</span>
              <ArrowRight className="h-3 w-3 text-accent shrink-0" />
              <span className="text-3xs uppercase font-bold text-muted-foreground tracking-wider">New value</span>
              <span className="font-mono font-bold text-accent">{fmtNum(c.newValue)}</span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}