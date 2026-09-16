import { useState } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { REASON_CATEGORIES } from '@/lib/reasonCodes';
import { MIN_CUSTOM_REASON_LENGTH, isReasonComplete } from '@/lib/correctionReasons';

// Shared "why" dialog used by:
//  - marking a Well/Locator/RO Train Offline or Inactive (category required)
//  - logging a "no reading today" gap for an entity that's still Active/Running
// Both write a (category, detail) pair — category from a fixed preset list,
// detail an optional free-text elaboration.
//
// The detail really is optional for those status/gap lists (their catch-all is
// lowercase 'other', which isReasonComplete() doesn't branch on), but callers
// that pass a CORRECTION_REASONS-style list — e.g. TrainLogModal's "move
// readings out of the Offline window" dialog, whose 'Other' option is the same
// literal every reading edit uses — get the shared requirement: picking
// 'Other' without describing it leaves Confirm disabled instead of letting a
// bare, unexplained "Other" through. That mirrors the check those same callers
// already re-run inside their onConfirm handler.

export function ReasonDialog({
  open, onOpenChange, title, description, confirmLabel = 'Confirm', busy, onConfirm,
  categories = REASON_CATEGORIES,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: (category: string, detail: string) => void | Promise<void>;
  /** Defaults to REASON_CATEGORIES. Pass LOCK_REASON_CATEGORIES (or any other
   * { value, label }[] list) for a dialog that needs a different reason set —
   * e.g. meter-lock reasons are account/utility causes, not the equipment-
   * failure reasons this dialog was originally built for. */
  categories?: readonly { value: string; label: string }[];
}) {
  const [category, setCategory] = useState<string>('');
  const [detail, setDetail] = useState('');

  const reset = () => { setCategory(''); setDetail(''); };

  // Shared rule (correctionReasons.ts) — same gate the reading-edit dialogs use,
  // so this one can't confirm an unexplained 'Other' either.
  const canConfirm = isReasonComplete(category, detail);
  // Only surface the hint when it is what's actually blocking Confirm — status/
  // gap lists keep an optional detail, so they never render this.
  const needsOtherDetail = !!category && !canConfirm;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => { if (!o && !busy) { reset(); onOpenChange(false); } }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="reasondialog-reason" className="text-xs text-muted-foreground">
              Reason <span className="text-danger">*</span>
            </Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger data-testid="reason-category-select" id="reasondialog-reason">
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reasondialog-details-optional" className="text-xs text-muted-foreground">
              Details <span className="text-2xs">(optional)</span>
            </Label>
            <Textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="e.g. Bearing needs replacement, part on order"
              maxLength={500}
              rows={2}
              data-testid="reason-detail-textarea"
            id="reasondialog-details-optional"/>
            {needsOtherDetail && (
              <p className="text-2xs text-destructive" data-testid="reason-detail-error">
                {detail.trim()
                  ? `Say a bit more — at least ${MIN_CUSTOM_REASON_LENGTH} characters, including a word.`
                  : 'Describe the reason — required when "Other" is selected.'}
              </p>
            )}
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy || !canConfirm}
            onClick={async (e) => {
              e.preventDefault();
              if (!canConfirm) return;
              await onConfirm(category, detail.trim());
              reset();
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
