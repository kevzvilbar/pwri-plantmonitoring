import React from 'react';
import { Loader2, Activity, Droplet } from 'lucide-react';
import { fmtNum } from './useEntityChartData';

export interface ChartStatsProps {
  aggregatedLength: number;
  totalConsumption: number;
  avgConsumption: number;
  hasSiblings: boolean;
  siblingsLoading: boolean;
  totalSiblingConsumption: number;
  siblingLocatorsCount: number;
  periodNrw: number | null;
  nrwColor: (v: number) => string;
  ALERTS_NRW_GREEN_MAX: number;
  hasBlending: boolean;
  blendingLoading: boolean;
  totalBlendingVolume: number;
  periodBlendedPct: number | null;
  C_CONSUMPTION: string;
  C_BLEND_VOLUME: string;
  C_BLEND_PCT: string;
}

export function ChartStats({
  aggregatedLength, totalConsumption, avgConsumption,
  hasSiblings, siblingsLoading, totalSiblingConsumption,
  siblingLocatorsCount, periodNrw, nrwColor, ALERTS_NRW_GREEN_MAX,
  hasBlending, blendingLoading, totalBlendingVolume, periodBlendedPct,
  C_CONSUMPTION, C_BLEND_VOLUME, C_BLEND_PCT,
}: ChartStatsProps) {
  return (
    <>
      {aggregatedLength > 0 && (
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="bg-muted/40 rounded-lg p-2 text-center">
            <div className="text-muted-foreground text-2xs uppercase tracking-wide">Readings</div>
            <div className="font-mono font-semibold text-base">{aggregatedLength}</div>
          </div>
          <div className="bg-muted/40 rounded-lg p-2 text-center">
            <div className="text-muted-foreground text-2xs uppercase tracking-wide">Total</div>
            <div className="font-mono font-semibold text-base">{fmtNum(totalConsumption)}</div>
            <div className="text-muted-foreground text-3xs">m³</div>
          </div>
          <div className="bg-muted/40 rounded-lg p-2 text-center">
            <div className="text-muted-foreground text-2xs uppercase tracking-wide">Avg/day</div>
            <div className="font-mono font-semibold text-base">{fmtNum(avgConsumption)}</div>
            <div className="text-muted-foreground text-3xs">m³</div>
          </div>
        </div>
      )}

      {hasSiblings && aggregatedLength > 0 && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-muted/40 rounded-lg p-2 text-center">
            <div className="text-muted-foreground text-2xs uppercase tracking-wide">
              Locators Total {siblingsLoading && <Loader2 className="inline h-2.5 w-2.5 animate-spin ml-0.5" />}
            </div>
            <div className="font-mono font-semibold text-base" style={{ color: C_CONSUMPTION }}>
              {fmtNum(totalSiblingConsumption)}
            </div>
            <div className="text-muted-foreground text-3xs">m³ · {siblingLocatorsCount} locator{siblingLocatorsCount !== 1 ? 's' : ''}</div>
          </div>
          <div className={`rounded-lg p-2 text-center bg-muted/40`}>
            <div className="text-muted-foreground text-2xs uppercase tracking-wide flex items-center justify-center gap-1">
              <Activity className="h-2.5 w-2.5 opacity-60" /> NRW
            </div>
            <div
              className="font-mono font-semibold text-base"
              style={{ color: periodNrw == null ? undefined : `hsl(var(--${nrwColor(periodNrw)}))` }}
            >
              {periodNrw == null ? '—' : periodNrw}
              <span className="text-2xs font-sans text-muted-foreground ml-0.5">%</span>
            </div>
            <div className="text-muted-foreground text-3xs">limit {ALERTS_NRW_GREEN_MAX}%</div>
          </div>
        </div>
      )}

      {hasBlending && aggregatedLength > 0 && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-muted/40 rounded-lg p-2 text-center">
            <div className="text-muted-foreground text-2xs uppercase tracking-wide">
              Blended Total {blendingLoading && <Loader2 className="inline h-2.5 w-2.5 animate-spin ml-0.5" />}
            </div>
            <div className="font-mono font-semibold text-base" style={{ color: C_BLEND_VOLUME }}>
              {fmtNum(totalBlendingVolume)}
            </div>
            <div className="text-muted-foreground text-3xs">m³</div>
          </div>
          <div className="rounded-lg p-2 text-center bg-muted/40">
            <div className="text-muted-foreground text-2xs uppercase tracking-wide flex items-center justify-center gap-1">
              <Droplet className="h-2.5 w-2.5 opacity-60" /> % Blended
            </div>
            <div className="font-mono font-semibold text-base" style={{ color: C_BLEND_PCT }}>
              {periodBlendedPct == null ? '—' : periodBlendedPct}
              <span className="text-2xs font-sans text-muted-foreground ml-0.5">%</span>
            </div>
            <div className="text-muted-foreground text-3xs">of raw output</div>
          </div>
        </div>
      )}
    </>
  );
}
