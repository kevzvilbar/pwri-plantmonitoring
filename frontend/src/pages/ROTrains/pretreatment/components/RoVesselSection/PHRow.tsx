import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface PHRowProps {
  f: (key: string) => { value: string; onChange: (e: any) => void };
  phWarn: boolean;
}

export function PHRow({ f, phWarn }: PHRowProps) {
  return (
    <div className="space-y-0.5">
      <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/70 px-0.5">pH</p>
      <div className="grid grid-cols-3 gap-2">
        <div><Label htmlFor="pretreat-feed-ph" className="text-xs text-muted-foreground">Feed pH</Label><Input type="number" step="any" {...f('feed_ph')} id="pretreat-feed-ph"/></div>
        <div><Label htmlFor="pretreat-permeate-ph" className="text-xs text-muted-foreground">Permeate pH</Label><Input type="number" step="any" {...f('permeate_ph')} className={phWarn ? 'border-warn' : ''} id="pretreat-permeate-ph"/></div>
        <div><Label htmlFor="pretreat-reject-ph" className="text-xs text-muted-foreground">Reject pH</Label><Input type="number" step="any" {...f('reject_ph')} id="pretreat-reject-ph"/></div>
      </div>
    </div>
  );
}
