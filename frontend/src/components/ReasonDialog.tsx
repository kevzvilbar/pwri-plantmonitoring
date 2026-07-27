import { useState } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { REASON_CATEGORIES, type ReasonCategory } from '@/lib/reasonCodes';

// Shared "why" dialog used by:
//  - marking a Well/Locator/RO Train Offline or Inactive (category required)
//  - logging a "no reading today" gap for an entity that's still Active/Running
// Both write a (category, detail) pair — category from a fixed preset list,
// detail an optional free-text elaboration.

export function ReasonDialog({
  open, onOpenChange, title, description, confirmLabel = 'Confirm', busy, onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: (category: ReasonCategory, detail: string) => void | Promise<void>;
}) {
  const [category, setCategory] = useState<ReasonCategory | ''>('');
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
            <Label className="text-xs text-muted-foreground">
              Reason <span className="text-danger">*</span>
            </Label>
            <Select value={category} onValueChange={(v) => setCategory(v as ReasonCategory)}>
              <SelectTrigger data-testid="reason-category-select">
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {REASON_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Details <span className="text-[10px]">(optional)</span>
            </Label>
            <Textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="e.g. Bearing needs replacement, part on order"
              maxLength={500}
              rows={2}
              data-testid="reason-detail-textarea"
            />
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
