import { useState } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { CorrectionReasonField } from '@/components/CorrectionReasonField';
import { resolveReason, isReasonComplete } from '@/lib/correctionReasons';

// Used to manually override a derived (is_derived) locator's computed value
// — e.g. Hamas at SRP — for a Manager / Data Analyst / Admin. A reason is
// required so the override shows up meaningfully in reading_edit_audit_log
// rather than as an unexplained number change. Was a free-text Textarea;
// now the same CORRECTION_REASONS dropdown every other reading-edit surface
// uses, so an override rolls up into the same reason taxonomy instead of
// being the one place that still took arbitrary prose. See LocatorSection.tsx's
// is_derived block for the caller, and fn_sweep_derived_meters() /
// fn_flag_derived_review() in supabase/migrations/20260727_hamas_phase*.sql
// for what happens to this value afterward (it can be superseded by a later
// sweep if sibling/mother-meter data changes again — the caller should make
// that clear in `description`).
export function DerivedMeterOverrideDialog({
  open, onOpenChange, locatorName, currentValue, busy, onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locatorName: string;
  currentValue: number | null;
  busy?: boolean;
  onConfirm: (value: number, reason: string) => void | Promise<void>;
}) {
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [customReason, setCustomReason] = useState('');

  const reset = () => { setValue(''); setReason(''); setCustomReason(''); };
  const parsed = value === '' ? null : Number(value);
  const canConfirm = parsed != null && Number.isFinite(parsed) && isReasonComplete(reason, customReason);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => { if (!o && !busy) { reset(); onOpenChange(false); } }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Override {locatorName}</AlertDialogTitle>
          <AlertDialogDescription>
            This sets today's value by hand instead of waiting for the sweep.
            If a sibling locator or the mother meter changes again for this
            date, the next sweep may recompute and replace this value — you'll
            get a notification if that happens.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="derivedmeteroverridedialog-new-value-m" className="text-xs text-muted-foreground">
              New value (m³) <span className="text-danger">*</span>
            </Label>
            <Input
              type="number" inputMode="decimal" value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={currentValue != null ? `Currently ${currentValue.toFixed(2)}` : 'e.g. 250.00'}
            id="derivedmeteroverridedialog-new-value-m"/>
          </div>
          <CorrectionReasonField
            reason={reason} onReasonChange={setReason}
            customReason={customReason} onCustomReasonChange={setCustomReason}
            label="Reason for this override"
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!canConfirm || busy}
            onClick={async (e) => {
              e.preventDefault();
              if (!canConfirm || parsed == null) return;
              await onConfirm(parsed, resolveReason(reason, customReason));
              reset();
            }}
          >
            {busy ? 'Saving…' : 'Save override'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
