import React from 'react';
import { GranularityControl, StackToggle } from '../TrendChartDrill';
import type { Granularity } from '../TrendChartAggregate';
import type { StackMode } from '../TrendChartDrillKit';
import { Sun } from 'lucide-react';
import { GridPylonIcon } from '@/components/icons/water-icons';

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
    <div className="flex flex-wrap items-center gap-1 shrink-0 ml-1">
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
    </div>
  );
}
