/* eslint-disable @typescript-eslint/no-explicit-any */
import { format } from 'date-fns';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ImportROReadingsDialog } from '../ImportROReadingsDialog';
import { ImportPretreatReadingsDialog } from '../ImportPretreatReadingsDialog';
import { EditRoReadingDialog } from '../EditRoReadingDialog';
import { EditPretreatReadingDialog } from '../EditPretreatReadingDialog';
import { CorrectionRequestDialog, type CorrectionTarget } from '@/components/CorrectionRequestDialog';
import { ReplaceTrainMeterDialog } from '../ReplaceTrainMeterDialog';
import { MeterReplacementDetailDialog } from '@/components/readingHistory/MeterReplacementDetailDialog';
import { replacementToInitial } from '@/components/readingHistory/replacementEdit';
import type { ReplacementDetailHost } from '@/components/readingHistory/replacementTypes';
import { ReasonDialog } from '@/components/ReasonDialog';
import type { StrayReadingShift } from '@/lib/trainStatusTimeline';

interface TrainLogSubDialogsProps {
  plantId: string;
  trainId: string;
  trainLabel: string;
  activeOperator: { id?: string } | null;
  queryKey: any[];
  preQueryKey: any[];
  showImportRO: boolean;
  setShowImportRO: (v: boolean) => void;
  showImportPretreat: boolean;
  setShowImportPretreat: (v: boolean) => void;
  editingRoRow: any;
  setEditingRoRow: (v: any) => void;
  editingPretreatRow: any;
  setEditingPretreatRow: (v: any) => void;
  correctionTarget: CorrectionTarget | null;
  setCorrectionTarget: (v: CorrectionTarget | null) => void;
  replaceReadingId: string | null;
  setReplaceReadingId: (v: string | null) => void;
  detailHost: ReplacementDetailHost | null;
  detailRecords: any[];
  detailLoading: boolean;
  detailRow: any;
  setDetailRow: (v: any) => void;
  replacementInitial: any;
  setReplacementInitial: (v: any) => void;
  gapDialogTarget: { gap: any; sourceTable: 'ro_train_readings' | 'ro_pretreatment_readings' } | null;
  setGapDialogTarget: (v: any) => void;
  gapDialogBusy: boolean;
  submitGapReason: (category: string, detail: string) => Promise<void>;
  uptimeReportTarget: any;
  setUptimeReportTarget: (v: any) => void;
  reportingBanner: boolean;
  submitUptimeReport: (category: string, detail: string) => Promise<void>;
  uptimeReportCategories?: readonly any[] | any[];
  timingFixTarget: { segment: any; plan: StrayReadingShift[] } | null;
  setTimingFixTarget: (v: any) => void;
  fixingTimings: boolean;
  submitTimingFix: (category: string, detail: string) => Promise<void>;
  timingFixCategories?: readonly any[] | any[];
  pendingDelete: { type: 'ro' | 'pretreat'; row: any } | null;
  setPendingDelete: (v: any) => void;
  doDeleteReading: () => Promise<void>;
}

export function TrainLogSubDialogs({
  plantId,
  trainId,
  trainLabel,
  activeOperator,
  queryKey,
  preQueryKey,
  showImportRO,
  setShowImportRO,
  showImportPretreat,
  setShowImportPretreat,
  editingRoRow,
  setEditingRoRow,
  editingPretreatRow,
  setEditingPretreatRow,
  correctionTarget,
  setCorrectionTarget,
  replaceReadingId,
  setReplaceReadingId,
  detailHost,
  detailRecords,
  detailLoading,
  detailRow,
  setDetailRow,
  replacementInitial,
  setReplacementInitial,
  gapDialogTarget,
  setGapDialogTarget,
  gapDialogBusy,
  submitGapReason,
  uptimeReportTarget,
  setUptimeReportTarget,
  reportingBanner,
  submitUptimeReport,
  uptimeReportCategories,
  timingFixTarget,
  setTimingFixTarget,
  fixingTimings,
  submitTimingFix,
  timingFixCategories,
  pendingDelete,
  setPendingDelete,
  doDeleteReading,
}: TrainLogSubDialogsProps) {
  const qc = useQueryClient();

  return (
    <>
      {showImportRO && (
        <ImportROReadingsDialog
          plantId={plantId}
          userId={activeOperator?.id ?? null}
          trainId={trainId}
          trainLabel={trainLabel}
          onClose={() => setShowImportRO(false)}
          onImported={() => {
            setShowImportRO(false);
            qc.invalidateQueries({ queryKey });
            qc.invalidateQueries({ queryKey: ['ro-overview'] });
          }}
        />
      )}
      {showImportPretreat && (
        <ImportPretreatReadingsDialog
          plantId={plantId}
          userId={activeOperator?.id ?? null}
          trainId={trainId}
          trainLabel={trainLabel}
          onClose={() => setShowImportPretreat(false)}
          onImported={() => {
            setShowImportPretreat(false);
            qc.invalidateQueries({ queryKey: preQueryKey });
            qc.invalidateQueries({ queryKey: ['ro-overview'] });
          }}
        />
      )}
      {editingRoRow && (
        <EditRoReadingDialog
          row={editingRoRow}
          trainId={trainId}
          onClose={() => setEditingRoRow(null)}
          onSaved={() => {
            setEditingRoRow(null);
            qc.invalidateQueries({ queryKey });
            qc.invalidateQueries({ queryKey: ['ro-overview'] });
          }}
        />
      )}
      {editingPretreatRow && (
        <EditPretreatReadingDialog
          row={editingPretreatRow}
          trainId={trainId}
          onClose={() => setEditingPretreatRow(null)}
          onSaved={() => {
            setEditingPretreatRow(null);
            qc.invalidateQueries({ queryKey: preQueryKey });
            qc.invalidateQueries({ queryKey: ['ro-overview'] });
          }}
        />
      )}
      {correctionTarget && (
        <CorrectionRequestDialog
          target={correctionTarget}
          onClose={() => setCorrectionTarget(null)}
          onSubmitted={() => {
            setCorrectionTarget(null);
            qc.invalidateQueries({ queryKey });
            qc.invalidateQueries({ queryKey: preQueryKey });
          }}
        />
      )}
      {replaceReadingId && (
        <ReplaceTrainMeterDialog
          trainId={trainId}
          plantId={plantId}
          readingId={replaceReadingId}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey });
            qc.invalidateQueries({ queryKey: ['ro-overview'] });
            qc.invalidateQueries({ queryKey: ['meter-replacement-detail'] });
          }}
          onClose={() => setReplaceReadingId(null)}
        />
      )}
      <MeterReplacementDetailDialog
        host={detailHost}
        records={detailRecords}
        isLoading={detailLoading}
        onClose={() => setDetailRow(null)}
        onEdit={(rec) => {
          if (!rec) {
            setDetailRow(null);
            setReplaceReadingId(detailRow?.id ?? null);
            return;
          }
          setReplacementInitial(replacementToInitial(rec));
        }}
      />
      {replacementInitial && (
        <ReplaceTrainMeterDialog
          trainId={trainId}
          plantId={plantId}
          readingId={detailRow?.id ?? undefined}
          initial={replacementInitial}
          onSuccess={() => {
            setReplacementInitial(null);
            setDetailRow(null);
            qc.invalidateQueries({ queryKey });
            qc.invalidateQueries({ queryKey: ['ro-overview'] });
            qc.invalidateQueries({ queryKey: ['meter-replacement-detail'] });
          }}
          onClose={() => setReplacementInitial(null)}
        />
      )}
      {gapDialogTarget && (
        <ReasonDialog
          open={!!gapDialogTarget}
          onOpenChange={(o) => { if (!o) setGapDialogTarget(null); }}
          title={`${gapDialogTarget.gap.missedHours} hr${gapDialogTarget.gap.missedHours === 1 ? '' : 's'} missing`}
          description={
            `No ${gapDialogTarget.sourceTable === 'ro_train_readings' ? 'RO Train' : 'Pre-Treatment'} reading was logged `
            + `from ${format(new Date(gapDialogTarget.gap.gapStartAt), 'MMM d, HH:mm')} to `
            + `${format(new Date(new Date(gapDialogTarget.gap.gapEndAt).getTime() - 1), 'HH:mm')} while the train was Running. `
            + `Why was this hour missed?`
          }
          confirmLabel="Log reason"
          busy={gapDialogBusy}
          onConfirm={submitGapReason}
        />
      )}
      {uptimeReportTarget && (
        <ReasonDialog
          open={!!uptimeReportTarget}
          onOpenChange={(o) => { if (!o && !reportingBanner) setUptimeReportTarget(null); }}
          title="Report Running — readings not encoded"
          description={
            `Attest that Train ${trainLabel} was actually running the whole time and the auto-offline flag `
            + `(started ${format(new Date(uptimeReportTarget.startAt), 'MMM d, HH:mm')}) is a false positive `
            + `because readings weren't encoded. `
            + (uptimeReportTarget.endAt === null
              ? 'This removes the flag and puts the train back to Running. '
              : "This corrects the closed period in the record without changing the train's current status. ")
            + `The attestation is logged with your name.`
          }
          confirmLabel="File attestation"
          busy={reportingBanner}
          categories={uptimeReportCategories}
          onConfirm={submitUptimeReport}
        />
      )}
      {timingFixTarget && (
        <ReasonDialog
          open={!!timingFixTarget}
          onOpenChange={(o) => { if (!o && !fixingTimings) setTimingFixTarget(null); }}
          title="Move readings out of the Offline window?"
          description={
            `${timingFixTarget.plan.length} reading${timingFixTarget.plan.length === 1 ? '' : 's'} will move `
            + timingFixTarget.plan
              .map((s) => `${format(new Date(s.from), 'MMM d, HH:mm')} → ${format(new Date(s.to), 'HH:mm')}`)
              .join(' · ')
            + `. Meter deltas are recalculated and the move is audit-logged with your reason. `
            + `The confirmed status log is not changed.`
          }
          confirmLabel="Move readings"
          busy={fixingTimings}
          categories={timingFixCategories}
          onConfirm={submitTimingFix}
        />
      )}
      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this reading?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the {pendingDelete?.type === 'ro' ? 'RO train' : 'pre-treatment'} reading.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={doDeleteReading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

