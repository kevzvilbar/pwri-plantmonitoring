// Split out of TrendChart.tsx (was 4,095 lines) as part of a file-size
// cleanup pass. This is the `trailingControls` content passed to
// TrendChartToolbar: the mobile "..." popover plus the per-metric secondary
// controls row (granularity/breakdown toggles, cost-line checkboxes, kwh
// source picker, drill-mode switches, CSV export, etc.) — everything the
// user can adjust about how the current metric's chart is displayed, as
// opposed to filtering WHICH entities it displays (that's
// TrendChartFilterPanels' job, still inline in TrendChart.tsx).
//
// Moved verbatim from TrendChart.tsx — no logic or markup changes.
import {
  ChevronsDown, ChevronsUp, BarChart2, Filter, X, Check, Search, Download, MoreVertical, Rows3,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import { isGranularityUsable } from './TrendChartAggregate';
import { GranularityControl, StackToggle } from './TrendChartDrill';

export function TrendChartControls(props: Record<string, any>) {
  const {
    metric, compact, viewGran, setViewGran, viewBreakdown, setViewBreakdown,
    rawwaterBreakdown, setRawwaterBreakdown, stackMode, setStackMode,
    kwhSource, setKwhSource, chartData, range, rangeDays,
    selectedLocatorIds, setSelectedLocatorIds, selectedWellIds, setSelectedWellIds,
    roDrillMode, setRoDrillMode, showTrainFilter, setShowTrainFilter,
    phDrillMode, setPhDrillMode, phDayFocus, setPhDayFocus,
    showTotalCostLine, setShowTotalCostLine, showPowerCostLine, setShowPowerCostLine,
    showChemCostLine, setShowChemCostLine, prodDrillSource, usePermeateForSource, drillMode,
    hasConsumptionDrill, hasRoDrill, hasPlantHealth,
    allSelected, noneSelected, selectAllLocators, clearAllLocators, toggleLocator,
    allTrainsSelected, noTrainsSelected, selectAllTrains, clearAllTrains, toggleTrain,
    drillEntities, roTrainEntities, selectedTrainIds,
    filteredLocatorList, filteredTrainList, locatorSearch, setLocatorSearch, trainSearch, setTrainSearch,
    showLocatorFilter, setShowLocatorFilter,
  } = props;
  return (
        <>
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
            {/* View + Breakdown — production / nrw */}
            {hasConsumptionDrill && (
              <div>
                <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">View</p>
                <div className="mb-2">
                  <GranularityControl value={viewGran} onChange={(g) => { setViewGran(g); setSelectedLocatorIds(null); setShowLocatorFilter(false); }} rangeDays={rangeDays} />
                </div>
                <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Breakdown</p>
                <div className="flex flex-wrap gap-1">
                  <button onClick={() => { setViewBreakdown('total'); setSelectedLocatorIds(null); setShowLocatorFilter(false); }}
                    className={['h-6 px-2 rounded text-2xs font-medium border transition-colors leading-none', viewBreakdown === 'total' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground hover:text-foreground border-border'].join(' ')}>Total</button>
                  <button onClick={() => { setViewBreakdown('by-locator'); setSelectedLocatorIds(null); }}
                    className={['h-6 px-2 rounded text-2xs font-medium border transition-colors leading-none', viewBreakdown === 'by-locator' ? 'bg-chart-2 text-white border-chart-2' : 'bg-muted text-muted-foreground hover:text-foreground border-border'].join(' ')}>By locator</button>
                  {metric === 'production' && (
                    <button onClick={() => { setViewBreakdown('by-source'); setSelectedLocatorIds(null); }}
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
            {/* View — pv (M4: granularity only, no breakdown available) */}
            {metric === 'pv' && (
              <div>
                <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">View</p>
                <GranularityControl value={viewGran} onChange={setViewGran} rangeDays={rangeDays} />
              </div>
            )}
            {/* View + Breakdown — raw water (By-well, M4) */}
            {metric === 'rawwater' && (
              <div>
                <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">View</p>
                <div className="mb-2">
                  <GranularityControl value={viewGran} onChange={(g) => { setViewGran(g); setSelectedWellIds(null); }} rangeDays={rangeDays} />
                </div>
                <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Breakdown</p>
                <div className="flex flex-wrap gap-1">
                  <button onClick={() => { setRawwaterBreakdown('total'); setSelectedWellIds(null); }}
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
            {/* View + Breakdown — tds / recovery */}
            {hasRoDrill && (
              <div>
                <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">View</p>
                <div className="flex flex-wrap items-center gap-1 mb-2">
                  <GranularityControl
                    value={roDrillMode === 'by-hour' ? 'daily' : viewGran}
                    onChange={(g) => {
                      setViewGran(g);
                      // Hourly is a separate axis entirely — leaving it
                      // returns to 'default' (Total). Both Total and
                      // By-train now support Weekly/Monthly.
                      if (roDrillMode === 'by-hour') setRoDrillMode('default');
                      setShowTrainFilter(false);
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
                  <button onClick={() => { if (roDrillMode === 'by-train') { setRoDrillMode('default'); setShowTrainFilter(false); } }}
                    className={['h-6 px-2 rounded text-2xs font-medium border', roDrillMode !== 'by-train' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-border'].join(' ')}>Total</button>
                  <button onClick={() => setRoDrillMode(roDrillMode === 'by-train' ? 'default' : 'by-train')}
                    className={['h-6 px-2 rounded text-2xs font-medium border flex items-center gap-1', roDrillMode === 'by-train' ? 'bg-chart-2 text-white border-chart-2' : 'bg-muted text-muted-foreground border-border'].join(' ')}>
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
            {/* View — plant health */}
            {hasPlantHealth && (
              <div>
                <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">View</p>
                <div className="flex flex-wrap gap-1">
                  {(['daily','hourly','weekly','monthly'] as const).map((m) => (
                    <button key={m} onClick={() => { setPhDrillMode(m); setPhDayFocus(null); }}
                      disabled={m !== 'hourly' && !isGranularityUsable(m, rangeDays)}
                      className={['h-6 px-2 rounded text-2xs font-medium border capitalize', phDrillMode === m ? 'bg-primary text-primary-foreground border-primary' : (m !== 'hourly' && !isGranularityUsable(m, rangeDays)) ? 'opacity-40 cursor-not-allowed bg-muted text-muted-foreground border-border' : 'bg-muted text-muted-foreground border-border'].join(' ')}>{m}</button>
                  ))}
                </div>
              </div>
            )}
            {/* View — Production Cost / kWh (M4: granularity, alongside their own toggles below) */}
            {(metric === 'productionCost' || metric === 'kwh') && (
              <div>
                <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">View</p>
                <GranularityControl value={viewGran} onChange={setViewGran} rangeDays={rangeDays} />
              </div>
            )}
            {/* Production cost toggles */}
            {metric === 'productionCost' && (
              <div>
                <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Bars</p>
                <div className="mb-2">
                  <StackToggle value={stackMode} onChange={setStackMode} />
                </div>
                {stackMode !== 'stacked' && (<>
                  <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Show lines</p>
                  <div className="flex flex-wrap gap-1">
                    <button onClick={() => setShowTotalCostLine(v => !v)}
                      className={['h-6 px-2 rounded text-2xs font-medium border', showTotalCostLine ? 'bg-accent text-accent-foreground border-accent' : 'bg-muted text-muted-foreground border-border'].join(' ')}>Prod</button>
                    <button onClick={() => setShowPowerCostLine(v => !v)}
                      className={['h-6 px-2 rounded text-2xs font-medium border', showPowerCostLine ? 'border-[hsl(var(--chart-6))] text-[hsl(var(--chart-6))] bg-[hsl(var(--chart-6))]/10' : 'bg-muted text-muted-foreground border-border'].join(' ')}>Power</button>
                    <button onClick={() => setShowChemCostLine(v => !v)}
                      className={['h-6 px-2 rounded text-2xs font-medium border', showChemCostLine ? 'border-[hsl(var(--highlight))] text-[hsl(var(--highlight))] bg-[hsl(var(--highlight))]/10' : 'bg-muted text-muted-foreground border-border'].join(' ')}>Chem</button>
                  </div>
                </>)}
                {stackMode === 'stacked' && (
                  <div className="flex flex-wrap gap-1">
                    <button onClick={() => setShowPowerCostLine(v => !v)}
                      className={['h-6 px-2 rounded text-2xs font-medium border', showPowerCostLine ? 'border-[hsl(var(--chart-6))] text-[hsl(var(--chart-6))] bg-[hsl(var(--chart-6))]/10' : 'bg-muted text-muted-foreground border-border'].join(' ')}>Power</button>
                    <button onClick={() => setShowChemCostLine(v => !v)}
                      className={['h-6 px-2 rounded text-2xs font-medium border', showChemCostLine ? 'border-[hsl(var(--highlight))] text-[hsl(var(--highlight))] bg-[hsl(var(--highlight))]/10' : 'bg-muted text-muted-foreground border-border'].join(' ')}>Chem</button>
                  </div>
                )}
              </div>
            )}
            {/* kWh source filter + export */}
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

        {/* ── Desktop-only secondary controls (hidden on mobile) ─────────────── */}
        <div className="hidden sm:contents">

        {/* kwh: Source filter — Both / Solar / Grid + CSV Export */}
        {metric === 'kwh' && (() => {
          const hasSolarData = chartData.some((d: any) => (d.solarKwh ?? 0) > 0);
          const hasGridData  = chartData.some((d: any) => (d.kwh ?? 0) > 0);
          return (
            <div className="flex items-center gap-1 shrink-0 ml-1">
              <GranularityControl value={viewGran} onChange={setViewGran} rangeDays={rangeDays} testIdPrefix={`drill-${metric}`} />
              {hasSolarData && hasGridData && (
                <>
                  <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
                    {(['both', 'solar', 'grid'] as const).map(s => (
                      <button key={s} onClick={() => setKwhSource(s)}
                        className={[
                          'px-2 py-0.5 rounded text-2xs font-medium transition-colors',
                          kwhSource === s
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:text-foreground',
                        ].join(' ')}>
                        {s === 'both' ? 'Both' : s === 'solar' ? '☀ Solar' : '⚡ Grid'}
                      </button>
                    ))}
                  </div>
                  <StackToggle value={stackMode} onChange={setStackMode} testId="kwh-stack-toggle" />
                </>
              )}
              <button
                onClick={() => {
                  if (!chartData.length) { toast.error('No data to export'); return; }
                  const rows = chartData.map((d: any) =>
                    `${d.date},${+(d.solarKwh ?? 0).toFixed(2)},${+(d.kwh ?? 0).toFixed(2)},${+((d.solarKwh ?? 0) + (d.kwh ?? 0)).toFixed(2)}`
                  );
                  const csv = ['date,solar_kwh,grid_kwh,total_kwh', ...rows].join('\n');
                  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
                  const a = document.createElement('a');
                  a.href = url; a.download = 'power_energy_mix.csv'; a.click();
                  URL.revokeObjectURL(url);
                  toast.success('CSV exported');
                }}
                className="h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none flex items-center gap-0.5 border bg-muted text-muted-foreground hover:text-foreground border-border"
                title="Export CSV"
              >
                <Download className="h-3 w-3" />
                <span className="hidden sm:inline">Export</span>
              </button>
            </div>
          );
        })()}

        {/* Production Cost — granularity + Stack/Group + line toggles */}
        {metric === 'productionCost' && (
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
        )}

        {/* pv — granularity only (M4: no breakdown available) */}
        {metric === 'pv' && (
          <div className="flex items-center gap-0.5 shrink-0 ml-1">
            <span className="text-3xs text-muted-foreground uppercase tracking-wide mr-0.5 hidden sm:inline">View</span>
            <GranularityControl value={viewGran} onChange={setViewGran} rangeDays={rangeDays} testIdPrefix={`drill-${metric}`} />
          </div>
        )}

        {/* raw water — granularity + By-well breakdown (M4) */}
        {metric === 'rawwater' && (
          <div className="flex items-center gap-0.5 shrink-0 ml-1">
            <span className="text-3xs text-muted-foreground uppercase tracking-wide mr-0.5 hidden sm:inline">View</span>
            <GranularityControl
              value={viewGran}
              onChange={(g) => { setViewGran(g); setSelectedWellIds(null); }}
              rangeDays={rangeDays}
              testIdPrefix={`drill-${metric}`}
            />
            <span className="hidden sm:inline-block h-3 border-l border-border mx-1" aria-hidden />
            <span className="text-3xs text-muted-foreground uppercase tracking-wide mr-0.5 hidden sm:inline">Breakdown</span>
            <button
              onClick={() => { setRawwaterBreakdown('total'); setSelectedWellIds(null); }}
              className={[
                'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none border',
                rawwaterBreakdown === 'total'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted text-muted-foreground hover:text-foreground border-border',
              ].join(' ')}
            >Total</button>
            <button
              onClick={() => setRawwaterBreakdown(rawwaterBreakdown === 'by-well' ? 'total' : 'by-well')}
              className={[
                'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none border',
                rawwaterBreakdown === 'by-well'
                  ? 'bg-chart-2 text-white border-chart-2'
                  : 'bg-muted text-muted-foreground hover:text-foreground border-border',
              ].join(' ')}
            >By well</button>
            {rawwaterBreakdown === 'by-well' && viewGran !== 'daily' && (
              <>
                <span className="hidden sm:inline-block h-3 border-l border-border mx-1" aria-hidden />
                <StackToggle value={stackMode} onChange={setStackMode} testId="rawwater-stack-toggle" />
              </>
            )}
          </div>
        )}



        {/* ── Production / NRW — View granularity + Breakdown entity ────── */}
        {hasConsumptionDrill && (
          <div className="flex items-center gap-0.5 shrink-0">
            {/* ── Granularity ── */}
            <span className="text-3xs text-muted-foreground uppercase tracking-wide mr-0.5 hidden sm:inline">View</span>
            <GranularityControl
              value={viewGran}
              onChange={(g) => { setViewGran(g); setSelectedLocatorIds(null); setShowLocatorFilter(false); }}
              rangeDays={rangeDays}
              testIdPrefix={`drill-${metric}`}
            />

            {/* ── Divider ── */}
            <span className="hidden sm:inline-block h-3 border-l border-border mx-1" aria-hidden />

            {/* ── Breakdown ── */}
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

            {/* ── Locator / source filter — visible only when breakdown != total ── */}
            {viewBreakdown !== 'total' && (
              <button
                onClick={() => setShowLocatorFilter((v) => !v)}
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

            {/* ── Stack / Group (M2) — only where there's something to stack ── */}
            {(viewBreakdown === 'total' ? metric === 'nrw' : viewGran !== 'daily') && (
              <>
                <span className="hidden sm:inline-block h-3 border-l border-border mx-1" aria-hidden />
                <StackToggle value={stackMode} onChange={setStackMode} testId={`${metric}-stack-toggle`} />
              </>
            )}
          </div>
        )}
        {/* ── TDS / Recovery — View granularity + Breakdown entity ────────── */}
        {hasRoDrill && (
          <div className="flex items-center gap-0.5 shrink-0">
            {/* ── Granularity ── */}
            <span className="text-3xs text-muted-foreground uppercase tracking-wide mr-0.5 hidden sm:inline">View</span>
            <GranularityControl
              value={roDrillMode === 'by-hour' ? 'daily' : viewGran}
              onChange={(g) => {
                setViewGran(g);
                // Hourly is a separate axis entirely — leaving it returns to
                // 'default' (Total). Both Total and By-train now support
                // Weekly/Monthly.
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

            {/* ── Divider ── */}
            <span className="hidden sm:inline-block h-3 border-l border-border mx-1" aria-hidden />

            {/* ── Breakdown ── */}
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
                'h-5 px-1.5 rounded text-2xs font-medium transition-colors leading-none flex items-center gap-0.5 border',
                roDrillMode === 'by-train'
                  ? 'bg-chart-2 text-white border-chart-2'
                  : 'bg-muted text-muted-foreground hover:text-foreground border-border',
              ].join(' ')}
              title="Daily average per RO train"
            >
              <ChevronsDown className="h-3 w-3" />
              By train
            </button>

            {/* Train filter — visible in by-train or by-hour mode */}
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

            {/* ── Stack / Group (M2) — By-train bars, Weekly/Monthly only ── */}
            {roDrillMode === 'by-train' && viewGran !== 'daily' && (
              <>
                <span className="hidden sm:inline-block h-3 border-l border-border mx-1" aria-hidden />
                <StackToggle value={stackMode} onChange={setStackMode} testId="ro-train-stack-toggle" />
              </>
            )}
          </div>
        )}
        {/* ── Plant Health — granularity only (no entity breakdown) ────────── */}
        {hasPlantHealth && (
          <div className="flex items-center gap-0.5 shrink-0" title="Plant Health granularity">
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
        )}
      </div>
      {/* ── Train filter panel ─────────────────────────────────────────────── */}
      {hasRoDrill && roDrillMode !== 'default' && showTrainFilter && (
        <div className="mb-2 rounded-md border border-border bg-muted/30 p-2 flex flex-col gap-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-foreground shrink-0">Filter Trains</span>
            <div className="flex items-center gap-1 ml-auto">
              <button
                onClick={selectAllTrains}
                className={[
                  'h-5 px-2 rounded text-2xs font-medium border transition-colors leading-none',
                  allTrainsSelected
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-muted text-muted-foreground hover:text-foreground border-border',
                ].join(' ')}
              >All</button>
              <button
                onClick={clearAllTrains}
                className={[
                  'h-5 px-2 rounded text-2xs font-medium border transition-colors leading-none',
                  noTrainsSelected
                    ? 'bg-danger text-white border-danger'
                    : 'bg-muted text-muted-foreground hover:text-foreground border-border',
                ].join(' ')}
              >None</button>
              <button
                onClick={() => setShowTrainFilter(false)}
                className="h-5 w-5 flex items-center justify-center rounded border border-border bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Close filter"
                aria-label="Close filter"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>

          {roTrainEntities.length > 6 && (
            <div className="relative">
              <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={trainSearch}
                onChange={(e) => setTrainSearch(e.target.value)}
                placeholder="Search trains…"
                className="w-full h-6 pl-6 pr-2 rounded border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {trainSearch && (
                <button onClick={() => setTrainSearch('')} aria-label="Clear search" className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-1 max-h-[130px] overflow-y-auto pr-0.5">
            {filteredTrainList.length === 0 && (
              <span className="text-xs text-muted-foreground py-1">No trains match search.</span>
            )}
            {filteredTrainList.map((entity) => {
              const isActive = selectedTrainIds === null || selectedTrainIds.has(entity.id);
              return (
                <button
                  key={entity.id}
                  onClick={() => toggleTrain(entity.id)}
                  title={entity.label}
                  className={[
                    'flex items-center gap-1 h-6 px-2 rounded-full text-2xs font-medium border transition-all leading-none max-w-[180px]',
                    isActive
                      ? 'text-white border-transparent shadow-sm'
                      : 'bg-background text-muted-foreground border-border hover:border-foreground/30',
                  ].join(' ')}
                  style={isActive ? { backgroundColor: entity.color, borderColor: entity.color } : {}}
                >
                  {isActive && <Check className="h-2.5 w-2.5 shrink-0" />}
                  <span className="truncate">{entity.label}</span>
                </button>
              );
            })}
          </div>

          <div className="text-2xs text-muted-foreground flex items-center gap-2 pt-0.5 border-t border-border/50">
            <span>
              {allTrainsSelected
                ? `All ${roTrainEntities.length} trains shown`
                : noTrainsSelected
                  ? 'No trains selected — chart will be empty'
                  : `${selectedTrainIds!.size} of ${roTrainEntities.length} trains shown`}
            </span>
            {!allTrainsSelected && !noTrainsSelected && (
              <button onClick={selectAllTrains} className="ml-auto text-2xs text-primary hover:underline">Reset</button>
            )}
          </div>
        </div>
      )}
      {hasConsumptionDrill && drillMode !== 'default' && showLocatorFilter && (
        <div className="mb-2 rounded-md border border-border bg-muted/30 p-2 flex flex-col gap-1.5" data-testid={`locator-filter-panel-${metric}`}>
          {/* Header row */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-foreground shrink-0">Filter Locators</span>
            <div className="flex items-center gap-1 ml-auto">
              <button
                onClick={selectAllLocators}
                className={[
                  'h-5 px-2 rounded text-2xs font-medium border transition-colors leading-none',
                  allSelected
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-muted text-muted-foreground hover:text-foreground border-border',
                ].join(' ')}
              >
                All
              </button>
              <button
                onClick={clearAllLocators}
                className={[
                  'h-5 px-2 rounded text-2xs font-medium border transition-colors leading-none',
                  noneSelected
                    ? 'bg-danger text-white border-danger'
                    : 'bg-muted text-muted-foreground hover:text-foreground border-border',
                ].join(' ')}
              >
                None
              </button>
              <button
                onClick={() => setShowLocatorFilter(false)}
                className="h-5 w-5 flex items-center justify-center rounded border border-border bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Close filter"
                aria-label="Close filter"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>

          {/* Search box */}
          {drillEntities.length > 6 && (
            <div className="relative">
              <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={locatorSearch}
                onChange={(e) => setLocatorSearch(e.target.value)}
                placeholder="Search locators…"
                className="w-full h-6 pl-6 pr-2 rounded border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {locatorSearch && (
                <button
                  onClick={() => setLocatorSearch('')}
                  aria-label="Clear search"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          )}

          {/* Locator chip grid */}
          <div className="flex flex-wrap gap-1 max-h-[130px] overflow-y-auto pr-0.5">
            {filteredLocatorList.length === 0 && (
              <span className="text-xs text-muted-foreground py-1">No locators match search.</span>
            )}
            {filteredLocatorList.map((entity) => {
              const isActive = selectedLocatorIds === null || selectedLocatorIds.has(entity.id);
              return (
                <button
                  key={entity.id}
                  onClick={() => toggleLocator(entity.id)}
                  title={entity.label}
                  className={[
                    'flex items-center gap-1 h-6 px-2 rounded-full text-2xs font-medium border transition-all leading-none max-w-[180px]',
                    isActive
                      ? 'text-white border-transparent shadow-sm'
                      : 'bg-background text-muted-foreground border-border hover:border-foreground/30',
                  ].join(' ')}
                  style={isActive ? { backgroundColor: entity.color, borderColor: entity.color } : {}}
                >
                  {isActive && <Check className="h-2.5 w-2.5 shrink-0" />}
                  <span className="truncate">{entity.label}</span>
                </button>
              );
            })}
          </div>

          {/* Summary footer */}
          <div className="text-2xs text-muted-foreground flex items-center gap-2 pt-0.5 border-t border-border/50">
            <span>
              {allSelected
                ? `All ${drillEntities.length} locators shown`
                : noneSelected
                  ? 'No locators selected — chart will be empty'
                  : `${selectedLocatorIds!.size} of ${drillEntities.length} locators shown`}
            </span>
            {!allSelected && !noneSelected && (
              <button
                onClick={selectAllLocators}
                className="ml-auto text-2xs text-primary hover:underline"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      )}

        </>
  );
}
