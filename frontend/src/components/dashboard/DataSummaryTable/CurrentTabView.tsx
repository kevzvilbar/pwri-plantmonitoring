import { format } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';

export interface CurrentTabViewProps {
  crEntities: any[];
  crDates: string[];
  crPivot: Map<string, Map<string, number>>;
  currentSide: 'consumption' | 'production';
  plantCodeById: Map<string, string>;
  isLoading: boolean;
}

function fmtVal(v: number | null | undefined, minimumFractionDigits = 2, maximumFractionDigits = 2) {
  if (v == null || v === 0) return null;
  return v.toLocaleString(undefined, { minimumFractionDigits, maximumFractionDigits });
}

export function CurrentTabView({
  crEntities, crDates, crPivot, currentSide, plantCodeById, isLoading,
}: CurrentTabViewProps) {
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
    for (const d of [...crDates].reverse()) {
      const v = crPivot.get(d)?.get(e.id);
      if (v != null) return v;
    }
    return null;
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
                  ? val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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
