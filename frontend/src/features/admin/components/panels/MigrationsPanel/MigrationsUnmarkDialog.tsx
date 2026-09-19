import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface MigrationsUnmarkDialogProps {
  unmarkTarget: string | null;
  onUnmarkApplied: (filename: string) => void;
  onClose: () => void;
}

export function MigrationsUnmarkDialog({ unmarkTarget, onUnmarkApplied, onClose }: MigrationsUnmarkDialogProps) {
  return (
    <AlertDialog open={!!unmarkTarget} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove applied mark?</AlertDialogTitle>
          <AlertDialogDescription>
            Remove the applied mark for <strong>{unmarkTarget}</strong>? It will show as
            pending again until re-marked or the schema probe detects it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => unmarkTarget && onUnmarkApplied(unmarkTarget)}>
            Remove mark
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
