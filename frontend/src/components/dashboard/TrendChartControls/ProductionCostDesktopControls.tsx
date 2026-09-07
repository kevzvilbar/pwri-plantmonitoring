import React from 'react';
import { Button } from '@/components/ui/button';
import { GranularityControl, StackToggle } from '../TrendChartDrill';

interface ProductionCostDesktopControlsProps {
  viewGran: string;
  setViewGran: (g: string) => void;
  rangeDays: number;
  metric: string;
  stackMode: string;
  setStackMode: (m: string) => void;
  showTotalCostLine: boolean;
  setShowTotalCostLine: (v: boolean) => void;
  showPowerCostLine: boolean;
  setShowPowerCostLine: (v: boolean) => void;
  showChemCostLine: boolean;
  setShowChemCostLine: (v: boolean) => void;
}

export function ProductionCostDesktopControls({
  viewGran, setViewGran, rangeDays, metric, stackMode, setStackMode,
  showTotalCostLine, setShowTotalCostLine, showPowerCostLine, setShowPowerCostLine,
  showChemCostLine, setShowChemCostLine,
}: ProductionCostDesktopControlsProps) {
  return (
    <div className="flex items-center gap-0.5 shrink-0 ml-1">
      <GranularityControl value={viewGran} onChange={setViewGran} rangeDays={rangeDays} testIdPrefix={`drill-${metric}`} />
      <span className="hidden sm:inline-block h-3 border-l border-border mx-1" aria-hidden />
      <StackToggle value={stackMode} onChange={setStackMode} testId="cost-stack-toggle" />
      <span className="text-3xs text-muted-foreground mr-0.5 hidden sm:inline ml-1">Show:</span>
      {stackMode !== 'stacked' && (
        <button
          onClick={() => setShowTotalCostLine((v) => !v)}
          title="Toggle Production Cost (Power + Chem) line"
          className={[
            'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none border',
            showTotalCostLine
              ? 'bg-accent text-accent-foreground border-accent'
              : 'bg-muted text-muted-foreground hover:text-foreground border-border',
          ].join(' ')}
        >Prod</button>
      )}
      <button
        onClick={() => setShowPowerCostLine((v) => !v)}
        title="Toggle Power Cost (₱/m³) line"
        className={[
          'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none border',
          showPowerCostLine
            ? 'border-[hsl(var(--chart-6))] text-[hsl(var(--chart-6))] bg-[hsl(var(--chart-6))]/10'
            : 'bg-muted text-muted-foreground hover:text-foreground border-border',
        ].join(' ')}
      >Power</button>
      <button
        onClick={() => setShowChemCostLine((v) => !v)}
        title="Toggle Chemical Cost (₱/m³) line"
        className={[
          'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none border',
          showChemCostLine
            ? 'border-[hsl(var(--highlight))] text-[hsl(var(--highlight))] bg-[hsl(var(--highlight))]/10'
            : 'bg-muted text-muted-foreground hover:text-foreground border-border',
        ].join(' ')}
      >Chem</button>
    </div>
  );
}
