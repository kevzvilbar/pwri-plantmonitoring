import { fmtNum } from '@/lib/calculations';

interface DosingHistoryLogTotalsProps {
  totals: {
    chlorine_kg: number;
    smbs_kg: number;
    anti_scalant_l: number;
    soda_ash_kg: number;
    cost: number;
  };
  recordCount: number;
}

export function DosingHistoryLogTotals({ totals, recordCount }: DosingHistoryLogTotalsProps) {
  return (
    <div className="rounded-xl bg-primary-soft border border-primary p-3 space-y-1.5">
      <p className="text-2xs font-bold uppercase tracking-wider text-primary">
        Period Totals — {recordCount} record{recordCount !== 1 ? 's' : ''}
      </p>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 text-center">
        {totals.chlorine_kg > 0 && (
          <div>
            <p className="text-3xs text-muted-foreground uppercase tracking-wide">Chlorine</p>
            <p className="text-xs font-bold font-mono-num text-primary">{fmtNum(totals.chlorine_kg, 2)} kg</p>
          </div>
        )}
        {totals.smbs_kg > 0 && (
          <div>
            <p className="text-3xs text-muted-foreground uppercase tracking-wide">SMBS</p>
            <p className="text-xs font-bold font-mono-num text-primary">{fmtNum(totals.smbs_kg, 2)} kg</p>
          </div>
        )}
        {totals.anti_scalant_l > 0 && (
          <div>
            <p className="text-3xs text-muted-foreground uppercase tracking-wide">Anti Scalant</p>
            <p className="text-xs font-bold font-mono-num text-primary">{fmtNum(totals.anti_scalant_l, 2)} L</p>
          </div>
        )}
        {totals.soda_ash_kg > 0 && (
          <div>
            <p className="text-3xs text-muted-foreground uppercase tracking-wide">Soda Ash</p>
            <p className="text-xs font-bold font-mono-num text-primary">{fmtNum(totals.soda_ash_kg, 2)} kg</p>
          </div>
        )}
        <div>
          <p className="text-3xs text-muted-foreground uppercase tracking-wide">Total Cost</p>
          <p className="text-xs font-bold font-mono-num text-primary">₱ {fmtNum(totals.cost, 2)}</p>
        </div>
      </div>
    </div>
  );
}
