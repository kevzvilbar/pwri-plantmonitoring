import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PerUnitReasonRow } from '../PerUnitReasonRow';
import { RO_REASON_OPTIONS } from '../../types';

export interface PHRowProps {
  f: (key: string) => { value: string; onChange: (e: any) => void };
  phWarn: boolean;
  roReasonNeeded?: boolean;
  roEntryReasons?: Record<string, { reason: string; custom: string }>;
  onReasonChange?: (key: string, reason: string) => void;
  onCustomReasonChange?: (key: string, custom: string) => void;
  onApplyAll?: (sourceKey: string) => void;
}

export function PHRow({
  f,
  phWarn,
  roReasonNeeded,
  roEntryReasons,
  onReasonChange,
  onCustomReasonChange,
  onApplyAll,
}: PHRowProps) {
  return (
    <div className="space-y-0.5">
      <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/70 px-0.5">pH</p>
      <div className="grid grid-cols-3 gap-2">
        <div><Label htmlFor="pretreat-feed-ph" className="text-xs text-muted-foreground">Feed pH</Label><Input type="number" step="any" {...f('feed_ph')} id="pretreat-feed-ph"/></div>
        <div><Label htmlFor="pretreat-permeate-ph" className="text-xs text-muted-foreground">Permeate pH</Label><Input type="number" step="any" {...f('permeate_ph')} className={phWarn ? 'border-warn' : ''} id="pretreat-permeate-ph"/></div>
        <div><Label htmlFor="pretreat-reject-ph" className="text-xs text-muted-foreground">Reject pH</Label><Input type="number" step="any" {...f('reject_ph')} id="pretreat-reject-ph"/></div>
      </div>
      {roReasonNeeded && (
        <div className="space-y-2 mt-2">
          {!f('feed_ph').value && (
            <PerUnitReasonRow
              unitLabel="Feed pH"
              options={RO_REASON_OPTIONS}
              value={roEntryReasons?.['feed_ph']?.reason}
              customValue={roEntryReasons?.['feed_ph']?.custom}
              onChange={(val) => onReasonChange?.('feed_ph', val)}
              onCustomChange={(val) => onCustomReasonChange?.('feed_ph', val)}
              onApplyAll={() => onApplyAll?.('feed_ph')}
              applyAllLabel="Apply reason to all missing fields"
            />
          )}
          {!f('permeate_ph').value && (
            <PerUnitReasonRow
              unitLabel="Permeate pH"
              options={RO_REASON_OPTIONS}
              value={roEntryReasons?.['permeate_ph']?.reason}
              customValue={roEntryReasons?.['permeate_ph']?.custom}
              onChange={(val) => onReasonChange?.('permeate_ph', val)}
              onCustomChange={(val) => onCustomReasonChange?.('permeate_ph', val)}
              onApplyAll={() => onApplyAll?.('permeate_ph')}
              applyAllLabel="Apply reason to all missing fields"
            />
          )}
          {!f('reject_ph').value && (
            <PerUnitReasonRow
              unitLabel="Reject pH"
              options={RO_REASON_OPTIONS}
              value={roEntryReasons?.['reject_ph']?.reason}
              customValue={roEntryReasons?.['reject_ph']?.custom}
              onChange={(val) => onReasonChange?.('reject_ph', val)}
              onCustomChange={(val) => onCustomReasonChange?.('reject_ph', val)}
              onApplyAll={() => onApplyAll?.('reject_ph')}
              applyAllLabel="Apply reason to all missing fields"
            />
          )}
        </div>
      )}
    </div>
  );
}
