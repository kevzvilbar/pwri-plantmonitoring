import React from 'react';
import { GranularityControl } from '../TrendChartDrill';

interface PvDesktopControlsProps {
  viewGran: string;
  setViewGran: (g: string) => void;
  rangeDays: number;
  metric: string;
}

export function PvDesktopControls({ viewGran, setViewGran, rangeDays, metric }: PvDesktopControlsProps) {
  return (
    <div className="flex items-center gap-0.5 shrink-0 ml-1">
      <span className="text-3xs text-muted-foreground uppercase tracking-wide mr-0.5 hidden sm:inline">View</span>
      <GranularityControl value={viewGran} onChange={setViewGran} rangeDays={rangeDays} testIdPrefix={`drill-${metric}`} />
    </div>
  );
}
