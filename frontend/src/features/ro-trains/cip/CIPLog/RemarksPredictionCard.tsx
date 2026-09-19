import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export function RemarksPredictionCard({
  remarks,
  setRemarks,
  comparisonPct,
  liveCost,
}: {
  remarks: string;
  setRemarks: (val: string) => void;
  comparisonPct: string | null;
  liveCost: number;
}) {
  return (
    <Card className="p-3 space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">Remarks & Prediction</h4>
      <div>
        <Label htmlFor="ciplog-remarks" className="text-xs text-muted-foreground">Remarks</Label>
        <Textarea value={remarks} onChange={e => setRemarks(e.target.value)}
          placeholder="Any observations..." className="text-xs min-h-[60px] resize-none" id="ciplog-remarks"/>
      </div>
      <div className="rounded-lg border border-accent bg-accent-soft/60 p-2 space-y-0.5">
        <p className="text-2xs font-semibold text-accent uppercase tracking-wide">
          Predicted Recovery Post-CIP:
        </p>
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-bold text-accent">+3% est.</span>
          <span className="text-accent text-base">↑</span>
        </div>
      </div>
    </Card>
  );
}