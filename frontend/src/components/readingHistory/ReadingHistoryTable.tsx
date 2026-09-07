/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { Loader2 } from 'lucide-react';
import { canEditEntry } from '@/pages/ro-trains/helpers';
import { getGridMeterVal, HistoryModule } from './types';
import { HistoryCascadeConfirmDialog } from './HistoryCascadeConfirmDialog';
import { useReadingHistoryActions } from './useReadingHistoryActions';
import { ReadingHistoryEditForm } from './ReadingHistoryEditForm';
import { ReadingHistoryBulkActions } from './ReadingHistoryBulkActions';
import { InfoBanners } from './ReadingHistoryTable/InfoBanners';
import { TableHeader } from './ReadingHistoryTable/TableHeader';
import { TableBody } from './ReadingHistoryTable/TableBody';
import { TableFooter } from './ReadingHistoryTable/TableFooter';
import { TableDialogs } from './ReadingHistoryTable/TableDialogs';

export function ReadingHistoryTable(props: any) {
  const {
    rawRows, isLoading, days, appliedFrom, appliedTo,
    entityName, module, entityId, plantId, assetMeterSerial, multiplier = 1,
    gridMeterCount: gridMeterCountProp = 1, gridMeterNames = [], gridMultipliers = [],
    meterFilter, defaultInputMode = 'raw', solarInputMode = 'raw', queryKey, activeOperator
  } = props;
  const qc = useQueryClient();

  const isDirectMode = (module === 'locator' || module === 'well') && defaultInputMode === 'direct';
  const isSolarDirectMode = module === 'power' && solarInputMode === 'direct';
  const solarDirectVal = (row: any): number | null => {
    const v = row?.daily_solar_kwh ?? row?.solar_meter_reading;
    return v != null ? +v : null;
  };

  const resolvedGridCount = Math.max(1, gridMeterCountProp);
  const getHistGridLabel = (idx: number): string =>
    gridMeterNames[idx] ?? (resolvedGridCount === 1 ? 'Grid Meter' : `Grid Meter ${idx + 1}`);
  const getHistGridMult = (idx: number): number =>
    Array.isArray(gridMultipliers) && +gridMultipliers[idx] > 0
      ? +gridMultipliers[idx]
      : multiplier;

  const rows = useMemo(() => {
    if (!rawRows || rawRows.length === 0) return [];
    const valid: any[] = [];

    const getVal = (row: any): number | null => {
      if (!row) return null;
      if (row.current_reading != null) return +row.current_reading;
      if (row.meter_reading_kwh != null) return +row.meter_reading_kwh;
      if (row.raw_meter_reading != null) return +row.raw_meter_reading;
      return null;
    };

    for (let i = 0; i < rawRows.length; i++) {
      const r = rawRows[i];
      if (r.is_estimated && !r.is_meter_rollover && !r.is_meter_replacement) {
        const cur = getVal(r);
        if (cur != null) {
          const pred = rawRows[i + 1];
          const succ = rawRows[i - 1];

          const predVal = getVal(pred);
          const succVal = getVal(succ);

          const violatesPred = predVal != null && !pred?.is_meter_rollover && !r.is_meter_replacement && cur <= predVal;
          const violatesSucc = succVal != null && !r.is_meter_rollover && !succ?.is_meter_replacement && cur >= succVal;

          if (violatesPred || violatesSucc) {
            continue;
          }
        }
      }
      valid.push(r);
    }

    return valid;
  }, [rawRows]);

  const { isAdmin, isManager, isDataAnalyst, user, activeOperatorId } = useAuth();
  const hasFullAccess = isAdmin || isManager || isDataAnalyst;

  const actions = useReadingHistoryActions({
    module, entityId, plantId, queryKey, qc, rows,
    hasFullAccess, activeOperatorId, user, activeOperator,
    assetMeterSerial, multiplier,
    gridMeterCountProp, gridMeterNames, gridMultipliers,
    defaultInputMode, solarInputMode, isSolarDirectMode,
    meterFilter, solarDirectVal, getGridMeterVal, getHistGridLabel,
  });

  const anyEditable = !!rows?.some((r: any) => canEditEntry(r, hasFullAccess, activeOperatorId));

  return (
    <>
      <ReadingHistoryEditForm
        editRow={actions.editRow} editReason={actions.editReason} editCustomReason={actions.editCustomReason} saving={actions.saving}
        setEditRow={actions.setEditRow} setEditReason={actions.setEditReason} setEditCustomReason={actions.setEditCustomReason}
        cancelEdit={actions.cancelEdit} saveEdit={actions.saveEdit}
        module={module} isDirectMode={isDirectMode} isSolarDirectMode={isSolarDirectMode}
        meterFilter={meterFilter} solarInputMode={solarInputMode}
        getHistGridLabel={getHistGridLabel}
        replaceReadingId={actions.replaceReadingId} setReplaceReadingId={actions.setReplaceReadingId}
        entityId={entityId} plantId={plantId} assetMeterSerial={assetMeterSerial}
        queryKey={queryKey} qc={qc}
      />

      <ReadingHistoryBulkActions
        selectedIds={actions.selectedIds} setSelectedIds={actions.setSelectedIds}
        bulkDeleting={actions.bulkDeleting} bulkDeletePending={actions.bulkDeletePending}
        setBulkDeletePending={actions.setBulkDeletePending}
        handleSelectOne={actions.handleSelectOne} handleSelectAll={actions.handleSelectAll}
        handleBulkDelete={actions.handleBulkDelete}
        anyEditable={anyEditable}
      />

      <InfoBanners
        module={module} isDirectMode={isDirectMode} isSolarDirectMode={isSolarDirectMode}
        meterFilter={meterFilter}
      />

      <div className="overflow-auto max-h-[520px] rounded border text-xs">
        {isLoading ? (
          <div className="flex items-center justify-center p-6 text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : !rows?.length ? (
          <p className="p-4 text-center text-muted-foreground">
            {days === 'custom'
              ? `No readings from ${appliedFrom} → ${appliedTo}`
              : `No readings in the last ${days} days`}
          </p>
        ) : (
          <table className="w-full text-left border-collapse">
            <TableHeader
              module={module} isDirectMode={isDirectMode} anyEditable={anyEditable}
              resolvedGridCount={resolvedGridCount} actions={actions}
              hasFullAccess={hasFullAccess} activeOperatorId={activeOperatorId}
              rows={rows}
            />
            <TableBody
              rows={rows} module={module} isDirectMode={isDirectMode}
              isSolarDirectMode={isSolarDirectMode} solarDirectVal={solarDirectVal}
              anyEditable={anyEditable} hasFullAccess={hasFullAccess}
              activeOperatorId={activeOperatorId} actions={actions}
              getHistGridLabel={getHistGridLabel} getHistGridMult={getHistGridMult}
              resolvedGridCount={resolvedGridCount} meterFilter={meterFilter}
            />
          </table>
        )}
      </div>

      <TableFooter days={days} appliedFrom={appliedFrom} appliedTo={appliedTo} rows={rows} />

      <TableDialogs
        actions={actions} module={module} entityId={entityId} plantId={plantId}
        assetMeterSerial={assetMeterSerial} queryKey={queryKey} qc={qc}
      />
    </>
  );
}
