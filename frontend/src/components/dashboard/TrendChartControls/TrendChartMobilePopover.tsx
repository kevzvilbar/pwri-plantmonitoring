import React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { GranularityControl, StackToggle } from '../TrendChartDrill';
import { isGranularityUsable, type Granularity } from '../TrendChartAggregate';
import type { StackMode } from '../TrendChartDrillKit';
import { MoreVertical, ChevronsDown, ChevronsUp, Download, Filter, Check, Search, X } from 'lucide-react';
import { GridPylonIcon } from '@/components/icons/water-icons';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface TrendChartMobilePopoverProps {
  metric: string;
  rangeDays: number;
  hasConsumptionDrill: boolean;
  hasRoDrill: boolean;
  hasPlantHealth: boolean;
  viewGran: Granularity;
  setViewGran: (g: Granularity) => void;
  viewBreakdown: string;
  setViewBreakdown: (b: string) => void;
  rawwaterBreakdown: string;
  setRawwaterBreakdown: (b: string) => void;
  stackMode: StackMode;
  setStackMode: (m: StackMode) => void;
  roDrillMode: string;
  setRoDrillMode: (m: string) => void;
  phDrillMode: string;
  setPhDrillMode: (m: string) => void;
  kwhSource: string;
  setKwhSource: (s: string) => void;
  chartData: any[];
  usePermeateForSource: boolean;
  showLocatorFilter: boolean;
  setShowLocatorFilter: (v: boolean) => void;
}

export function TrendChartMobilePopover({
  metric, rangeDays, hasConsumptionDrill, hasRoDrill, hasPlantHealth,
  viewGran, setViewGran, viewBreakdown, setViewBreakdown,
  rawwaterBreakdown, setRawwaterBreakdown, stackMode, setStackMode,
  roDrillMode, setRoDrillMode, phDrillMode, setPhDrillMode,
  kwhSource, setKwhSource, chartData, usePermeateForSource,
  showLocatorFilter, setShowLocatorFilter,
}: TrendChartMobilePopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="sm:hidden h-6 w-6 flex items-center justify-center rounded border border-border bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors shrink-0"
          title="More chart options"
          aria-label="More chart options"
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-56 p-2.5 flex flex-col gap-3">
        {hasConsumptionDrill && (
          <div>
            <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">View</p>
            <div className="mb-2">
              <GranularityControl value={viewGran} onChange={(g) => { setViewGran(g); }} rangeDays={rangeDays} />
            </div>
            <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Breakdown</p>
            <div className="flex flex-wrap gap-1">
              <button onClick={() => { setViewBreakdown('total'); }}
                className={['h-6 px-2 rounded text-2xs font-medium border transition-colors leading-none', viewBreakdown === 'total' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground hover:text-foreground border-border'].join(' ')}>Total</button>
              <button onClick={() => { setViewBreakdown('by-locator'); }}
                className={['h-6 px-2 rounded text-2xs font-medium border transition-colors leading-none', viewBreakdown === 'by-locator' ? 'bg-chart-2 text-white border-chart-2' : 'bg-muted text-muted-foreground hover:text-foreground border-border'].join(' ')}>By locator</button>
              {metric === 'production' && (
                <button onClick={() => { setViewBreakdown('by-source'); }}
                  className={['h-6 px-2 rounded text-2xs font-medium border transition-colors leading-none', viewBreakdown === 'by-source' ? 'bg-chart-2 text-white border-chart-2' : 'bg-muted text-muted-foreground hover:text-foreground border-border'].join(' ')}>By source</button>
              )}
            </div>
            {(viewBreakdown === 'total' ? metric === 'nrw' : viewGran !== 'daily') && (
              <div className="mt-2">
                <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Bars</p>
                <StackToggle value={stackMode} onChange={setStackMode} />
              </div>
            )}
          </div>
        )}
        {metric === 'pv' && (
          <div>
            <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">View</p>
            <GranularityControl value={viewGran} onChange={setViewGran} rangeDays={rangeDays} />
          </div>
        )}
        {metric === 'rawwater' && (
          <div>
            <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">View</p>
            <div className="mb-2">
              <GranularityControl value={viewGran} onChange={(g) => { setViewGran(g); }} rangeDays={rangeDays} />
            </div>
            <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Breakdown</p>
            <div className="flex flex-wrap gap-1">
              <button onClick={() => { setRawwaterBreakdown('total'); }}
                className={['h-6 px-2 rounded text-2xs font-medium border', rawwaterBreakdown === 'total' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-border'].join(' ')}>Total</button>
              <button onClick={() => setRawwaterBreakdown('by-well')}
                className={['h-6 px-2 rounded text-2xs font-medium border', rawwaterBreakdown === 'by-well' ? 'bg-chart-2 text-white border-chart-2' : 'bg-muted text-muted-foreground border-border'].join(' ')}>By well</button>
            </div>
            {rawwaterBreakdown === 'by-well' && viewGran !== 'daily' && (
              <div className="mt-2">
                <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Bars</p>
                <StackToggle value={stackMode} onChange={setStackMode} />
              </div>
            )}
          </div>
        )}
        {hasRoDrill && (
          <div>
            <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">View</p>
            <div className="flex flex-wrap items-center gap-1 mb-2">
              <GranularityControl
                value={roDrillMode === 'by-hour' ? 'daily' : viewGran}
                onChange={(g) => {
                  setViewGran(g);
                  if (roDrillMode === 'by-hour') setRoDrillMode('default');
                }}
                rangeDays={rangeDays}
              />
              <button onClick={() => setRoDrillMode(roDrillMode === 'by-hour' ? 'default' : 'by-hour')}
                className={['h-5 px-1.5 rounded text-2xs font-medium border flex items-center gap-1', roDrillMode === 'by-hour' ? 'bg-kpi-ro text-white border-kpi-ro' : 'bg-muted text-muted-foreground border-border'].join(' ')}>
                Hourly
              </button>
            </div>
            <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Breakdown</p>
            <div className="flex flex-wrap gap-1">
              <button onClick={() => { if (roDrillMode === 'by-train') { setRoDrillMode('default'); } }}
                className={['h-6 px-2 rounded text-2xs font-medium border', roDrillMode !== 'by-train' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground hover:text-foreground border-border'].join(' ')}>Total</button>
              <button onClick={() => setRoDrillMode(roDrillMode === 'by-train' ? 'default' : 'by-train')}
                className={['h-6 px-2 rounded text-2xs font-medium border flex items-center gap-1', roDrillMode === 'by-train' ? 'bg-chart-2 text-white border-chart-2' : 'bg-muted text-muted-foreground hover:text-foreground border-border'].join(' ')}>
                <ChevronsDown className="h-3 w-3" />By train
              </button>
            </div>
            {roDrillMode === 'by-train' && viewGran !== 'daily' && (
              <div className="mt-2">
                <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Bars</p>
                <StackToggle value={stackMode} onChange={setStackMode} />
              </div>
            )}
          </div>
        )}
        {hasPlantHealth && (
          <div>
            <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">View</p>
            <div className="flex flex-wrap gap-1">
              {(['daily','hourly','weekly','monthly'] as const).map((m) => (
                <button key={m} onClick={() => { setPhDrillMode(m); }}
                  disabled={m !== 'hourly' && !isGranularityUsable(m, rangeDays)}
                  className={['h-6 px-2 rounded text-2xs font-medium border capitalize', phDrillMode === m ? 'bg-primary text-primary-foreground border-primary' : (m !== 'hourly' && !isGranularityUsable(m, rangeDays)) ? 'opacity-40 cursor-not-allowed bg-muted text-muted-foreground border-border' : 'bg-muted text-muted-foreground border-border'].join(' ')}>{m}</button>
              ))}
            </div>
          </div>
        )}
        {(metric === 'productionCost' || metric === 'kwh') && (
          <div>
            <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">View</p>
            <GranularityControl value={viewGran} onChange={setViewGran} rangeDays={rangeDays} />
          </div>
        )}
        {metric === 'productionCost' && (
          <div>
            <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Bars</p>
            <div className="mb-2">
              <StackToggle value={stackMode} onChange={setStackMode} />
            </div>
            <div className="flex flex-wrap gap-1">
              <button onClick={() => {}}
                className={['h-6 px-2 rounded text-2xs font-medium border', 'bg-muted text-muted-foreground border-border'].join(' ')}>Prod</button>
            </div>
          </div>
        )}
        {metric === 'kwh' && (
          <div>
            <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Energy source</p>
            <div className="flex flex-wrap gap-1 mb-2">
              {(['both','solar','grid'] as const).map(s => (
                <button key={s} onClick={() => setKwhSource(s)}
                  className={['h-6 px-2 rounded text-2xs font-medium border capitalize', kwhSource === s ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-border'].join(' ')}>{s}</button>
              ))}
            </div>
            <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Bars</p>
            <div className="mb-2">
              <StackToggle value={stackMode} onChange={setStackMode} />
            </div>
            <button onClick={() => {
                if (!chartData.length) return;
                const rows = chartData.map((d: any) => `${d.date},${+(d.solarKwh??0).toFixed(2)},${+(d.kwh??0).toFixed(2)},${+((d.solarKwh??0)+(d.kwh??0)).toFixed(2)}`);
                const csv = ['date,solar_kwh,grid_kwh,total_kwh',...rows].join('\n');
                const url = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
                const a = document.createElement('a'); a.href=url; a.download='power_energy_mix.csv'; a.click();
                URL.revokeObjectURL(url);
              }}
              className="w-full h-7 rounded border border-border bg-muted text-xs font-medium flex items-center justify-center gap-1 text-muted-foreground hover:text-foreground">
              <Download className="h-3 w-3" /> Export CSV
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
