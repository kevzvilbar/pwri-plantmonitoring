import { Button } from '@/components/ui/button';
import { ResponsiveAlertDialog } from '@/components/ui/responsive-dialog';

interface MultiplierDialogProps {
  confirmOpen: boolean;
  onOpenChange: (open: boolean) => void;
  currentMultiplier: string;
  pendingMultiplier: string | null;
  onApply: () => void;
  onCancel: () => void;
}

export function MultiplierDialog({
  confirmOpen, onOpenChange,
  currentMultiplier, pendingMultiplier, onApply, onCancel,
}: MultiplierDialogProps) {
  return (
    <ResponsiveAlertDialog
      open={confirmOpen}
      onOpenChange={onOpenChange}
      title="Change Multiplier?"
      description={(
        <>
          The multiplier is changing from <strong>×{currentMultiplier}</strong> to <strong>×{pendingMultiplier}</strong>.
          This should only be done if the CT/PT transformer ratio on the meter has physically changed.
          All future kWh calculations for this plant will use the new value.
        </>
      )}
      footer={(
        <div className="flex gap-2 justify-end w-full">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={onApply}>
            Yes, change multiplier
          </Button>
        </div>
      )}
    >
      {null}
    </ResponsiveAlertDialog>
  );
}
