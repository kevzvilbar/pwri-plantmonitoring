import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ComputedInput } from '@/components/ComputedInput';
import { PerUnitReasonRow } from '../PerUnitReasonRow';
import { RO_REASON_OPTIONS } from '../../types';

export interface PressureRowProps {
  f: (key: string) => { value: string; onChange: (e: any) => void };
  dp: number | null;
  dpAlert: boolean;
  roReasonNeeded?: boolean;
  roEntryReasons?: Record<string, { reason: string; custom: string }>;
  onReasonChange?: (key: string, reason: string) => void;
  onCustomReasonChange?: (key: string, custom: string) => void;
  onApplyAll?: (sourceKey: string) => void;
}

export function PressureRow({
  f,
  dp,
  dpAlert,
  roReasonNeeded,
  roEntryReasons,
  onReasonChange,
  onCustomReasonChange,
  onApplyAll,
}: PressureRowProps) {
  return (
    <div className="space-y-0.5">
      <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/70 px-0.5">Pressure (psi)</p>
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1.5">
          <div>
            <Label htmlFor="pretreat-suction" className="text-xs text-muted-foreground">Suction</Label>
            <Input type="number" step="any" {...f('suction_pressure_psi')}
              placeholder="Suction pressure" className="placeholder:text-2xs placeholder:text-muted-foreground/50" id="pretreat-suction"/>
          </div>
          <div>
            <Label htmlFor="pretreat-feed" className="text-xs text-muted-foreground">Feed</Label>
            <Input type="number" step="any" {...f('feed_pressure_psi')}
              placeholder="Feed pressure" className="placeholder:text-2xs placeholder:text-muted-foreground/50" id="pretreat-feed"/>
          </div>
        </div>
        <div className="flex flex-col justify-end">
          <Label htmlFor="pretreat-p-feed-reject" className="text-xs text-muted-foreground">ΔP (feed − reject)</Label>
          <ComputedInput value={dp ?? ''} className={dpAlert ? 'border-danger text-danger font-semibold' : 'text-foreground font-medium'} id="pretreat-p-feed-reject"/>
        </div>
        <div className="flex flex-col justify-end">
          <Label htmlFor="pretreat-reject" className="text-xs text-muted-foreground">Reject</Label>
          <Input type="number" step="any" {...f('reject_pressure_psi')}
            placeholder="Reject pressure" className="placeholder:text-2xs placeholder:text-muted-foreground/50" id="pretreat-reject"/>
        </div>
      </div>
      {roReasonNeeded && (
        <div className="space-y-2 mt-2">
          {!f('suction_pressure_psi').value && (
            <PerUnitReasonRow
              unitLabel="Suction Pressure"
              options={RO_REASON_OPTIONS}
              value={roEntryReasons?.['suction_pressure_psi']?.reason}
              customValue={roEntryReasons?.['suction_pressure_psi']?.custom}
              onChange={(val) => onReasonChange?.('suction_pressure_psi', val)}
              onCustomChange={(val) => onCustomReasonChange?.('suction_pressure_psi', val)}
              onApplyAll={() => onApplyAll?.('suction_pressure_psi')}
              applyAllLabel="Apply reason to all missing fields"
            />
          )}
          {!f('feed_pressure_psi').value && (
            <PerUnitReasonRow
              unitLabel="Feed Pressure"
              options={RO_REASON_OPTIONS}
              value={roEntryReasons?.['feed_pressure_psi']?.reason}
              customValue={roEntryReasons?.['feed_pressure_psi']?.custom}
              onChange={(val) => onReasonChange?.('feed_pressure_psi', val)}
              onCustomChange={(val) => onCustomReasonChange?.('feed_pressure_psi', val)}
              onApplyAll={() => onApplyAll?.('feed_pressure_psi')}
              applyAllLabel="Apply reason to all missing fields"
            />
          )}
          {!f('reject_pressure_psi').value && (
            <PerUnitReasonRow
              unitLabel="Reject Pressure"
              options={RO_REASON_OPTIONS}
              value={roEntryReasons?.['reject_pressure_psi']?.reason}
              customValue={roEntryReasons?.['reject_pressure_psi']?.custom}
              onChange={(val) => onReasonChange?.('reject_pressure_psi', val)}
              onCustomChange={(val) => onCustomReasonChange?.('reject_pressure_psi', val)}
              onApplyAll={() => onApplyAll?.('reject_pressure_psi')}
              applyAllLabel="Apply reason to all missing fields"
            />
          )}
        </div>
      )}
    </div>
  );
}
