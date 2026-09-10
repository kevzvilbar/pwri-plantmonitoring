import React from 'react';
import { Button } from '@/components/ui/button';
import { GranularityControl, StackToggle } from '../TrendChartDrill';
import type { Granularity } from '../TrendChartAggregate';
import type { StackMode } from '../TrendChartDrillKit';
import { Filter } from 'lucide-react';

interface ProductionDrillControlsProps {
  metric: string;
  viewGran: Granularity;
  setViewGran: (g: Granularity) => void;
  rangeDays: number;
  viewBreakdown: string;
  setViewBreakdown: (b: string) => void;
  selectedLocatorIds: Set<string> | null;
  setSelectedLocatorIds: (ids: Set<string> | null) => void;
  showLocatorFilter: boolean;
  setShowLocatorFilter: (v: boolean) => void;
  allSelected: boolean;
  noneSelected: boolean;
  drillEntities: any[];
  usePermeateForSource: boolean;
  stackMode: StackMode;
  setStackMode: (m: StackMode) => void;
  selectAllLocators: () => void;
  clearAllLocators: () => void;
  toggleLocator: (id: string) => void;
}

export function ProductionDrillControls({
  metric, viewGran, setViewGran, rangeDays,
  viewBreakdown, setViewBreakdown, selectedLocatorIds, setSelectedLocatorIds,
  showLocatorFilter, setShowLocatorFilter, allSelected, noneSelected,
  drillEntities, usePermeateForSource, stackMode, setStackMode,
  selectAllLocators, clearAllLocators, toggleLocator,
}: ProductionDrillControlsProps) {
  return (
    <div className="flex items-center gap-0.5 shrink-0">
      <span className="text-3xs text-muted-foreground uppercase tracking-wide mr-0.5 hidden sm:inline">View</span>
      <GranularityControl
        value={viewGran}
        onChange={(g) => { setViewGran(g); setSelectedLocatorIds(null); setShowLocatorFilter(false); }}
        rangeDays={rangeDays}
        testIdPrefix={`drill-${metric}`}
      />
      <span className="hidden sm:inline-block h-3 border-l border-border mx-1" aria-hidden />
      <span className="text-3xs text-muted-foreground uppercase tracking-wide mr-0.5 hidden sm:inline">Breakdown</span>
      <button
        onClick={() => { setViewBreakdown('total'); setSelectedLocatorIds(null); setShowLocatorFilter(false); }}
        data-testid={`drill-total-${metric}`}
        className={[
          'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none border',
          viewBreakdown === 'total'
            ? 'bg-primary text-primary-foreground border-primary'
            : 'bg-muted text-muted-foreground hover:text-foreground border-border',
        ].join(' ')}
        title="Combined total"
      >Total</button>
      <button
        onClick={() => { setViewBreakdown('by-locator'); setSelectedLocatorIds(null); }}
        data-testid={`drill-by-locator-${metric}`}
        className={[
          'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none border',
          viewBreakdown === 'by-locator'
            ? 'bg-chart-2 text-white border-chart-2'
            : 'bg-muted text-muted-foreground hover:text-foreground border-border',
        ].join(' ')}
        title="Break down by distribution locator"
      >By locator</button>
      {metric === 'production' && (
        <button
          onClick={() => { setViewBreakdown('by-source'); setSelectedLocatorIds(null); }}
          data-testid={`drill-by-source-${metric}`}
          className={[
            'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none border',
            viewBreakdown === 'by-source'
              ? 'bg-chart-2 text-white border-chart-2'
              : 'bg-muted text-muted-foreground hover:text-foreground border-border',
          ].join(' ')}
          title={usePermeateForSource ? 'Break down by RO Train permeate' : 'Break down by product meter'}
        >By source</button>
      )}

      {viewBreakdown !== 'total' && (
        <button
          onClick={() => setShowLocatorFilter(!showLocatorFilter)}
          data-testid={`drill-filter-${metric}`}
          className={[
            'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none flex items-center gap-0.5 border',
            showLocatorFilter
              ? 'bg-warn text-white border-warn'
              : !allSelected
                ? 'bg-warn-soft text-warn border-warn'
                : 'bg-muted text-muted-foreground hover:text-foreground border-border',
          ].join(' ')}
          title="Filter locators"
          aria-label={!allSelected
            ? `Filter locators — ${selectedLocatorIds?.size ?? drillEntities.length} of ${drillEntities.length} selected`
            : 'Filter locators'}
        >
          <Filter className="h-3 w-3" />
          {!allSelected && (
            <span className="font-semibold" aria-hidden>
              {selectedLocatorIds?.size ?? drillEntities.length}/{drillEntities.length}
            </span>
          )}
        </button>
      )}

      {(viewBreakdown === 'total' ? metric === 'nrw' : viewGran !== 'daily') && (
        <>
          <span className="hidden sm:inline-block h-3 border-l border-border mx-1" aria-hidden />
          <StackToggle value={stackMode} onChange={setStackMode} testId={`${metric}-stack-toggle`} />
        </>
      )}
    </div>
  );
}
