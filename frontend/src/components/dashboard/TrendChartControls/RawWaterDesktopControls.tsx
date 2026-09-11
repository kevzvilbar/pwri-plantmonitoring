import React from 'react';
import { Button } from '@/components/ui/button';
import { GranularityControl, StackToggle } from '../TrendChartDrill';
import type { Granularity } from '../TrendChartAggregate';
import type { StackMode } from '../TrendChartDrillKit';
import { Filter } from 'lucide-react';

interface RawWaterDesktopControlsProps {
  viewGran: Granularity;
  setViewGran: (g: Granularity) => void;
  rangeDays: number;
  metric: string;
  rawwaterBreakdown: string;
  setRawwaterBreakdown: (b: string) => void;
  selectedWellIds: Set<string> | null;
  setSelectedWellIds: (ids: Set<string> | null) => void;
  showWellFilter: boolean;
  setShowWellFilter: (v: boolean) => void;
  allWellsSelected: boolean;
  wellEntities: any[];
  stackMode: StackMode;
  setStackMode: (m: StackMode) => void;
}

export function RawWaterDesktopControls({
  viewGran, setViewGran, rangeDays, metric,
  rawwaterBreakdown, setRawwaterBreakdown, selectedWellIds, setSelectedWellIds,
  showWellFilter, setShowWellFilter, allWellsSelected, wellEntities,
  stackMode, setStackMode,
}: RawWaterDesktopControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-1 shrink-0 ml-1">
      <span className="text-3xs text-muted-foreground uppercase tracking-wide mr-0.5 hidden sm:inline">View</span>
      <GranularityControl
        value={viewGran}
        onChange={(g) => { setViewGran(g); setSelectedWellIds(null); }}
        rangeDays={rangeDays}
        testIdPrefix={`drill-${metric}`}
      />
      <span className="hidden sm:inline-block h-3 border-l border-border mx-1" aria-hidden />
      <span className="text-3xs text-muted-foreground uppercase tracking-wide mr-0.5 hidden sm:inline">Breakdown</span>
      <button
        onClick={() => { setRawwaterBreakdown('total'); setSelectedWellIds(null); }}
        className={[
          'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none border',
          rawwaterBreakdown === 'total'
            ? 'bg-primary text-primary-foreground border-primary'
            : 'bg-muted text-muted-foreground hover:text-foreground border-border',
        ].join(' ')}
      >Total</button>
      <button
        onClick={() => setRawwaterBreakdown(rawwaterBreakdown === 'by-well' ? 'total' : 'by-well')}
        className={[
          'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none border',
          rawwaterBreakdown === 'by-well'
            ? 'bg-chart-2 text-white border-chart-2'
            : 'bg-muted text-muted-foreground hover:text-foreground border-border',
        ].join(' ')}
      >By well</button>
      {rawwaterBreakdown === 'by-well' && (
        <button
          onClick={() => setShowWellFilter(!showWellFilter)}
          data-testid="drill-filter-rawwater"
          className={[
            'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none flex items-center gap-0.5 border',
            showWellFilter
              ? 'bg-warn text-white border-warn'
              : !allWellsSelected
                ? 'bg-warn-soft text-warn border-warn'
                : 'bg-muted text-muted-foreground hover:text-foreground border-border',
          ].join(' ')}
          title="Filter wells"
          aria-label="Filter wells"
        >
          <Filter className="h-3 w-3" />
          {!allWellsSelected && (
            <span className="font-semibold" aria-hidden>
              {selectedWellIds?.size ?? wellEntities.length}/{wellEntities.length}
            </span>
          )}
        </button>
      )}
      {rawwaterBreakdown === 'by-well' && viewGran !== 'daily' && (
        <>
          <span className="hidden sm:inline-block h-3 border-l border-border mx-1" aria-hidden />
          <StackToggle value={stackMode} onChange={setStackMode} testId="rawwater-stack-toggle" />
        </>
      )}
    </div>
  );
}
