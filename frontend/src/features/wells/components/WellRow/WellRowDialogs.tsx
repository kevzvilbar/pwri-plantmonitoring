import React from 'react';
import { ReadingHistoryDialog } from '@/components/ReadingHistoryDialog';
import { ReplaceMeterDialog } from '@/features/plants/components/locators/LocatorDialogs';
import { ReasonDialog } from '@/components/ReasonDialog';
import { CorrectionRequestDialog, type CorrectionTarget } from '@/components/CorrectionRequestDialog';

interface WellRowDialogsProps {
  showHistory: boolean;
  onCloseHistory: () => void;
  showReplaceMeter: boolean;
  onCloseReplaceMeter: () => void;
  gapDialogOpen: boolean;
  onCloseGapDialog: (v: boolean) => void;
  gapSaving: boolean;
  onSaveGapReason: (category: string, detail: string) => void;
  well: any;
  plantId: string;
  userId: string | undefined;
  reading: string;
  previousMeter: number | null;
  onSetReading: (v: string) => void;
  meterReplacePending: { newInitialReading: number | null; replacementId: string | null } | null;
  onMeterReplacePendingChange: (v: { newInitialReading: number | null; replacementId: string | null } | null) => void;
  correctionTarget: CorrectionTarget | null;
  onCloseCorrectionTarget: () => void;
  onCorrectionSubmitted: () => void;
}

export function WellRowDialogs({
  showHistory, onCloseHistory, showReplaceMeter, onCloseReplaceMeter,
  gapDialogOpen, onCloseGapDialog, gapSaving, onSaveGapReason,
  well, plantId, userId, reading, previousMeter, onSetReading,
  meterReplacePending, onMeterReplacePendingChange,
  correctionTarget, onCloseCorrectionTarget, onCorrectionSubmitted,
}: WellRowDialogsProps) {
  return (
    <>
      {showHistory && (
        <ReadingHistoryDialog
          entityName={well.name}
          module="well"
          entityId={well.id}
          plantId={plantId}
          assetMeterSerial={well.meter_serial}
          onClose={onCloseHistory}
        />
      )}

      {showReplaceMeter && (
        <ReplaceMeterDialog
          kind="well"
          assetId={well.id}
          plantId={plantId}
          oldSerial={well.meter_serial}
          onSuccess={(info) => {
            const pending = info ?? { newInitialReading: null, replacementId: null };
            onMeterReplacePendingChange(pending);
            if (info?.newInitialReading != null && (reading === '' || reading === previousMeter?.toFixed(2))) {
              onSetReading(String(info.newInitialReading));
            }
          }}
          onClose={onCloseReplaceMeter}
        />
      )}

      <ReasonDialog
        open={gapDialogOpen}
        onOpenChange={onCloseGapDialog}
        title={`No reading today for "${well.name}" — why?`}
        description="This explains the gap in Data Summary for today. If a reading comes in later today, it takes priority over this note."
        confirmLabel="Log reason"
        busy={gapSaving}
        onConfirm={(category, detail) => onSaveGapReason(category, detail)}
      />

      {correctionTarget && (
        <CorrectionRequestDialog
          target={correctionTarget}
          onClose={onCloseCorrectionTarget}
          onSubmitted={onCorrectionSubmitted}
        />
      )}
    </>
  );
}
