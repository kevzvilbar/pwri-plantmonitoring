import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ComputedInput } from '@/components/ComputedInput';
import { PerUnitReasonRow } from '../PerUnitReasonRow';
import { RO_REASON_OPTIONS } from '../../types';

export interface TDSRowProps {
  f: (key: string) => { value: string; onChange: (e: any) => void };
  rejection: number | null;
  saltPassage: number | null;
  roReasonNeeded?: boolean;
  roEntryReasons?: Record<string, { reason: string; custom: string }>;
  onReasonChange?: (key: string, reason: string) => void;
  onCustomReasonChange?: (key: string, custom: string) => void;
  onApplyAll?: (sourceKey: string) => void;
}

export function TDSRow({
  f,
  rejection,
  saltPassage,
  roReasonNeeded,
  roEntryReasons,
  onReasonChange,
  onCustomReasonChange,
  onApplyAll,
}: TDSRowProps) {
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
      {roReasonNeeded && (
        <div className="space-y-2 mt-2">
          {!f('feed_tds').value && (
            <PerUnitReasonRow
              unitLabel="Feed TDS"
              options={RO_REASON_OPTIONS}
              value={roEntryReasons?.['feed_tds']?.reason}
              customValue={roEntryReasons?.['feed_tds']?.custom}
              onChange={(val) => onReasonChange?.('feed_tds', val)}
              onCustomChange={(val) => onCustomReasonChange?.('feed_tds', val)}
              onApplyAll={() => onApplyAll?.('feed_tds')}
              applyAllLabel="Apply reason to all missing fields"
            />
          )}
          {!f('permeate_tds').value && (
            <PerUnitReasonRow
              unitLabel="Permeate TDS"
              options={RO_REASON_OPTIONS}
              value={roEntryReasons?.['permeate_tds']?.reason}
              customValue={roEntryReasons?.['permeate_tds']?.custom}
              onChange={(val) => onReasonChange?.('permeate_tds', val)}
              onCustomChange={(val) => onCustomReasonChange?.('permeate_tds', val)}
              onApplyAll={() => onApplyAll?.('permeate_tds')}
              applyAllLabel="Apply reason to all missing fields"
            />
          )}
          {!f('reject_tds').value && (
            <PerUnitReasonRow
              unitLabel="Reject TDS"
              options={RO_REASON_OPTIONS}
              value={roEntryReasons?.['reject_tds']?.reason}
              customValue={roEntryReasons?.['reject_tds']?.custom}
              onChange={(val) => onReasonChange?.('reject_tds', val)}
              onCustomChange={(val) => onCustomReasonChange?.('reject_tds', val)}
              onApplyAll={() => onApplyAll?.('reject_tds')}
              applyAllLabel="Apply reason to all missing fields"
            />
          )}
        </div>
      )}
    </div>
  );
}
