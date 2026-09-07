import { format } from 'date-fns';
import { Gauge } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PivotTabViewProps {
  tab: 'production' | 'consumption';
  dates: string[];
  entities: any[];
  pivot: Map<string, Map<string, number>>;
  estimatedKeys: Set<string>;
  colTotals: number[];
  rowTotals: number[];
  grandTotal: number;
  plantCodeById: Map<string, string>;
}

function fmtVal(v: number | null | undefined, minimumFractionDigits = 1, maximumFractionDigits = 2) {
  if (v == null || v === 0) return null;
  return v.toLocaleString(undefined, { minimumFractionDigits, maximumFractionDigits });
}

function getEntityLabel(e: any, i: number, tab: 'production' | 'consumption') {
  const isRoTrain = tab === 'production' && (e as any)._source === 'ro';
  return isRoTrain
    ? `RO${e.train_number ?? i + 1}`
    : (e.name ?? e.code ?? `#${i + 1}`);
}

function getEntitySublabel(e: any, plantCodeById: Map<string, string>) {
  return plantCodeById.get(e.plant_id) ?? '';
}

function EntityHeader({ e, i, tab, plantCodeById }: { e: any; i: number; tab: string; plantCodeById: Map<string, string> }) {
  const isRoTrain = tab === 'production' && (e as any)._source === 'ro';
  const label = getEntityLabel(e, i, tab as 'production' | 'consumption');
  const sublabel = getEntitySublabel(e, plantCodeById);
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
}

export function PivotTabView({
  tab, dates, entities, pivot, estimatedKeys,
  colTotals, rowTotals, grandTotal, plantCodeById,
}: PivotTabViewProps) {
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
            {entities.map((e, i) => (
              <EntityHeader key={e.id} e={e} i={i} tab={tab} plantCodeById={plantCodeById} />
            ))}
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

      {/* Inline Current Readings section */}
      <InlineCurrentReadings tab={tab} entities={entities} pivot={pivot} plantCodeById={plantCodeById} />
    </div>
  );
}

function InlineCurrentReadings({
  tab, entities, pivot, plantCodeById,
}: {
  tab: 'production' | 'consumption';
  entities: any[];
  pivot: Map<string, Map<string, number>>;
  plantCodeById: Map<string, string>;
}) {
  const dates = [...pivot.keys()];

  const entityLatest: (number | null)[] = entities.map((e: any) => {
    for (const d of [...dates].reverse()) {
      const v = pivot.get(d)?.get(e.id);
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
            {entities.map((e: any, i: number) => {
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
            {entityLatest.map((val, i) => (
              <td
                key={entities[i].id}
                className="px-2 py-1.5 text-center text-2xs font-semibold font-mono-num tabular-nums text-primary border-b border-border"
              >
                {val != null
                  ? val.toLocaleString(undefined, { maximumFractionDigits: 2 })
                  : <span className="text-muted-foreground/40">—</span>}
              </td>
            ))}
            <td className="sticky right-0 z-20 bg-primary-soft/60 px-3 py-1.5 text-right text-2xs font-bold text-primary border-b border-l border-border tabular-nums">
              {entities.length} entities
            </td>
          </tr>
        </thead>

        <tbody>
          {[...dates].reverse().map((date: string, di: number) => {
            const isEven      = di % 2 === 0;
            const rowVals     = entities.map((e: any) => pivot.get(date)?.get(e.id) ?? null);
            const reported    = rowVals.filter((v) => v != null).length;
            const total       = entities.length;
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
                    key={entities[ei].id}
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
}
