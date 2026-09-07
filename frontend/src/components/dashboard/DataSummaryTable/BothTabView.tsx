import { format } from 'date-fns';
import { Activity, Droplet, Receipt, Gauge } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

export interface BothTabViewProps {
  allDates: string[];
  prodEntities: any[];
  consEntities: any[];
  activeProdPivot: { pivot: Map<string, Map<string, number>> };
  consPivot: { pivot: Map<string, Map<string, number>> };
  prodGrandTotal: number;
  consGrandTotal: number;
}

function fmtVal(v: number | null | undefined, minimumFractionDigits = 1, maximumFractionDigits = 2) {
  if (v == null || v === 0) return null;
  return v.toLocaleString(undefined, { minimumFractionDigits, maximumFractionDigits });
}

export function BothTabView({
  allDates, prodEntities, consEntities, activeProdPivot, consPivot,
  prodGrandTotal, consGrandTotal,
}: BothTabViewProps) {
  const bothRows = [...allDates].reverse().map((date) => {
    const prod = prodEntities.reduce((s: number, e: any) => s + (activeProdPivot.pivot.get(date)?.get(e.id) ?? 0), 0);
    const cons = consEntities.reduce((s: number, e: any) => s + (consPivot.pivot.get(date)?.get(e.id) ?? 0), 0);
    const bal  = prod - cons;
    const nrw  = prod > 0 ? +((bal / prod) * 100).toFixed(1) : null;
    return { date, prod, cons, bal, nrw };
  });

  const totProd = prodGrandTotal;
  const totCons = consGrandTotal;
  const totBal  = totProd - totCons;
  const totNRW  = totProd > 0 ? +((totBal / totProd) * 100).toFixed(1) : null;

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
