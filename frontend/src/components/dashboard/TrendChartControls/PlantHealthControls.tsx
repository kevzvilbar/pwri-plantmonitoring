import React from 'react';
import { Button } from '@/components/ui/button';
import { BarChart2, ChevronsDown, ChevronsUp, Rows3 } from 'lucide-react';
import { isGranularityUsable } from '../TrendChartAggregate';

interface PlantHealthControlsProps {
  phDrillMode: string;
  setPhDrillMode: (m: string) => void;
  setPhDayFocus: (f: string | null) => void;
  rangeDays: number;
  phDayFocus: string | null;
}

export function PlantHealthControls({ phDrillMode, setPhDrillMode, setPhDayFocus, rangeDays, phDayFocus }: PlantHealthControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-1 shrink-0" title="Plant Health granularity">
      <span className="text-3xs text-muted-foreground uppercase tracking-wide mr-0.5 hidden sm:inline">View</span>
      <button
        onClick={() => { setPhDrillMode('daily'); setPhDayFocus(null); }}
        className={[
          'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none flex items-center gap-0.5 border',
          phDrillMode === 'daily'
            ? 'bg-primary text-primary-foreground border-primary'
            : 'bg-muted text-muted-foreground hover:text-foreground border-border',
        ].join(' ')}
        title="Daily average health %"
      >
        <BarChart2 className="h-3 w-3" />
        Daily
      </button>
      <button
        onClick={() => { setPhDrillMode('hourly'); setPhDayFocus(null); }}
        className={[
          'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none flex items-center gap-0.5 border',
          phDrillMode === 'hourly'
            ? 'bg-chart-2 text-white border-chart-2'
            : 'bg-muted text-muted-foreground hover:text-foreground border-border',
        ].join(' ')}
        title={phDayFocus ? 'Showing the drilled-into day — click again for the full range' : 'Hourly health — one slot per hour'}
      >
        <ChevronsDown className="h-3 w-3" />
        Hourly
      </button>
      <button
        onClick={() => { if (isGranularityUsable('weekly', rangeDays)) { setPhDrillMode('weekly'); setPhDayFocus(null); } }}
        disabled={!isGranularityUsable('weekly', rangeDays)}
        className={[
          'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none flex items-center gap-0.5 border',
          !isGranularityUsable('weekly', rangeDays)
            ? 'opacity-40 cursor-not-allowed bg-muted text-muted-foreground border-border'
            : phDrillMode === 'weekly'
              ? 'bg-chart-2 text-white border-chart-2'
              : 'bg-muted text-muted-foreground hover:text-foreground border-border',
        ].join(' ')}
        title="Weekly average health %"
      >
        <Rows3 className="h-3 w-3" />
        Weekly
      </button>
      <button
        onClick={() => { if (isGranularityUsable('monthly', rangeDays)) { setPhDrillMode('monthly'); setPhDayFocus(null); } }}
        disabled={!isGranularityUsable('monthly', rangeDays)}
        className={[
          'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none flex items-center gap-0.5 border',
          !isGranularityUsable('monthly', rangeDays)
            ? 'opacity-40 cursor-not-allowed bg-muted text-muted-foreground border-border'
            : phDrillMode === 'monthly'
              ? 'bg-kpi-ro text-white border-kpi-ro'
              : 'bg-muted text-muted-foreground hover:text-foreground border-border',
        ].join(' ')}
        title="Monthly average health %"
      >
        <ChevronsUp className="h-3 w-3" />
        Monthly
      </button>
    </div>
  );
}
