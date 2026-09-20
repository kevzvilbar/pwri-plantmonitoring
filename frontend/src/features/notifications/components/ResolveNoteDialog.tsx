/**
 * ResolveNoteDialog — P3-5 / D2 of docs/NAV-IA-REMEDIATION-PLAN.md
 *
 * "Resolve" on an alert derived from live data needs a required note: the next
 * recompute will see the condition still true, so the note is what tells the
 * next reader *why* it was manually closed and what was done about it. The
 * note is stored on the `alert_events` row (action = 'resolved').
 */
import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { CheckCheck } from 'lucide-react';
import { canResolve } from '../hooks/useAlertEvents';

interface ResolveNoteDialogProps {
  open: boolean;
  count: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: (note: string) => void;
}

export function ResolveNoteDialog({ open, count, onOpenChange, onConfirm }: ResolveNoteDialogProps) {
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) { setNote(''); setTouched(false); }
  }, [open]);

  const valid = canResolve(note);
  const showRequired = touched && !valid;

  const submit = () => {
    setTouched(true);
    if (!valid) return;
    onConfirm(note.trim());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="resolve-note-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <CheckCheck className="h-4 w-4 text-success" />
            Resolve {count === 1 ? 'alert' : `all ${count} alerts`}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Alerts come from live readings, so resolving suppresses re-firing for this
            condition. A note is required so the next shift knows what was done.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="resolve-note" className="text-xs font-semibold">
            Resolution note <span className="text-danger">*</span>
          </Label>
          <Textarea
            id="resolve-note"
            data-testid="resolve-note-input"
            value={note}
            onChange={(e) => { setNote(e.target.value); setTouched(true); }}
            placeholder="e.g. Replaced the Anti-Scalant drum and re-zeroed the feed meter"
            rows={3}
            className="text-xs"
            aria-invalid={showRequired}
          />
          {showRequired && (
            <p className="text-2xs text-danger font-medium">
              A note is required to resolve an alert.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={!valid}
            data-testid="resolve-note-confirm"
            className="gap-1.5"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Resolve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
