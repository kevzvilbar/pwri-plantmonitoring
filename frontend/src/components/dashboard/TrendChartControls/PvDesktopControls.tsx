import React from 'react';
import { GranularityControl } from '../TrendChartDrill';
import type { Granularity } from '../TrendChartAggregate';

interface PvDesktopControlsProps {
  viewGran: Granularity;
  setViewGran: (g: Granularity) => void;
  rangeDays: number;
  metric: string;
}

export function PvDesktopControls({ viewGran, setViewGran, rangeDays, metric }: PvDesktopControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-1 shrink-0 ml-1">
      <span className="text-3xs text-muted-foreground uppercase tracking-wide mr-0.5 hidden sm:inline">View</span>
      <GranularityControl value={viewGran} onChange={setViewGran} rangeDays={rangeDays} testIdPrefix={`drill-${metric}`} />
    </div>
  );
}
