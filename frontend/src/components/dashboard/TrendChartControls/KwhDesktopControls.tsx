import React from 'react';
import { Button } from '@/components/ui/button';
import { GranularityControl, StackToggle } from '../TrendChartDrill';
import type { Granularity } from '../TrendChartAggregate';
import type { StackMode } from '../TrendChartDrillKit';
import { Sun } from 'lucide-react';
import { GridPylonIcon } from '@/components/icons/water-icons';
import { Download } from 'lucide-react';
import { toast } from 'sonner';

interface KwhDesktopControlsProps {
  viewGran: Granularity;
  setViewGran: (g: Granularity) => void;
  rangeDays: number;
  kwhSource: string;
  setKwhSource: (s: string) => void;
  stackMode: StackMode;
  setStackMode: (m: StackMode) => void;
  chartData: any[];
  metric: string;
}

export function KwhDesktopControls({
  viewGran, setViewGran, rangeDays, kwhSource, setKwhSource,
  stackMode, setStackMode, chartData, metric,
}: KwhDesktopControlsProps) {
  const hasSolarData = chartData.some((d: any) => (d.solarKwh ?? 0) > 0);
  const hasGridData  = chartData.some((d: any) => (d.kwh ?? 0) > 0);

  if (!hasSolarData && !hasGridData) return null;

  return (
    <div className="flex items-center gap-1 shrink-0 ml-1">
      <GranularityControl value={viewGran} onChange={setViewGran} rangeDays={rangeDays} testIdPrefix={`drill-${metric}`} />
      {hasSolarData && hasGridData && (
        <>
          <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
            {(['both', 'solar', 'grid'] as const).map(s => (
              <button key={s} onClick={() => setKwhSource(s)}
                className={[
                  'px-2 py-0.5 rounded text-2xs font-medium transition-colors inline-flex items-center gap-1',
                  kwhSource === s
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}>
                {s === 'both' ? 'Both' : s === 'solar' ? (
                  <>
                    <Sun className="h-3 w-3" />
                    <span>Solar</span>
                  </>
                ) : (
                  <>
                    <GridPylonIcon className="h-3 w-3" />
                    <span>Grid</span>
                  </>
                )}
              </button>
            ))}
          </div>
          <StackToggle value={stackMode} onChange={setStackMode} testId="kwh-stack-toggle" />
        </>
      )}
      <button
        onClick={() => {
          if (!chartData.length) { toast.error('No data to export'); return; }
          const rows = chartData.map((d: any) =>
            `${d.date},${+(d.solarKwh ?? 0).toFixed(2)},${+(d.kwh ?? 0).toFixed(2)},${+((d.solarKwh ?? 0) + (d.kwh ?? 0)).toFixed(2)}`
          );
          const csv = ['date,solar_kwh,grid_kwh,total_kwh', ...rows].join('\n');
          const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
          const a = document.createElement('a');
          a.href = url; a.download = 'power_energy_mix.csv'; a.click();
          URL.revokeObjectURL(url);
          toast.success('CSV exported');
        }}
        className="h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none flex items-center gap-0.5 border bg-muted text-muted-foreground hover:text-foreground border-border"
        title="Export CSV"
      >
        <Download className="h-3 w-3" />
        <span className="hidden sm:inline">Export</span>
      </button>
    </div>
  );
}
