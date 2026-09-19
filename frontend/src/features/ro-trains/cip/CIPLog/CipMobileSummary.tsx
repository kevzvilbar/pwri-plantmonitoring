import { Button } from '@/components/ui/button';
import { CIPSummaryContent } from '../CIPSummaryContent';

export function CipMobileSummary({
  submit,
  clearForm,
  liveCost,
  totalMassKg,
  totalVolumeL,
  comparisonPct,
}: {
  submit: () => void;
  clearForm: () => void;
  liveCost: number;
  totalMassKg: number;
  totalVolumeL: number;
  comparisonPct: string | null;
}) {
  return (
    <div className="md:hidden rounded-xl bg-primary text-primary-foreground p-3 space-y-2.5">
      <p className="text-xs font-bold uppercase tracking-wider text-primary-foreground">CIP Summary <span className="text-primary-foreground/60 font-normal">(Live)</span></p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <CIPSummaryContent liveCost={liveCost} totalMassKg={totalMassKg} totalVolumeL={totalVolumeL} comparisonPct={comparisonPct} />
      </div>
      <div className="grid grid-cols-2 gap-2 pt-1">
        <Button variant="ghost" onClick={clearForm} className="h-9 text-xs text-primary-foreground/70 hover:text-primary-foreground hover:bg-black/10 border border-primary-foreground/30">Clear Form</Button>
        <Button onClick={submit} className="h-9 text-xs bg-white text-primary hover:bg-primary-soft font-semibold shadow-none border-0">Save CIP</Button>
      </div>
    </div>
  );
}