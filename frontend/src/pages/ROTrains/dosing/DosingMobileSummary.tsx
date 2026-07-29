import { fmtNum } from '@/lib/calculations';

// ─── DosingMobileSummary ── lifted out of ChemicalDosing to avoid remount on every render ─
export function DosingMobileSummary({
  totalMassKg,
  totalVolumeL,
  freePcs,
  cost,
}: {
  totalMassKg: number;
  totalVolumeL: number;
  freePcs: number;
  cost: number;
}) {
  return (
    <>
      <div>
        <p className="text-3xs text-primary-foreground/70 uppercase tracking-wide font-medium">Total Mass (kg):</p>
        <p className="text-xl font-bold font-mono-num leading-tight">{fmtNum(totalMassKg, 2)}</p>
      </div>
      <div>
        <p className="text-3xs text-primary-foreground/70 uppercase tracking-wide font-medium">Total Volume (L):</p>
        <p className="text-base font-bold font-mono-num">{fmtNum(totalVolumeL, 2)}</p>
      </div>
      <div>
        <p className="text-3xs text-primary-foreground/70 uppercase tracking-wide font-medium">Free Cl Test PCS:</p>
        <p className="text-base font-bold font-mono-num">{freePcs}</p>
      </div>
      <div>
        <p className="text-3xs text-primary-foreground/70 uppercase tracking-wide font-medium">Calculated Cost:</p>
        <p className="text-xl font-bold leading-tight">₱ {fmtNum(cost, 2)}</p>
      </div>
    </>
  );
}
