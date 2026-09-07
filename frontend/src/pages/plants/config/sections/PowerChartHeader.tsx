import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, TrendingUp } from 'lucide-react';
import { fmtNum } from '@/lib/calculations';
import { toast } from 'sonner';

type Range = '30' | '90' | '180' | 'all';
type Source = 'both' | 'solar' | 'grid';

interface PowerChartHeaderProps {
  range: Range;
  onRangeChange: (r: Range) => void;
  source: Source;
  onSourceChange: (s: Source) => void;
  hasSolar: boolean;
  hasGrid: boolean;
  rows: { date: string; solar: number; grid: number }[];
  plantId: string;
  rangeLabel: string;
}

export function PowerChartHeader({
  range, onRangeChange, source, onSourceChange,
  hasSolar, hasGrid, rows, plantId, rangeLabel,
}: PowerChartHeaderProps) {
  const exportCSV = () => {
    if (!rows.length) { toast.error('No data to export'); return; }
    const blob = new Blob(
      [['date,solar_kwh,grid_kwh,total_kwh', ...rows.map(r => `${r.date},${r.solar},${r.grid},${+(r.solar + r.grid).toFixed(2)}`)].join('\n')],
      { type: 'text/csv' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `power_energy_mix_${plantId}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported');
  };

  return (
    <div className="flex items-start justify-between gap-2 flex-wrap">
      <div>
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-primary-soft text-primary flex items-center justify-center shrink-0">
            <TrendingUp className="h-4 w-4" />
          </div>
          <span className="text-sm font-bold text-foreground">Power Consumption &amp; Energy Mix</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 pl-9">
          {rangeLabel} · daily totals · Solar vs Grid (kWh)
        </p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-0.5 bg-muted/80 p-0.5 rounded-lg border border-border/60">
          {(['30','90','180','all'] as const).map(r => (
            <button key={r} onClick={() => onRangeChange(r)}
              className={`px-2.5 py-1 rounded-md text-2xs font-bold transition-all ${
                range === r ? 'bg-card text-foreground shadow-2xs border border-border/80' : 'text-muted-foreground hover:text-foreground'
              }`}>
              {r === 'all' ? 'All' : `${r}d`}
            </button>
          ))}
        </div>
        {hasSolar && hasGrid && (
          <div className="flex items-center gap-0.5 bg-muted/80 p-0.5 rounded-lg border border-border/60">
            {(['both','solar','grid'] as const).map(s => (
              <button key={s} onClick={() => onSourceChange(s)}
                className={`px-2.5 py-1 rounded-md text-2xs font-bold capitalize transition-all ${
                  source === s ? 'bg-primary text-primary-foreground shadow-2xs' : 'text-muted-foreground hover:text-foreground'
                }`}>
                {s === 'both' ? 'Both' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        )}
        <Button size="sm" variant="outline" className="h-8 px-2.5 text-xs gap-1.5 rounded-lg" onClick={exportCSV}>
          <Download className="h-3.5 w-3.5" /><span className="hidden sm:inline">Export</span>
        </Button>
      </div>
    </div>
  );
}
