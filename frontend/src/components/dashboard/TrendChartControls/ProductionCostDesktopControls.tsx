import React from 'react';
import { Button } from '@/components/ui/button';
import { GranularityControl, StackToggle } from '../TrendChartDrill';
import type { Granularity } from '../TrendChartAggregate';
import type { StackMode } from '../TrendChartDrillKit';
import { C_TOTAL_COST, C_POWER_COST, C_CHEM_COST } from '@/lib/chartColors';

interface ProductionCostDesktopControlsProps {
  viewGran: Granularity;
  setViewGran: (g: Granularity) => void;
  rangeDays: number;
  metric: string;
  stackMode: StackMode;
  setStackMode: (m: StackMode) => void;
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
    <div className="flex flex-wrap items-center gap-1 shrink-0 ml-1">
      <GranularityControl value={viewGran} onChange={setViewGran} rangeDays={rangeDays} testIdPrefix={`drill-${metric}`} />
      <span className="hidden sm:inline-block h-3 border-l border-border mx-1" aria-hidden />
      <StackToggle value={stackMode} onChange={setStackMode} testId="cost-stack-toggle" />
      <span className="text-3xs text-muted-foreground mr-0.5 hidden sm:inline ml-1">Show:</span>
      {stackMode !== 'stacked' && (
        <button
          onClick={() => setShowTotalCostLine(!showTotalCostLine)}
          title="Toggle Production Cost (Power + Chem) line"
          style={showTotalCostLine ? { borderColor: C_TOTAL_COST, color: C_TOTAL_COST, backgroundColor: `${C_TOTAL_COST}18` } : undefined}
          className={[
            'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none border',
            showTotalCostLine
              ? 'font-semibold'
              : 'bg-muted text-muted-foreground hover:text-foreground border-border',
          ].join(' ')}
        >Prod</button>
      )}
      <button
        onClick={() => setShowPowerCostLine(!showPowerCostLine)}
        title="Toggle Power Cost (₱/m³) line"
        style={showPowerCostLine ? { borderColor: C_POWER_COST, color: C_POWER_COST, backgroundColor: `${C_POWER_COST}18` } : undefined}
        className={[
          'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none border',
          showPowerCostLine
            ? 'font-semibold'
            : 'bg-muted text-muted-foreground hover:text-foreground border-border',
          ].join(' ')}
      >Power</button>
      <button
        onClick={() => setShowChemCostLine(!showChemCostLine)}
        title="Toggle Chemical Cost (₱/m³) line"
        style={showChemCostLine ? { borderColor: C_CHEM_COST, color: C_CHEM_COST, backgroundColor: `${C_CHEM_COST}18` } : undefined}
        className={[
          'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none border',
          showChemCostLine
            ? 'font-semibold'
            : 'bg-muted text-muted-foreground hover:text-foreground border-border',
        ].join(' ')}
      >Chem</button>
    </div>
  );
}
