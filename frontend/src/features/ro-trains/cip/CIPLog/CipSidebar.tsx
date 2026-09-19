import { Button } from '@/components/ui/button';
import { CIPSummaryContent } from '../CIPSummaryContent';

export function CipSidebar({
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
    <div className="hidden md:block w-48 shrink-0">
      <div className="rounded-xl bg-primary text-primary-foreground p-3 space-y-3 sticky top-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-primary-foreground">CIP Summary</p>
          <p className="text-3xs text-primary-foreground/60">(Live Calc)</p>
        </div>
        <div className="space-y-2.5"><CIPSummaryContent liveCost={liveCost} totalMassKg={totalMassKg} totalVolumeL={totalVolumeL} comparisonPct={comparisonPct} /></div>
        <div className="border-t border-primary-foreground/20 pt-2.5 space-y-2">
          <Button onClick={submit} className="w-full h-8 text-xs bg-white text-primary hover:bg-primary-soft font-semibold shadow-none border-0">Save CIP</Button>
          <Button variant="ghost" onClick={clearForm} className="w-full h-8 text-xs text-primary-foreground/70 hover:text-primary-foreground hover:bg-black/10">Clear Form</Button>
        </div>
      </div>
    </div>
  );
}