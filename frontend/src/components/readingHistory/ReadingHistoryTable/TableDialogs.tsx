import React from 'react';
import { HistoryCascadeConfirmDialog } from '../HistoryCascadeConfirmDialog';
import { ReplaceMeterDialog } from '@/pages/plants/locators/LocatorDialogs';
import { invalidateLocatorDash, invalidateWellDash } from '@/pages/operations/shared';

interface TableDialogsProps {
  actions: any;
  module: string;
  entityId: string;
  plantId?: string;
  assetMeterSerial?: string | null;
  queryKey: any[];
  qc: any;
}

export function TableDialogs({ actions, module, entityId, plantId, assetMeterSerial, queryKey, qc }: TableDialogsProps) {
  return (
    <>
      <HistoryCascadeConfirmDialog
        pendingDeleteId={actions.pendingDeleteId} setPendingDeleteId={actions.setPendingDeleteId} deleteRow={actions.handleDelete}
        bulkDeletePending={actions.bulkDeletePending} setBulkDeletePending={actions.setBulkDeletePending} selectedIdsSize={actions.selectedIds.size} bulkDelete={actions.handleBulkDelete}
      />
      {actions.replaceReadingId && (module === 'well' || module === 'locator') && (
        <ReplaceMeterDialog
          kind={module}
          assetId={entityId}
          plantId={plantId ?? ''}
          oldSerial={assetMeterSerial ?? null}
          readingId={actions.replaceReadingId}
          onSuccess={() => {
            actions.setEditRow(prev => (prev && prev.id === actions.replaceReadingId ? { ...prev, isMeterReplacement: true } : prev));
            qc.invalidateQueries({ queryKey });
            if (module === 'well') invalidateWellDash(qc, [entityId]);
            else if (module === 'locator') invalidateLocatorDash(qc, [entityId]);
          }}
          onClose={() => actions.setReplaceReadingId(null)}
        />
      )}
    </>
  );
}
