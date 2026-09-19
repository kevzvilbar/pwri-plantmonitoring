import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { ReplaceTrainMeterDialog } from '@/pages/ro-trains/ReplaceTrainMeterDialog';
import { useOperatorLog } from './TrainOperatorLogModal/useOperatorLog.tsx';
import { OperatorLogTable } from './TrainOperatorLogModal/OperatorLogTable';
import { MeterReplacementDetailDialog } from '@/components/readingHistory/MeterReplacementDetailDialog';
import { useMeterReplacementDetail } from '@/components/readingHistory/useMeterReplacementDetail';
import { replacementToInitial } from '@/components/readingHistory/replacementEdit';
import type { ReplacementDetailHost } from '@/components/readingHistory/replacementTypes';

export function TrainOperatorLogModal({
  trainId,
  trainLabel,
  plantId,
  onClose,
}: {
  trainId: string;
  trainLabel: string;
  plantId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { isManager } = useAuth();

  const {
    page, setPage, PAGE_SIZE,
    togglingId, setTogglingId,
    replaceReadingId, setReplaceReadingId,
    detailRow, setDetailRow,
    editInitial, setEditInitial,
    dateFrom, setDateFrom,
    dateTo, setDateTo,
    rangePreset, setRangePreset,
    applyPreset,
    logs, isLoading, error, refetch, queryKey,
    totalPages, pageLogs,
    fmtVal, exportCSV,
    toggleMeterReplacement,
  } = useOperatorLog(trainId, trainLabel, plantId);

  const detailTarget = detailRow ? {
    kind: 'train' as const, readingId: detailRow.id ?? null, entityId: trainId,
    plantId: plantId ?? null, entityName: trainLabel ?? null,
    readingDatetime: detailRow.reading_datetime ?? null,
  } : null;
  const { records: detailRecords, isLoading: detailLoading } = useMeterReplacementDetail(detailTarget);
  const detailHost: ReplacementDetailHost | null = detailTarget ? {
    target: detailTarget, settingsHref: plantId ? `/plants/${plantId}` : null, canEdit: isManager,
  } : null;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="max-w-[95vw] w-full max-h-[88vh] flex flex-col gap-0 p-0 overflow-hidden"
        onInteractOutside={(e) => {
          if (replaceReadingId) { e.preventDefault(); return; }
          onClose();
        }}
      >
        <DialogTitle className="sr-only">Operator Log — {trainLabel}</DialogTitle>

        <OperatorLogTable
          trainLabel={trainLabel}
          logs={logs}
          pageLogs={pageLogs}
          isLoading={isLoading}
          error={error}
          togglingId={togglingId}
          isManager={isManager}
          totalPages={totalPages}
          page={page}
          todayStr={format(new Date(), 'yyyy-MM-dd')}
          dateFrom={dateFrom}
          setDateFrom={setDateFrom}
          dateTo={dateTo}
          setDateTo={setDateTo}
          rangePreset={rangePreset}
          setRangePreset={setRangePreset}
          fmtVal={fmtVal}
          onToggleMeterReplacement={toggleMeterReplacement}
          onViewReplacement={(r: any) => setDetailRow(r)}
          onExport={exportCSV}
          onPrevPage={() => setPage(p => p - 1)}
          onNextPage={() => setPage(p => p + 1)}
          onRetry={refetch}
        />

        {replaceReadingId && (
          <ReplaceTrainMeterDialog
            trainId={trainId}
            plantId={plantId}
            readingId={replaceReadingId}
            onSuccess={() => {
              qc.invalidateQueries({ queryKey });
              qc.invalidateQueries({ queryKey: ['dash-ro-recent'] });
              qc.invalidateQueries({ queryKey: ['trend-ro'] });
              qc.invalidateQueries({ queryKey: ['dsm-ro-readings'] });
            }}
            onClose={() => setReplaceReadingId(null)}
          />
        )}
        <MeterReplacementDetailDialog
          host={detailHost} records={detailRecords} isLoading={detailLoading}
          onClose={() => setDetailRow(null)}
          onEdit={(rec) => {
            if (!rec) { setDetailRow(null); setReplaceReadingId(detailRow?.id ?? null); return; }
            setEditInitial({ ...replacementToInitial(rec), rawMeterType: rec.raw?.meter_type ?? null, rawOldSerial: rec.oldSerial ?? null });
          }}
        />
        {editInitial && (
          <ReplaceTrainMeterDialog
            trainId={trainId}
            plantId={plantId}
            readingId={detailRow?.id ?? undefined}
            initial={editInitial}
            onSuccess={() => {
              setEditInitial(null);
              setDetailRow(null);
              qc.invalidateQueries({ queryKey });
              qc.invalidateQueries({ queryKey: ['meter-replacement-detail'] });
            }}
            onClose={() => setEditInitial(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
