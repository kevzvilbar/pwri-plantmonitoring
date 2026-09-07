import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ComputedInput } from '@/components/ComputedInput';

export interface TDSRowProps {
  f: (key: string) => { value: string; onChange: (e: any) => void };
  rejection: number | null;
  saltPassage: number | null;
}

export function TDSRow({ f, rejection, saltPassage }: TDSRowProps) {
  return (
    <div className="space-y-0.5">
      <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/70 px-0.5">TDS (ppm)</p>
      <div className="grid grid-cols-3 gap-2">
        <div><Label htmlFor="pretreat-feed-tds" className="text-xs text-muted-foreground">Feed TDS</Label><Input type="number" step="any" {...f('feed_tds')} id="pretreat-feed-tds"/></div>
        <div><Label htmlFor="pretreat-permeate-tds" className="text-xs text-muted-foreground">Permeate TDS</Label><Input type="number" step="any" {...f('permeate_tds')} id="pretreat-permeate-tds"/></div>
        <div><Label htmlFor="pretreat-reject-tds" className="text-xs text-muted-foreground">Reject TDS</Label><Input type="number" step="any" {...f('reject_tds')} id="pretreat-reject-tds"/></div>
      </div>
      <div className="grid grid-cols-2 gap-2 pt-1">
        <div>
          <Label htmlFor="pretreat-salt-rejection" className="text-xs text-muted-foreground">Salt Rejection %</Label>
          <ComputedInput value={rejection ?? ''} className="text-foreground font-medium" id="pretreat-salt-rejection"/>
        </div>
        <div>
          <Label htmlFor="pretreat-salt-passage" className="text-xs text-muted-foreground">Salt Passage %</Label>
          <ComputedInput value={saltPassage ?? ''} className="text-foreground font-medium" id="pretreat-salt-passage"/>
        </div>
      </div>
    </div>
  );
}
