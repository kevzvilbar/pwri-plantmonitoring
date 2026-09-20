/**
 * ConfirmBulkDialog — P3-5 of docs/NAV-IA-REMEDIATION-PLAN.md
 *
 * "Acknowledge all" and "Snooze all" used to be a single tap with no
 * confirmation, which is far too easy to hit on a phone in the field. The
 * dialog states exactly how many alerts it will touch.
 *
 * Critical alarms are never bulk-snoozed (D2): when some of the current alerts
 * are critical, the dialog says so and the count excludes them.
 */
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { BellOff, CheckCircle2 } from 'lucide-react';

interface ConfirmBulkDialogProps {
  open: boolean;
  action: 'acknowledge' | 'snooze';
  count: number;
  snoozeLabel: string;
  /** True when critical alerts exist and are excluded from a bulk snooze. */
  criticalExcluded?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

const COPY = {
  acknowledge: {
    title: 'Acknowledge all alerts?',
    verb: 'acknowledge',
    icon: CheckCircle2,
    iconClass: 'text-info',
  },
  snooze: {
    title: 'Snooze all alerts?',
    verb: 'snooze',
    icon: BellOff,
    iconClass: 'text-warn',
  },
} as const;

export function ConfirmBulkDialog({
  open, action, count, snoozeLabel, criticalExcluded = false, onOpenChange, onConfirm,
}: ConfirmBulkDialogProps) {
  const copy = COPY[action];
  const Icon = copy.icon;
  const noun = count === 1 ? 'alert' : 'alerts';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" data-testid="confirm-bulk-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Icon className={`h-4 w-4 ${copy.iconClass}`} />
            {copy.title}
          </DialogTitle>
          <DialogDescription className="text-xs space-y-1.5">
            <span className="block">
              This will <strong>{copy.verb}</strong>{' '}
              <span className="font-mono-num font-bold">{count}</span> {noun} for{' '}
              {action === 'snooze' ? snoozeLabel : 'the audit trail'}.
            </span>
            {action === 'snooze' && criticalExcluded && (
              <span className="block text-warn font-medium">
                Critical alarms are never snoozed in bulk and will keep ringing.
              </span>
            )}
            {action === 'acknowledge' && (
              <span className="block">
                Acknowledged alerts stay on the list, marked with who and when.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={onConfirm} data-testid="confirm-bulk-confirm" className="gap-1.5">
            <Icon className="h-3.5 w-3.5" />
            {copy.verb === 'acknowledge' ? 'Acknowledge' : 'Snooze'} {count}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
