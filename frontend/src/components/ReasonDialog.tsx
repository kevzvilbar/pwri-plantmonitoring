import { useState } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { REASON_CATEGORIES } from '@/lib/reasonCodes';

// Shared "why" dialog used by:
//  - marking a Well/Locator/RO Train Offline or Inactive (category required)
//  - logging a "no reading today" gap for an entity that's still Active/Running
// Both write a (category, detail) pair — category from a fixed preset list,
// detail an optional free-text elaboration.

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
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy || !category}
            onClick={async (e) => {
              e.preventDefault();
              if (!category) return;
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
