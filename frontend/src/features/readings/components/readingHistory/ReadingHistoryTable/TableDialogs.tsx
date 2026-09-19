/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { HistoryCascadeConfirmDialog } from '../HistoryCascadeConfirmDialog';
import { ReplaceMeterDialog } from '@/pages/plants/locators/LocatorDialogs';
import { PowerMeterChangeForm } from '@/pages/plants/config/sections/PowerMeterChangeForm';
import { MeterReplacementDetailDialog } from '../MeterReplacementDetailDialog';
import { useMeterReplacementDetail } from '../useMeterReplacementDetail';
import { replacementToInitial } from '../replacementEdit';
import type { ReplacementDetailHost, ReplacementTarget } from '../replacementTypes';
import { invalidateLocatorDash, invalidateWellDash, invalidatePowerDash } from '@/pages/operations/shared';

interface TableDialogsProps {
  actions: any;
  module: string;
  entityId: string;
  entityName?: string;
  plantId?: string;
  assetMeterSerial?: string | null;
  queryKey: any[];
  qc: any;
  gridMeterNames?: string[];
  gridMeterCount?: number;
  gridMultipliers?: number[];
  multiplier?: number;
  meterFilter?: { type: 'solar'; idx: number } | { type: 'grid'; idx: number } | null;
}

export function TableDialogs({
  actions, module, entityId, entityName, plantId, assetMeterSerial, queryKey, qc,
  gridMeterNames = [], gridMeterCount = 1, gridMultipliers = [], multiplier = 1, meterFilter = null,
}: TableDialogsProps) {
  const [editInitial, setEditInitial] = React.useState<any | null>(null);
  const [editPowerInitial, setEditPowerInitial] = React.useState<any | null>(null);

  const detailRow = actions.detailRow ?? null;
  const kind: ReplacementTarget['kind'] =
    module === 'well' ? 'well' : module === 'locator' ? 'locator' : module === 'power' ? 'power' : 'blending';
  const detailTarget: ReplacementTarget | null = detailRow ? {
    kind,
    readingId: detailRow.id ?? null,
    entityId,
    plantId: plantId ?? null,
    meterIndex: module === 'power'
      ? (meterFilter?.type === 'grid' ? meterFilter.idx : (actions.detailGridIdx ?? 0))
      : null,
    entityName: entityName ?? null,
    readingDatetime: detailRow.reading_datetime ?? detailRow.event_date ?? detailRow.noted_at ?? null,
  } : null;
  const { records, isLoading } = useMeterReplacementDetail(detailTarget);
  const host: ReplacementDetailHost | null = detailTarget ? {
    target: detailTarget,
    settingsHref: plantId ? `/plants/${plantId}` : null,
    canEdit: kind !== 'blending',
  } : null;

  const onDetailEdit = (rec: any | null) => {
    if (module === 'power') {
      if (!rec) { actions.closeReplacementDetail(); return; }
      setEditPowerInitial(replacementToInitial(rec));
      return;
    }
    if (module === 'well' || module === 'locator') {
      if (!rec) { actions.closeReplacementDetail(); actions.setReplaceReadingId(detailRow?.id ?? null); return; }
      setEditInitial(replacementToInitial(rec));
    }
  };

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
            qc.invalidateQueries({ queryKey });
            if (module === 'well') invalidateWellDash(qc, [entityId]);
            else if (module === 'locator') invalidateLocatorDash(qc, [entityId]);
          }}
          onClose={() => actions.setReplaceReadingId(null)}
        />
      )}
      <MeterReplacementDetailDialog
        host={host} records={records} isLoading={isLoading}
        onClose={actions.closeReplacementDetail} onEdit={onDetailEdit}
      />
      {editInitial && (module === 'well' || module === 'locator') && (
        <ReplaceMeterDialog
          kind={module}
          assetId={entityId}
          plantId={plantId ?? ''}
          oldSerial={assetMeterSerial ?? null}
          readingId={detailRow?.id ?? undefined}
          initial={editInitial}
          onSuccess={() => {
            setEditInitial(null);
            actions.closeReplacementDetail();
            qc.invalidateQueries({ queryKey });
            qc.invalidateQueries({ queryKey: ['meter-replacement-detail'] });
            if (module === 'well') invalidateWellDash(qc, [entityId]);
            else invalidateLocatorDash(qc, [entityId]);
          }}
          onClose={() => setEditInitial(null)}
        />
      )}
      {editPowerInitial && module === 'power' && (
        <PowerMeterChangeForm
          plant={{ id: plantId ?? entityId }}
          gridMeterCount={Math.max(1, gridMeterCount)}
          gridMeterNames={gridMeterNames}
          currentMultipliers={Array.isArray(gridMultipliers) && gridMultipliers.length ? gridMultipliers : [multiplier]}
          readingId={detailRow?.id}
          initialMeterIndex={detailTarget?.meterIndex ?? 0}
          initial={editPowerInitial}
          onSuccess={() => {
            setEditPowerInitial(null);
            actions.closeReplacementDetail();
            qc.invalidateQueries({ queryKey });
            qc.invalidateQueries({ queryKey: ['meter-replacement-detail'] });
            invalidatePowerDash(qc);
          }}
          onClose={() => setEditPowerInitial(null)}
        />
      )}
    </>
  );
}
