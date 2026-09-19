import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

export interface RemarksSectionProps {
  remarks: string;
  setRemarks: (v: string) => void;
}

export function RemarksSection({ remarks, setRemarks }: RemarksSectionProps) {
  return (
    <div className="p-3 space-y-2">
      <Label htmlFor="pretreat-remarks" className="text-xs text-muted-foreground">Remarks</Label>
      <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Any observations..." id="pretreat-remarks"/>
    </div>
  );
}
