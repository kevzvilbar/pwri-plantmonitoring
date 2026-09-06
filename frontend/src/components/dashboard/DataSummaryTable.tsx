import React, { useMemo } from 'react';
import { format } from 'date-fns';
import { Activity, Droplet, Receipt, Gauge } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { SummaryTab } from './DataSummaryModal';

export interface DataSummaryTableProps {
  tab: SummaryTab;
  isLoading: boolean;
  consPivot: {
    dates: string[];
    entities: any[];
    pivot: Map<string, Map<string, number>>;
    estimatedKeys: Set<string>;
  };
  prodPivot: {
    dates: string[];
    entities: any[];
    pivot: Map<string, Map<string, number>>;
    estimatedKeys: Set<string>;
  };
  combinedProdPivot: {
    dates: string[];
    entities: any[];
    pivot: Map<string, Map<string, number>>;
    estimatedKeys: Set<string>;
  };
  consCurrentPivot: {
    dates: string[];
    entities: any[];
    pivot: Map<string, Map<string, number>>;
  };
  prodCurrentPivot: {
    dates: string[];
    entities: any[];
    pivot: Map<string, Map<string, number>>;
  };
  combinedProdCurrentPivot: {
    dates: string[];
    entities: any[];
    pivot: Map<string, Map<string, number>>;
  };
  currentPivotData: {
    dates: string[];
    entities: any[];
    pivot: Map<string, Map<string, number>>;
  };
  colTotals: number[];
  rowTotals: number[];
  grandTotal: number;
  prodGrandTotal: number;
  consGrandTotal: number;
  plantCodeById: Map<string, string>;
  hasRoEntities: boolean;
  hasMeterEntities: boolean;
  currentSide: 'consumption' | 'production';
}

function fmtVal(v: number | null | undefined, minimumFractionDigits = 1, maximumFractionDigits = 2) {
  if (v == null || v === 0) return null;
  return v.toLocaleString(undefined, { minimumFractionDigits, maximumFractionDigits });
}

export function DataSummaryTable({
  tab,
  isLoading,
  consPivot,
  prodPivot,
  combinedProdPivot,
  consCurrentPivot,
  prodCurrentPivot,
  combinedProdCurrentPivot,
  currentPivotData,
  colTotals,
  rowTotals,
  grandTotal,
  prodGrandTotal,
  consGrandTotal,
  plantCodeById,
  hasRoEntities,
  hasMeterEntities,
  currentSide,
}: DataSummaryTableProps) {
  const activeProdPivot = combinedProdPivot;
  const allDates = activeProdPivot.dates;
  const prodEntities = activeProdPivot.entities;
  const consEntities = consPivot.entities;
  const dates = tab === 'consumption' ? consPivot.dates : combinedProdPivot.dates;
  const entities = tab === 'consumption' ? consPivot.entities : combinedProdPivot.entities;
  const pivot = tab === 'consumption' ? consPivot.pivot : combinedProdPivot.pivot;
  const estimatedKeys = tab === 'consumption' ? consPivot.estimatedKeys : combinedProdPivot.estimatedKeys;

  const bothRows = useMemo(() => {
    return [...allDates].reverse().map((date) => {
      const prod = prodEntities.reduce((s: number, e: any) => s + (activeProdPivot.pivot.get(date)?.get(e.id) ?? 0), 0);
      const cons = consEntities.reduce((s: number, e: any) => s + (consPivot.pivot.get(date)?.get(e.id) ?? 0), 0);
      const bal  = prod - cons;
      const nrw  = prod > 0 ? +((bal / prod) * 100).toFixed(1) : null;
      return { date, prod, cons, bal, nrw };
    });
  }, [allDates, prodEntities, consEntities, activeProdPivot, consPivot]);

  const totProd = prodGrandTotal;
  const totCons = consGrandTotal;
  const totBal  = totProd - totCons;
  const totNRW  = totProd > 0 ? +((totBal / totProd) * 100).toFixed(1) : null;

  if (isLoading) {
    return (
      <div className="p-3 space-y-2.5" data-testid="dsm-loading-skeleton">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-3 w-20 shrink-0" />
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-3 w-16 shrink-0" />
            <Skeleton className="h-3 w-14 shrink-0" />
          </div>
        ))}
      </div>
    );
  }

  if (tab === 'both') {
    return (
      <div className="flex-1 overflow-auto min-h-0">
        <table className="min-w-full text-xs border-collapse" data-testid="dsm-both-table">
          <thead>
            <tr className="bg-muted/95 backdrop-blur-sm">
              <th className="sticky top-0 left-0 z-30 bg-muted/95 px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap border-b border-r border-border min-w-[100px]">Date</th>
              <th className="sticky top-0 z-20 bg-muted/95 px-3 py-2 text-right font-semibold text-primary whitespace-nowrap border-b border-border min-w-[110px]">Production (m³)</th>
              <th className="sticky top-0 z-20 bg-muted/95 px-3 py-2 text-right font-semibold text-highlight whitespace-nowrap border-b border-border min-w-[120px]">Consumption (m³)</th>
              <th className="sticky top-0 z-20 bg-muted/95 px-3 py-2 text-right font-semibold text-muted-foreground whitespace-nowrap border-b border-border min-w-[100px]">Balance (m³)</th>
              <th className="sticky top-0 right-0 z-30 bg-primary-soft/95 px-3 py-2 text-right font-bold text-primary whitespace-nowrap border-b border-l border-border min-w-[80px]">NRW %</th>
            </tr>
            <tr className="bg-primary-soft/60">
              <td className="sticky left-0 z-30 bg-primary-soft/60 px-3 py-1.5 font-semibold text-primary whitespace-nowrap border-b border-r border-border text-2xs">TOTAL</td>
              <td className="px-3 py-1.5 text-right font-semibold font-mono-num text-primary border-b border-border tabular-nums">{totProd !== 0 ? <span className={totProd < 0 ? 'text-destructive font-semibold' : ''}>{fmtVal(totProd)}</span> : '—'}</td>
              <td className="px-3 py-1.5 text-right font-semibold font-mono-num text-highlight border-b border-border tabular-nums">{totCons !== 0 ? <span className={totCons < 0 ? 'text-destructive font-semibold' : ''}>{fmtVal(totCons)}</span> : '—'}</td>
              <td className={['px-3 py-1.5 text-right font-semibold font-mono-num border-b border-border tabular-nums', totBal >= 0 ? 'text-accent' : 'text-danger'].join(' ')}>{totBal !== 0 ? fmtVal(totBal) : '—'}</td>
              <td className="sticky right-0 z-30 bg-primary-soft/60 px-3 py-1.5 text-right font-bold font-mono-num text-primary border-b border-l border-border tabular-nums">{totNRW != null ? `${totNRW}%` : '—'}</td>
            </tr>
          </thead>
          <tbody>
            {bothRows.map(({ date, prod, cons, bal, nrw }, di) => {
              const isEven = di % 2 === 0;
              return (
                <tr key={date} className={isEven ? 'bg-background hover:bg-muted/20' : 'bg-muted/10 hover:bg-muted/30'}>
                  <td className={['sticky left-0 z-10 px-3 py-1.5 font-medium text-muted-foreground whitespace-nowrap border-r border-border', isEven ? 'bg-background' : 'bg-muted/10'].join(' ')}>{format(new Date(date + 'T12:00:00'), 'MMM d, yyyy')}</td>
                  <td className="px-3 py-1.5 text-right font-mono-num tabular-nums text-primary">{prod !== 0 ? <span className={prod < 0 ? 'text-destructive font-semibold' : ''}>{fmtVal(prod)}</span> : <span className="text-muted-foreground/40">—</span>}</td>
                  <td className="px-3 py-1.5 text-right font-mono-num tabular-nums text-highlight">{cons !== 0 ? <span className={cons < 0 ? 'text-destructive font-semibold' : ''}>{fmtVal(cons)}</span> : <span className="text-muted-foreground/40">—</span>}</td>
                  <td className={['px-3 py-1.5 text-right font-mono-num tabular-nums', bal > 0 ? 'text-accent' : bal < 0 ? 'text-danger' : 'text-muted-foreground/40'].join(' ')}>{prod !== 0 || cons !== 0 ? fmtVal(bal) : '—'}</td>
                  <td className={['sticky right-0 z-10 px-3 py-1.5 text-right font-semibold font-mono-num tabular-nums border-l border-border', isEven ? 'bg-background' : 'bg-muted/10', nrw != null && nrw > 10 ? 'text-danger' : nrw != null ? 'text-primary' : 'text-muted-foreground/40'].join(' ')}>{nrw != null ? `${nrw}%` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  if (tab === 'production' || tab === 'consumption') {
    if (entities.length === 0) {
      return (
        <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
          No {tab === 'consumption' ? 'locators' : 'product meters or RO trains'} found.
        </div>
      );
    }
    if (dates.length === 0) {
      return (
        <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
          No readings in this date range.
        </div>
      );
    }

    return (
      <div className="flex-1 overflow-auto min-h-0">
        <table className="min-w-full text-xs border-collapse" data-testid="dsm-pivot-table">
          <thead>
            <tr className="bg-muted/95 backdrop-blur-sm">
              <th className="sticky top-0 left-0 z-30 bg-muted/95 px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap border-b border-r border-border min-w-[100px]">Date</th>
              {entities.map((e, i) => {
                const isRoTrain = tab === 'production' && (e as any)._source === 'ro';
                const label = isRoTrain
                  ? `RO${e.train_number ?? i + 1}`
                  : (e.name ?? e.code ?? `#${i + 1}`);
                const sublabel = plantCodeById.get(e.plant_id) ?? '';
                return (
                  <th
                    key={e.id}
                    className="sticky top-0 z-20 bg-muted/95 px-2 py-2 text-center font-semibold text-muted-foreground whitespace-nowrap border-b border-border min-w-[90px]"
                    title={`${sublabel}${sublabel ? ' · ' : ''}${isRoTrain ? `Train ${e.train_number}` : (e.name ?? e.code ?? e.id)}`}
                  >
                    <div className="truncate max-w-[110px] mx-auto font-mono-num">{label}</div>
                    {sublabel && (
                      <div className="text-3xs font-normal text-muted-foreground/70 truncate">{sublabel}</div>
                    )}
                  </th>
                );
              })}
              <th className="sticky top-0 right-0 z-30 bg-primary-soft/95 px-3 py-2 text-right font-bold text-primary whitespace-nowrap border-b border-l border-border min-w-[90px]">
                {tab === 'production' ? 'Total Prod. (m³)' : 'Total (m³)'}
              </th>
            </tr>

            <tr className="bg-primary-soft/60">
              <td className="sticky left-0 z-30 bg-primary-soft/60 px-3 py-1.5 font-semibold text-primary whitespace-nowrap border-b border-r border-border text-2xs">TOTAL</td>
              {colTotals.map((tot, i) => (
                <td key={entities[i].id} className="px-2 py-1.5 text-center font-semibold font-mono-num text-primary border-b border-border tabular-nums">
                  {tot > 0 ? fmtVal(tot) : <span className="text-muted-foreground/50">—</span>}
                </td>
              ))}
              <td className="sticky right-0 z-30 bg-primary-soft/60 px-3 py-1.5 text-right font-bold font-mono-num text-primary border-b border-l border-border tabular-nums">
                {fmtVal(grandTotal)}
              </td>
            </tr>
          </thead>

          <tbody>
            {[...dates].reverse().map((date, di) => {
              const rowVols = entities.map((e) => pivot.get(date)?.get(e.id) ?? null);
              const rowTot = rowTotals[dates.length - 1 - di];
              const isEven = di % 2 === 0;
              return (
                <tr key={date} className={isEven ? 'bg-background hover:bg-muted/20' : 'bg-muted/10 hover:bg-muted/30'}>
                  <td className={[
                    'sticky left-0 z-10 px-3 py-1.5 font-medium text-muted-foreground whitespace-nowrap border-r border-border',
                    isEven ? 'bg-background' : 'bg-muted/10',
                  ].join(' ')}>
                    {format(new Date(date + 'T12:00:00'), 'MMM d, yyyy')}
                  </td>
                  {rowVols.map((vol, ei) => {
                    const entityId = entities[ei].id;
                    const estKey = `${date}__${entityId}`;
                    const isEst = estimatedKeys.has(estKey);
                    return (
                      <td
                        key={entityId}
                        className={[
                          "px-2 py-1.5 text-right font-mono-num tabular-nums border-border",
                          isEst ? "bg-warn-soft/60" : "",
                        ].join(" ")}
                        title={isEst ? "System-generated / Backfilled reading — no manual operator entry on file. Value will be replaced when actual data is entered." : undefined}
                      >
                        {vol != null && vol !== 0 ? (
                          <span className={cn("inline-flex items-center gap-0.5", vol < 0 && "text-destructive font-semibold")}>
                            {isEst && (
                              <span className="text-warn text-3xs font-bold leading-none" aria-label="estimated">~</span>
                            )}
                            {fmtVal(vol)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td className={[
                    'sticky right-0 z-10 px-3 py-1.5 text-right font-semibold font-mono-num tabular-nums border-l border-border',
                    tab === 'consumption' ? 'text-highlight' : 'text-primary',
                    isEven ? 'bg-background' : 'bg-muted/10',
                  ].join(' ')}>
                    {rowTot !== 0 ? (
                      <span className={rowTot < 0 ? 'text-destructive font-semibold' : ''}>
                        {fmtVal(rowTot)}
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* ── Inline Current Readings section (same entities, raw meter values) ── */}
        {(() => {
          const inlineCurrPivot = tab === 'consumption'
            ? consCurrentPivot
            : combinedProdCurrentPivot;
          const icEntities = inlineCurrPivot.entities;
          const icDates    = inlineCurrPivot.dates;
          const icPivot    = inlineCurrPivot.pivot;

          const icEntityLatest: (number | null)[] = icEntities.map((e: any) => {
            for (const d of [...icDates].reverse()) {
              const v = icPivot.get(d)?.get(e.id);
              if (v != null) return v;
            }
            return null;
          });

          return (
            <>
              <div className="flex items-center gap-2 px-3 py-2 border-t-2 border-border/60 bg-muted/30">
                <Gauge className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs font-semibold text-muted-foreground">Current Readings</span>
                <span className="text-2xs text-muted-foreground/60">— latest raw meter value per entity per day (absolute, not delta)</span>
              </div>

              <table className="min-w-full text-xs border-collapse" data-testid="dsm-current-inline-table">
                <thead>
                  <tr className="bg-muted/90 backdrop-blur-sm">
                    <th className="sticky left-0 z-20 bg-muted/90 px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap border-b border-r border-border min-w-[100px]">Date</th>
                    {icEntities.map((e: any, i: number) => {
                      const isRoTrain = tab === 'production' && e._source === 'ro';
                      const label    = isRoTrain ? `RO${e.train_number ?? i + 1}` : (e.name ?? e.code ?? `#${i + 1}`);
                      const sublabel = plantCodeById.get(e.plant_id) ?? '';
                      return (
                        <th
                          key={e.id}
                          className="bg-muted/90 px-2 py-2 text-center font-semibold text-muted-foreground whitespace-nowrap border-b border-border min-w-[90px]"
                          title={`${sublabel}${sublabel ? ' · ' : ''}${isRoTrain ? `Train ${e.train_number}` : (e.name ?? e.code ?? e.id)}`}
                        >
                          <div className="truncate max-w-[110px] mx-auto font-mono-num">{label}</div>
                          {sublabel && (
                            <div className="text-3xs font-normal text-muted-foreground/70 truncate">{sublabel}</div>
                          )}
                        </th>
                      );
                    })}
                    <th className="sticky right-0 z-20 bg-primary-soft/95 px-3 py-2 text-right font-bold text-primary whitespace-nowrap border-b border-l border-border min-w-[80px]">Coverage</th>
                  </tr>

                  <tr className="bg-primary-soft/60">
                    <td className="sticky left-0 z-20 bg-primary-soft/60 px-3 py-1.5 text-2xs font-bold text-primary whitespace-nowrap border-b border-r border-border">LATEST</td>
                    {icEntityLatest.map((val, i) => (
                      <td
                        key={icEntities[i].id}
                        className="px-2 py-1.5 text-center text-2xs font-semibold font-mono-num tabular-nums text-primary border-b border-border"
                      >
                        {val != null
                          ? val.toLocaleString(undefined, { maximumFractionDigits: 2 })
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>
                    ))}
                    <td className="sticky right-0 z-20 bg-primary-soft/60 px-3 py-1.5 text-right text-2xs font-bold text-primary border-b border-l border-border tabular-nums">
                      {icEntities.length} entities
                    </td>
                  </tr>
                </thead>

                <tbody>
                  {[...icDates].reverse().map((date: string, di: number) => {
                    const isEven      = di % 2 === 0;
                    const rowVals     = icEntities.map((e: any) => icPivot.get(date)?.get(e.id) ?? null);
                    const reported    = rowVals.filter((v) => v != null).length;
                    const total       = icEntities.length;
                    const coveragePct = total > 0 ? Math.round((reported / total) * 100) : 0;
                    const coverageColor =
                      coveragePct === 100 ? 'text-accent' :
                      coveragePct >= 50   ? 'text-warn'    :
                                            'text-danger';
                    return (
                      <tr
                        key={date}
                        className={isEven ? 'bg-background hover:bg-muted/20' : 'bg-muted/10 hover:bg-muted/30'}
                      >
                        <td className={[
                          'sticky left-0 z-10 px-3 py-1.5 font-medium text-muted-foreground whitespace-nowrap border-r border-border',
                          isEven ? 'bg-background' : 'bg-muted/10',
                        ].join(' ')}>
                          {format(new Date(date + 'T12:00:00'), 'MMM d, yyyy')}
                        </td>
                        {rowVals.map((val, ei) => (
                          <td
                            key={icEntities[ei].id}
                            className="px-2 py-1.5 text-right font-mono-num tabular-nums border-border"
                            title={val != null ? `Raw meter reading: ${val.toLocaleString(undefined, { maximumFractionDigits: 3 })} m³` : undefined}
                          >
                            {val != null
                              ? <span className="text-foreground">{fmtVal(val, 2, 2)}</span>
                              : <span className="text-muted-foreground/40">—</span>}
                          </td>
                        ))}
                        <td
                          className={[
                            'sticky right-0 z-10 px-3 py-1.5 text-right font-semibold font-mono-num tabular-nums text-2xs border-l border-border',
                            isEven ? 'bg-background' : 'bg-muted/10',
                            coverageColor,
                          ].join(' ')}
                          title={`${reported} of ${total} entities reported on this date`}
                        >
                          {reported > 0 ? `${reported}/${total}` : <span className="text-muted-foreground/40">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          );
        })()}
      </div>
    );
  }

  // tab === 'current'
  const crEntities = currentPivotData.entities;
  const crDates    = currentPivotData.dates;
  const crPivot    = currentPivotData.pivot;

  if (crEntities.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
        No entities found for current readings.
      </div>
    );
  }
  if (crDates.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
        No readings in this date range.
      </div>
    );
  }

  const entityLatest: (number | null)[] = crEntities.map((e: any) => {
    let latest: number | null = null;
    for (const d of [...crDates].reverse()) {
      const v = crPivot.get(d)?.get(e.id);
      if (v != null) { latest = v; break; }
    }
    return latest;
  });

  return (
    <div className="flex-1 overflow-auto min-h-0">
      <table className="min-w-full text-xs border-collapse" data-testid="dsm-current-table">
        <thead>
          <tr className="bg-muted/95 backdrop-blur-sm">
            <th className="sticky top-0 left-0 z-30 bg-muted/95 px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap border-b border-r border-border min-w-[110px]">Date</th>
            {crEntities.map((e: any, i: number) => {
              const isRoTrain = currentSide === 'production' && e._source === 'ro';
              const label    = isRoTrain ? `RO${e.train_number ?? i + 1}` : (e.name ?? e.code ?? `#${i + 1}`);
              const sublabel = plantCodeById.get(e.plant_id) ?? '';
              return (
                <th
                  key={e.id}
                  className="sticky top-0 z-20 bg-muted/95 px-2 py-2 text-center font-semibold text-muted-foreground whitespace-nowrap border-b border-border min-w-[110px]"
                  title={`${sublabel}${sublabel ? ' · ' : ''}${isRoTrain ? `Train ${e.train_number}` : (e.name ?? e.code ?? e.id)}`}
                >
                  <div className="truncate max-w-[120px] mx-auto">{label}</div>
                  {sublabel && (
                    <div className="text-3xs font-normal text-muted-foreground/70 truncate">{sublabel}</div>
                  )}
                </th>
              );
            })}
            <th className="sticky top-0 right-0 z-30 bg-primary-soft/95 px-3 py-2 text-right font-bold text-primary whitespace-nowrap border-b border-l border-border min-w-[80px]">Coverage</th>
          </tr>

          <tr className="bg-primary-soft/60">
            <td className="sticky top-0 left-0 z-30 bg-primary-soft/60 px-3 py-1.5 text-2xs font-bold text-primary whitespace-nowrap border-b border-r border-border">LATEST</td>
            {entityLatest.map((val, i) => (
              <td
                key={crEntities[i].id}
                className="px-2 py-1.5 text-center text-2xs font-semibold font-mono-num tabular-nums text-primary border-b border-border"
              >
                {val != null
                  ? val.toLocaleString(undefined, { maximumFractionDigits: 2 })
                  : <span className="text-muted-foreground/40">—</span>}
              </td>
            ))}
            <td className="sticky right-0 z-30 bg-primary-soft/60 px-3 py-1.5 text-right text-2xs font-bold text-primary border-b border-l border-border tabular-nums">
              {crEntities.length} entities
            </td>
          </tr>
        </thead>

        <tbody>
          {[...crDates].reverse().map((date: string, di: number) => {
            const isEven      = di % 2 === 0;
            const rowVals     = crEntities.map((e: any) => crPivot.get(date)?.get(e.id) ?? null);
            const reported    = rowVals.filter((v) => v != null).length;
            const total       = crEntities.length;
            const coveragePct = total > 0 ? Math.round((reported / total) * 100) : 0;
            const coverageColor =
              coveragePct === 100 ? 'text-accent' :
              coveragePct >= 50   ? 'text-warn'    :
                                    'text-danger';

            return (
              <tr
                key={date}
                className={isEven ? 'bg-background hover:bg-muted/20' : 'bg-muted/10 hover:bg-muted/30'}
              >
                <td className={[
                  'sticky left-0 z-10 px-3 py-1.5 font-medium text-muted-foreground whitespace-nowrap border-r border-border',
                  isEven ? 'bg-background' : 'bg-muted/10',
                ].join(' ')}>
                  {format(new Date(date + 'T12:00:00'), 'MMM d, yyyy')}
                </td>

                {rowVals.map((val, ei) => (
                  <td
                    key={crEntities[ei].id}
                    className="px-2 py-1.5 text-right font-mono-num tabular-nums border-border"
                    title={val != null ? `Raw meter reading: ${val.toLocaleString(undefined, { maximumFractionDigits: 3 })} m³` : undefined}
                  >
                    {val != null
                      ? <span className="text-foreground">{fmtVal(val, 2, 2)}</span>
                      : <span className="text-muted-foreground/40">—</span>}
                  </td>
                ))}

                <td
                  className={[
                    'sticky right-0 z-10 px-3 py-1.5 text-right font-semibold font-mono-num tabular-nums text-2xs border-l border-border',
                    isEven ? 'bg-background' : 'bg-muted/10',
                    coverageColor,
                  ].join(' ')}
                  title={`${reported} of ${total} entities reported on this date`}
                >
                  {reported > 0 ? `${reported}/${total}` : <span className="text-muted-foreground/40">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
