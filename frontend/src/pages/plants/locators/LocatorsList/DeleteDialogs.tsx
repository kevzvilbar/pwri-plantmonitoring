import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ReasonField } from '../LocatorDialogs';
import { ReasonDialog } from '@/components/ReasonDialog';
import { Loader2 } from 'lucide-react';
import type { LockReasonCategory } from '@/lib/reasonCodes';
import { LOCK_REASON_CATEGORIES } from '@/lib/reasonCodes';

export function DeleteDialogs({
  deleteTarget,
  setDeleteTarget,
  deleteReason,
  setDeleteReason,
  deleteBusy,
  onDelete,
  locatorOfflineTarget,
  setLocatorOfflineTarget,
  locatorOfflineBusy,
  onStatusChange,
  locatorLockTarget,
  setLocatorLockTarget,
  locatorLockBusy,
  onLockChange,
  selectedSize,
  bulkOpen,
  setBulkOpen,
  bulkReason,
  setBulkReason,
  bulkBusy,
  onBulkDelete,
}: {
  deleteTarget: any;
  setDeleteTarget: (v: any | null) => void;
  deleteReason: string;
  setDeleteReason: (v: string) => void;
  deleteBusy: boolean;
  onDelete: () => void;
  locatorOfflineTarget: any;
  setLocatorOfflineTarget: (v: any | null) => void;
  locatorOfflineBusy: boolean;
  onStatusChange: (locator: any, newStatus: 'Active' | 'Inactive', category: string, detail: string) => void;
  locatorLockTarget: any;
  setLocatorLockTarget: (v: any | null) => void;
  locatorLockBusy: boolean;
  onLockChange: (locator: any, newIsLocked: boolean, category: LockReasonCategory, detail: string) => void;
  selectedSize: number;
  bulkOpen: boolean;
  setBulkOpen: (v: boolean) => void;
  bulkReason: string;
  setBulkReason: (v: string) => void;
  bulkBusy: boolean;
  onBulkDelete: () => void;
}) {
  return (
    <>
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && !deleteBusy && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">Delete "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>All meter readings and replacement logs will be permanently removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <ReasonField value={deleteReason} onChange={setDeleteReason} testId="locator-delete-reason" />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} disabled={deleteBusy || deleteReason.trim().length < 5} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteBusy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ReasonDialog
        open={!!locatorOfflineTarget}
        onOpenChange={(o) => !o && setLocatorOfflineTarget(null)}
        title={`Mark "${locatorOfflineTarget?.name}" Inactive?`}
        description="This locator's status change will explain any gaps in Data Summary while it's inactive."
        confirmLabel="Mark Inactive"
        busy={locatorOfflineBusy}
        onConfirm={async (category, detail) => {
          await onStatusChange(locatorOfflineTarget, 'Inactive', category, detail);
          setLocatorOfflineTarget(null);
        }}
      />

      <ReasonDialog
        open={!!locatorLockTarget}
        onOpenChange={(o) => !o && setLocatorLockTarget(null)}
        title={`Mark "${locatorLockTarget?.name}" meter locked?`}
        description="Reading entry stays open for this locator — any meaningful volume movement while it's marked locked will be flagged for review, not blocked."
        confirmLabel="Mark Locked"
        busy={locatorLockBusy}
        categories={LOCK_REASON_CATEGORIES}
        onConfirm={async (category, detail) => {
          if (!locatorLockTarget) return;
          await onLockChange(locatorLockTarget, true, category as LockReasonCategory, detail);
          setLocatorLockTarget(null);
        }}
      />

      <AlertDialog open={bulkOpen} onOpenChange={(o) => !o && !bulkBusy && setBulkOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-danger">
              Permanently delete {selectedSize} locator(s)?
            </AlertDialogTitle>
            <AlertDialogDescription>
              All meter readings and meter-replacement logs attached to the
              selected locators will be removed via the database cascade rule.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ReasonField value={bulkReason} onChange={setBulkReason} testId="locators-bulk-reason" />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onBulkDelete}
              disabled={bulkBusy || bulkReason.trim().length < 5}
              className="bg-danger text-danger-foreground hover:bg-danger/90"
              data-testid="confirm-locators-bulk-delete"
            >
              {bulkBusy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}