import React from 'react';
import { Button } from '@/components/ui/button';
import { GranularityControl, StackToggle } from '../TrendChartDrill';
import { ChevronsDown, Filter } from 'lucide-react';

interface TdsDrillControlsProps {
  viewGran: string;
  setViewGran: (g: string) => void;
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
  stackMode: string;
  setStackMode: (m: string) => void;
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
  return (
    <div className="flex items-center gap-0.5 shrink-0">
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
        className={[
          'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none border',
          roDrillMode !== 'by-train'
            ? 'bg-primary text-primary-foreground border-primary'
            : 'bg-muted text-muted-foreground hover:text-foreground border-border',
        ].join(' ')}
        title="Fleet average (all trains combined)"
      >Total</button>
      <button
        onClick={() => setRoDrillMode(roDrillMode === 'by-train' ? 'default' : 'by-train')}
        className={[
          'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none border flex items-center gap-0.5',
          roDrillMode === 'by-train'
            ? 'bg-chart-2 text-white border-chart-2'
            : 'bg-muted text-muted-foreground hover:text-foreground border-border',
        ].join(' ')}
        title="Daily average per RO train"
      >
        <ChevronsDown className="h-3 w-3" />
        By train
      </button>

      {roDrillMode !== 'default' && (
        <button
          onClick={() => setShowTrainFilter((v) => !v)}
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
