import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { ReplaceTrainMeterDialog } from '../../ro-trains/ReplaceTrainMeterDialog';
import { useOperatorLog } from './TrainOperatorLogModal/useOperatorLog.tsx';
import { OperatorLogTable } from './TrainOperatorLogModal/OperatorLogTable';

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
    dateFrom, setDateFrom,
    dateTo, setDateTo,
    rangePreset, setRangePreset,
    applyPreset,
    logs, isLoading, error, refetch, queryKey,
    totalPages, pageLogs,
    fmtVal, exportCSV,
    toggleMeterReplacement,
  } = useOperatorLog(trainId, trainLabel, plantId);

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
      </DialogContent>
    </Dialog>
  );
}
