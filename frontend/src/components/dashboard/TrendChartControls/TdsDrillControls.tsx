import React from 'react';
import { Button } from '@/components/ui/button';
import { GranularityControl, StackToggle } from '../TrendChartDrill';
import type { Granularity } from '../TrendChartAggregate';
import type { StackMode } from '../TrendChartDrillKit';
import { ChevronsDown, Filter } from 'lucide-react';

interface TdsDrillControlsProps {
  viewGran: Granularity;
  setViewGran: (g: Granularity) => void;
  rangeDays: number;
  metric: string;
  roDrillMode: string;
  setRoDrillMode: (m: string) => void;
  showTrainFilter: boolean;
  setShowTrainFilter: (v: boolean) => void;
  allTrainsSelected: boolean;
  noTrainsSelected: boolean;
  roTrainEntities: any[];
  selectedTrainIds: Set<string> | null;
  stackMode: StackMode;
  setStackMode: (m: StackMode) => void;
  selectAllTrains: () => void;
  clearAllTrains: () => void;
  toggleTrain: (id: string) => void;
}

export function TdsDrillControls({
  viewGran, setViewGran, rangeDays, metric,
  roDrillMode, setRoDrillMode, showTrainFilter, setShowTrainFilter,
  allTrainsSelected, noTrainsSelected, roTrainEntities, selectedTrainIds,
  stackMode, setStackMode, selectAllTrains, clearAllTrains, toggleTrain,
}: TdsDrillControlsProps) {
  // Chlorine "Hourly" is always per RO train (trains are never combined), so Breakdown is locked to "By train".
  const hourlyPerTrain = metric === 'chlorine' && roDrillMode === 'by-hour';
  return (
    <div className="flex flex-wrap items-center gap-1 shrink-0">
      <span className="text-3xs text-muted-foreground uppercase tracking-wide mr-0.5 hidden sm:inline">View</span>
      <GranularityControl
        value={roDrillMode === 'by-hour' ? 'daily' : viewGran}
        onChange={(g) => {
          setViewGran(g);
          if (roDrillMode === 'by-hour') setRoDrillMode('default');
          setShowTrainFilter(false);
        }}
        rangeDays={rangeDays}
        testIdPrefix={`drill-${metric}`}
      />
      <button
        onClick={() => setRoDrillMode(roDrillMode === 'by-hour' ? 'default' : 'by-hour')}
        className={[
          'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none flex items-center gap-0.5 border',
          roDrillMode === 'by-hour'
            ? 'bg-kpi-ro text-white border-kpi-ro'
            : 'bg-muted text-muted-foreground hover:text-foreground border-border',
        ].join(' ')}
        title="Hourly average across date range"
      >Hourly</button>

      <span className="hidden sm:inline-block h-3 border-l border-border mx-1" aria-hidden />
      <span className="text-3xs text-muted-foreground uppercase tracking-wide mr-0.5 hidden sm:inline">Breakdown</span>
      <button
        onClick={() => { if (roDrillMode === 'by-train') { setRoDrillMode('default'); setShowTrainFilter(false); } }}
        disabled={hourlyPerTrain}
        data-testid={`drill-${metric}-breakdown-total`}
        className={[
          'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none border',
          hourlyPerTrain
            ? 'bg-muted text-muted-foreground/50 border-border cursor-not-allowed'
            : roDrillMode !== 'by-train'
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-muted text-muted-foreground hover:text-foreground border-border',
        ].join(' ')}
        title={hourlyPerTrain ? 'Hourly is always shown per RO train, trains are not combined' : 'Fleet average (all trains combined)'}
      >Total</button>
      <button
        onClick={() => { if (!hourlyPerTrain) setRoDrillMode(roDrillMode === 'by-train' ? 'default' : 'by-train'); }}
        disabled={hourlyPerTrain}
        aria-pressed={roDrillMode === 'by-train' || hourlyPerTrain}
        data-testid={`drill-${metric}-breakdown-by-train`}
        className={[
          'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none border flex items-center gap-0.5',
          roDrillMode === 'by-train' || hourlyPerTrain
            ? 'bg-chart-2 text-white border-chart-2'
            : 'bg-muted text-muted-foreground hover:text-foreground border-border',
          hourlyPerTrain ? 'cursor-default' : '',
        ].join(' ')}
        title={hourlyPerTrain ? 'Hourly is always shown per RO train' : 'Daily average per RO train'}
      >
        <ChevronsDown className="h-3 w-3" />
        By train
      </button>

      {roDrillMode !== 'default' && (
        <button
          onClick={() => setShowTrainFilter(!showTrainFilter)}
          className={[
            'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none flex items-center gap-0.5 border',
            showTrainFilter
              ? 'bg-warn text-white border-warn'
              : !allTrainsSelected
                ? 'bg-warn-soft text-warn border-warn'
                : 'bg-muted text-muted-foreground hover:text-foreground border-border',
          ].join(' ')}
          title="Filter trains"
          aria-label={!allTrainsSelected
            ? `Filter trains — ${selectedTrainIds?.size ?? roTrainEntities.length} of ${roTrainEntities.length} selected`
            : 'Filter trains'}
        >
          <Filter className="h-3 w-3" />
          {!allTrainsSelected && (
            <span className="font-semibold" aria-hidden>
              {selectedTrainIds?.size ?? roTrainEntities.length}/{roTrainEntities.length}
            </span>
          )}
        </button>
      )}

      {roDrillMode === 'by-train' && viewGran !== 'daily' && (
        <>
          <span className="hidden sm:inline-block h-3 border-l border-border mx-1" aria-hidden />
          <StackToggle value={stackMode} onChange={setStackMode} testId="ro-train-stack-toggle" />
        </>
      )}
    </div>
  );
}
