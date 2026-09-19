import React from 'react';
import { Button } from '@/components/ui/button';
import { ResponsiveAlertDialog } from '@/components/ui/responsive-dialog';
import { AlertCircle } from 'lucide-react';

interface DupConfirmDialogProps {
  open: boolean;
  label: string;
  isDateOnly: boolean;
  onDecision: (decision: 'overwrite' | 'skip', applyToAll?: boolean) => void;
}

export function DupConfirmDialog({ open, label, isDateOnly, onDecision }: DupConfirmDialogProps) {
  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={() => { /* explicit-choice only */ }}
      preventEscapeClose
      title={(
        <span className="flex items-center gap-1.5">
          <AlertCircle className="h-4 w-4 text-warn" /> Duplicate detected
        </span>
      )}
      description={(
        <>
          A reading for "{label}" already exists{' '}
          {isDateOnly ? 'on this date' : 'at this date & time'}.
          Overwrite it, or skip this row?
        </>
      )}
      footer={(
        <div className="flex gap-2 flex-wrap justify-end w-full">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => onDecision('skip', true)}
            title="Skip this and all remaining duplicates"
          >
            Skip All
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => onDecision('skip')}
          >
            Skip
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => onDecision('overwrite', true)}
            title="Overwrite this and all remaining duplicates"
          >
            Overwrite All
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => onDecision('overwrite')}
          >
            Overwrite
          </Button>
        </div>
      )}
    >
      {null}
    </ResponsiveAlertDialog>
  );
}
