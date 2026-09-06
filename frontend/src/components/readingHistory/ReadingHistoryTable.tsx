/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useMemo } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useQuery } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { friendlyError } from '@/lib/supabaseErrors';
import { useDraft } from '@/hooks/useDraft';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/StatusPill';
import { calc, fmtNum, getCurrentPosition, isOffLocation, ALERTS } from '@/lib/calculations';
import { fmtSaveToast, fmtDate, fmtDateTime } from '@/lib/format';
import { findExistingReading } from '@/lib/duplicateCheck';
import { downloadCSV } from '@/lib/csv';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { MapPin, Pencil, X, Droplet, Zap, Upload, Download, FileText, AlertCircle, Loader2, History, Gauge, FlaskConical, Keyboard } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  GridPylonIcon, invalidateLocatorDash, invalidateWellDash, invalidatePowerDash,
  invalidateRODash, invalidateProductMeterDash,
} from '@/pages/operations/shared';
import { ReplaceMeterDialog } from '@/pages/plants/locators/LocatorDialogs';
import { canEditEntry, logReadingEdit, diffFields } from '@/pages/ro-trains/helpers';
import { HistoryEditState, getGridMeterVal, ReadingHistoryProps, HistoryModule } from './types';
import { HistoryCascadeConfirmDialog } from './HistoryCascadeConfirmDialog';
import { useReadingHistoryActions } from './useReadingHistoryActions';
import { ReadingHistoryEditForm } from './ReadingHistoryEditForm';
import { ReadingHistoryBulkActions } from './ReadingHistoryBulkActions';

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

      {isDirectMode && (
        <div className="flex items-center gap-1.5 rounded-md bg-primary-soft border border-primary/30 px-2.5 py-1.5 text-xs text-primary">
          <Droplet className="h-3 w-3 shrink-0" />
          This entity's input is already a period volume, so there's no Δ to compute — the value below is the volume itself.
        </div>
      )}

      {meterFilter?.type === 'solar' && isSolarDirectMode && (
        <div className="flex items-center gap-1.5 rounded-md bg-warn-soft border border-warn/30 px-2.5 py-1.5 text-xs text-warn">
          <Zap className="h-3 w-3 shrink-0" />
          This plant's solar input is Direct kWh, so there's no Δ to compute — each reading is already that day's power, not a cumulative meter value.
        </div>
      )}

      {/* Table */}
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
            <thead className="bg-muted sticky top-0 z-20 shadow-[0_1px_2px_rgba(0,0,0,0.06)] border-b border-border/60">
              <tr>
                {anyEditable && (
                  <th className="px-2 py-2 w-8">
                    <input type="checkbox"
                      className="h-3.5 w-3.5 accent-primary cursor-pointer"
                      checked={!!rows?.length && actions.selectedIds.size > 0 &&
                        actions.selectedIds.size === rows.filter((r: any) => canEditEntry(r, hasFullAccess, activeOperatorId)).length}
                      onChange={actions.handleSelectAll}
                      title="Select all"
                    />
                  </th>
                )}
                <th className="px-3 py-2 font-medium whitespace-nowrap">Date & Time</th>
                {module === 'locator' && (isDirectMode ? <>
                  <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Volume (m³)</th>
                  <th className="px-2 py-2 font-medium text-center whitespace-nowrap">Repl.</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">Flags</th>
                </> : <>
                  <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Reading</th>
                  <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Δ</th>
                  <th className="px-2 py-2 font-medium text-center whitespace-nowrap">Repl.</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">Flags</th>
                </>)}
                {module === 'well' && (isDirectMode ? <>
                  <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Volume (m³)</th>
                  <th className="px-2 py-2 font-medium text-center whitespace-nowrap">Repl.</th>
                  <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Power (kWh)</th>
                  <th className="px-3 py-2 font-medium text-right whitespace-nowrap">TDS (ppm)</th>
                  <th className="px-3 py-2 font-medium text-right whitespace-nowrap">NTU</th>
                  <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Pressure (psi)</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">Flags</th>
                </> : <>
                  <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Water</th>
                  <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Δ</th>
                  <th className="px-2 py-2 font-medium text-center whitespace-nowrap">Repl.</th>
                  <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Power (kWh)</th>
                  <th className="px-3 py-2 font-medium text-right whitespace-nowrap">TDS (ppm)</th>
                  <th className="px-3 py-2 font-medium text-right whitespace-nowrap">NTU</th>
                  <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Pressure (psi)</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">Flags</th>
                </>)}
                {module === 'blending' && <>
                  <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Reading</th>
                  <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Volume (m³)</th>
                  <th className="px-2 py-2 font-medium text-center whitespace-nowrap">Repl.</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">Flags</th>
                </>}
                {module === 'power' && <>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">Meter</th>
                  <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Reading</th>
                  <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Δ (kWh)</th>
                  <th className="px-2 py-2 font-medium text-center text-muted-foreground whitespace-nowrap">×</th>
                  <th className="px-3 py-2 font-medium text-right text-kpi-grid whitespace-nowrap">Power (kWh)</th>
                  <th className="px-2 py-2 font-medium text-center whitespace-nowrap">Repl.</th>
                </>}
                {anyEditable && <th className="px-2 py-2 font-medium text-center w-16 sticky right-0 top-0 z-30 bg-muted border-l border-border/30 shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.12)] whitespace-nowrap">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any, i: number) => {
                const dt = r.reading_datetime ?? r.event_date ?? r.noted_at ?? '';
                let dateStr: string;
                if (module === 'blending') {
                  if (r.reading_datetime) {
                    dateStr = fmtDateTime(r.reading_datetime);
                  } else if (r.event_date) {
                    dateStr = fmtDate(r.event_date);
                  } else {
                    dateStr = '—';
                  }
                } else {
                  dateStr = dt ? fmtDateTime(dt) : '—';
                }
                const isEditing = actions.editRow?.id === r.id;
                const isDeleting = actions.deletingId === r.id;
                const isToggling = actions.togglingId === r.id;
                const isMeterReplacement = !!r.is_meter_replacement;
                const rowEditable = canEditEntry(r, hasFullAccess, activeOperatorId);
                const predecessor: any = rows[i + 1] ?? null;
                const prevReading = predecessor != null
                  ? +predecessor.current_reading
                  : (r.previous_reading != null ? +r.previous_reading : null);
                const rawDelta = prevReading != null
                  ? calc.dailyVolume(+r.current_reading, prevReading,
                      !!r.is_meter_rollover, r.meter_rollover_max != null ? +r.meter_rollover_max : null)
                  : null;

                const isGridRepl      = !!(r.is_grid_replacement  ?? r.is_meter_replacement);
                const isSolarRepl     = !!(r.is_solar_replacement ?? false);
                const isTogglingGrid  = actions.togglingGridId  === r.id;
                const isTogglingSolar = actions.togglingSolarId === r.id;

                const replCell = (
                  <td className="px-2 py-1.5 text-center">
                    <button
                      title={isMeterReplacement ? 'Meter replacement — click to unmark' : 'Mark as meter replacement (zeroes Δ)'}
                      aria-label={isMeterReplacement ? 'Meter replacement — click to unmark' : 'Mark as meter replacement (zeroes Δ)'}
                      disabled={isDeleting || isToggling}
                      onClick={() => actions.handleToggleReplacement(r)}
                      className={[
                        'inline-flex items-center justify-center w-5 h-5 rounded border transition-colors',
                        'disabled:opacity-40 disabled:cursor-not-allowed',
                        isMeterReplacement
                          ? 'bg-kpi-solar border-kpi-solar text-white hover:bg-kpi-solar/90'
                          : 'border-input bg-background hover:border-kpi-solar/40 hover:bg-kpi-solar/10',
                      ].join(' ')}
                    >
                      {isToggling
                        ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        : isMeterReplacement ? <span className="text-3xs font-bold leading-none">✓</span> : null
                      }
                    </button>
                  </td>
                );

                if (module === 'power') {
                  const gmr     = r.grid_meter_readings     as Record<string, number> | null | undefined;
                  const prevGmr = predecessor?.grid_meter_readings as Record<string, number> | null | undefined;
                  const hasSolar = r.solar_meter_reading != null || (r.daily_solar_kwh != null && +r.daily_solar_kwh > 0);
                  const solarDisplayVal = isSolarDirectMode ? solarDirectVal(r) : r.solar_meter_reading;
                  const dateCols = 7;
                  const actionsCell = anyEditable ? (
                    <td className="px-2 py-1 text-center align-top whitespace-nowrap sticky right-0 z-10 border-l border-border/30 shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.12)] transition-colors bg-muted/20" rowSpan={resolvedGridCount + (hasSolar ? 1 : 0) + 1}>
                      {rowEditable && (
                        <div className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 max-md:opacity-100 transition-opacity flex items-center justify-center gap-0.5 pt-0.5">
                          <button
                            title="Edit"
                            aria-label="Edit"
                            disabled={!!actions.editRow || isDeleting}
                            onClick={() => actions.startEdit(r)}
                            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            title="Delete"
                            aria-label="Delete"
                            disabled={!!actions.editRow || isDeleting}
                            onClick={() => actions.setPendingDeleteId(r.id)}
                            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-40"
                          >
                            {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                          </button>
                        </div>
                      )}
                    </td>
                  ) : null;

                  if (meterFilter) {
                    const isSolar     = meterFilter.type === 'solar';
                    if (isSolar && r.is_estimated && r.solar_meter_reading == null && (r.daily_solar_kwh == null || +r.daily_solar_kwh === 0)) {
                      return null;
                    }

                    const solarDirect = isSolar && isSolarDirectMode;
                    const gridIdx = !isSolar ? (meterFilter as { type: 'grid'; idx: number }).idx : 0;
                    const mMult   = isSolar ? 1 : getHistGridMult(gridIdx);
                    const curr    = isSolar
                      ? (solarDirect ? solarDirectVal(r) : r.solar_meter_reading)
                      : getGridMeterVal(r, gridIdx, i, rows);

                    if (!isSolar && curr == null) {
                      return null;
                    }
                    let prevVal   = isSolar
                      ? predecessor?.solar_meter_reading
                      : (predecessor ? getGridMeterVal(predecessor, gridIdx, i + 1, rows) : null);
                    if (!isSolar && curr != null && prevVal == null) {
                      for (let j = i + 1; j < rows.length; j++) {
                        const v = getGridMeterVal(rows[j], gridIdx, j, rows);
                        if (v != null) {
                          prevVal = v;
                          break;
                        }
                      }
                    }
                    const rawDelta   = solarDirect ? null : (curr != null && prevVal != null ? curr - prevVal : null);
                    const isRepl     = isSolar ? isSolarRepl : isGridRepl;
                    const effective  = isRepl ? 0 : solarDirect ? curr : (rawDelta != null ? rawDelta * mMult : null);
                    return (
                      <tr key={r.id ?? i}
                        className={[
                          'group border-b border-border/40 transition-colors',
                          isEditing  ? 'bg-primary-soft/60'
                          : isRepl   ? 'bg-warn-soft/40'
                          : r.is_estimated ? 'bg-warn-soft/20'
                          : 'hover:bg-muted/40',
                        ].join(' ')}
                      >
                        {anyEditable && (
                          <td className="px-2 py-1.5 w-8">
                            {rowEditable && (
                              <input type="checkbox" className="h-3.5 w-3.5 accent-primary cursor-pointer"
                                checked={actions.selectedIds.has(r.id)} onChange={() => actions.handleSelectOne(r.id)} />
                            )}
                          </td>
                        )}
                        <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                          <span className="flex items-center gap-1.5">
                            {dateStr}
                            {r.is_estimated && (
                              <span className="text-3xs font-semibold uppercase tracking-wide text-warn bg-warn-soft/40 px-1 py-0.5 rounded leading-none border border-warn/40" title="Auto-backfilled reading">
                                Est.
                              </span>
                            )}
                            {isRepl && (
                              <span className={`text-3xs font-semibold uppercase tracking-wide px-1 py-0.5 rounded leading-none ${isSolar ? 'text-kpi-solar bg-kpi-solar/15' : 'text-kpi-grid bg-kpi-grid/15'}`}>
                                repl.
                              </span>
                            )}
                          </span>
                        </td>
                        <td />
                        <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap text-2xs">
                          <span className={isSolar ? 'text-kpi-solar' : 'text-kpi-grid'}>
                            {curr != null ? fmtNum(curr, 2) : '—'}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap text-2xs">
                          {isRepl
                            ? <span className={isSolar ? 'text-kpi-solar font-medium' : 'text-kpi-grid font-medium'}>0.00</span>
                            : solarDirect
                              ? <span className="text-muted-foreground" title="Direct kWh input — no delta to compute">n/a</span>
                              : rawDelta != null ? <span className={rawDelta < 0 ? 'text-destructive font-semibold' : ''}>{fmtNum(rawDelta, 2)}</span> : '—'
                          }
                        </td>
                        <td className="px-2 py-1.5 text-center font-mono-num whitespace-nowrap text-muted-foreground text-2xs">
                          {mMult !== 1 ? `×${mMult}` : '×1'}
                        </td>
                        <td className={['px-3 py-1.5 text-right font-mono-num whitespace-nowrap font-medium text-2xs',
                          effective != null && effective < 0 ? 'text-destructive font-semibold' : isSolar ? 'text-kpi-solar' : 'text-kpi-grid',
                        ].join(' ')}>
                          {effective != null ? fmtNum(effective, 2) : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-center whitespace-nowrap">
                          <button
                            title={isRepl ? 'Replacement — click to unmark' : 'Mark as meter replacement (zeroes Δ)'}
                            aria-label={isRepl ? 'Replacement — click to unmark' : 'Mark as meter replacement (zeroes Δ)'}
                            disabled={isDeleting || isTogglingGrid || isTogglingSolar}
                            onClick={() => isSolar ? actions.handleToggleSolarReplacement(r) : actions.handleToggleGridReplacement(r, gridIdx)}
                            className={['inline-flex items-center justify-center w-5 h-5 rounded border transition-colors',
                              'disabled:opacity-40 disabled:cursor-not-allowed',
                              isRepl
                                ? (isSolar ? 'bg-kpi-solar border-kpi-solar' : 'bg-kpi-grid border-kpi-grid') + ' text-white'
                                : 'border-input bg-background hover:border-kpi-grid/40 hover:bg-kpi-grid/10',
                            ].join(' ')}
                          >
                            {(isTogglingGrid || isTogglingSolar) ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                              : isRepl ? <span className="text-3xs font-bold leading-none">✓</span> : null}
                          </button>
                        </td>
                        {anyEditable && (
                          <td className="px-2 py-1 text-center whitespace-nowrap sticky right-0 z-10 border-l border-border/30 shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.12)] transition-colors bg-background group-hover:bg-muted/40">
                            {rowEditable && (
                              <div className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 max-md:opacity-100 transition-opacity flex items-center justify-center gap-0.5">
                                <button title="Edit" aria-label="Edit" disabled={!!actions.editRow || isDeleting}
                                  onClick={() => actions.startEdit(r)}
                                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40">
                                  <Pencil className="h-3 w-3" />
                                </button>
                                <button title="Delete" aria-label="Delete" disabled={!!actions.editRow || isDeleting}
                                  onClick={() => actions.setPendingDeleteId(r.id)}
                                  className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-40">
                                  {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                                </button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  }

                  return (
                    <React.Fragment key={r.id ?? i}>
                      <tr className={[
                        'border-t',
                        isEditing ? 'bg-primary-soft/60'
                        : isGridRepl ? 'bg-warn-soft/40'
                        : r.is_estimated ? 'bg-warn-soft/20'
                        : 'bg-muted/20',
                      ].join(' ')}>
                        {anyEditable && (
                          <td className="px-2 py-1 w-8">
                            {rowEditable && (
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5 accent-primary cursor-pointer"
                                checked={actions.selectedIds.has(r.id)}
                                onChange={() => actions.handleSelectOne(r.id)}
                              />
                            )}
                          </td>
                        )}
                        <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground font-medium" colSpan={dateCols}>
                          <span className="flex items-center gap-1.5">
                            {dateStr}
                            {r.is_estimated && (
                              <span className="text-3xs font-semibold uppercase tracking-wide text-warn bg-warn-soft/40 px-1 py-0.5 rounded leading-none border border-warn/40" title="Auto-backfilled reading">
                                Est.
                              </span>
                            )}
                            {isGridRepl && (
                              <span className="text-3xs font-semibold uppercase tracking-wide text-kpi-grid bg-kpi-grid/15 px-1 py-0.5 rounded leading-none">
                                grid repl.
                              </span>
                            )}
                            {isSolarRepl && (
                              <span className="text-3xs font-semibold uppercase tracking-wide text-kpi-solar bg-kpi-solar/15 px-1 py-0.5 rounded leading-none">
                                solar repl.
                              </span>
                            )}
                          </span>
                        </td>
                        {actionsCell}
                      </tr>

                      {Array.from({ length: resolvedGridCount }).map((_, mi) => {
                        const mLabel = getHistGridLabel(mi);
                        const mMult  = getHistGridMult(mi);
                        const curr   = getGridMeterVal(r, mi, i, rows);
                        let prev     = predecessor ? getGridMeterVal(predecessor, mi, i + 1, rows) : null;
                        if (curr != null && prev == null) {
                          for (let j = i + 1; j < rows.length; j++) {
                            const v = getGridMeterVal(rows[j], mi, j, rows);
                            if (v != null) {
                              prev = v;
                              break;
                            }
                          }
                        }
                        const rawDelta    = (curr != null && prev != null) ? curr - prev : null;
                        const effective   = isGridRepl ? 0 : rawDelta != null ? rawDelta * mMult : null;
                        return (
                          <tr key={`g${mi}`} className="hover:bg-muted/30">
                            {anyEditable && <td />}
                            <td className="px-3 py-1 pl-6">
                              <span className="flex items-center gap-1 text-2xs">
                                <GridPylonIcon className="h-2.5 w-2.5 text-kpi-grid shrink-0" />
                                <span className="text-muted-foreground truncate">{mLabel}</span>
                              </span>
                            </td>
                            <td className="px-3 py-1 text-right font-mono-num text-kpi-grid text-2xs">
                              {curr != null ? fmtNum(curr, 2) : '—'}
                            </td>
                            <td className="px-3 py-1 text-right font-mono-num text-2xs">
                              {isGridRepl
                                ? <span className="text-kpi-grid font-medium">0.00</span>
                                : rawDelta != null ? <span className={rawDelta < 0 ? 'text-destructive font-semibold' : ''}>{fmtNum(rawDelta, 2)}</span> : '—'
                              }
                            </td>
                            <td className="px-2 py-1 text-center font-mono-num text-muted-foreground text-2xs">
                              {mMult !== 1 ? `×${mMult}` : '×1'}
                            </td>
                            <td className={[
                              'px-3 py-1 text-right font-mono-num font-medium text-2xs',
                              effective != null && effective < 0 ? 'text-destructive font-semibold' : 'text-kpi-grid',
                            ].join(' ')}>
                              {effective != null ? fmtNum(effective, 2) : '—'}
                            </td>
                            <td className="px-2 py-1 text-center">
                              {mi === 0 && (
                                <button
                                  title={isGridRepl ? 'Grid replacement — click to unmark' : 'Mark grid meter replacement (zeroes Δ Grid)'}
                                  aria-label={isGridRepl ? 'Grid replacement — click to unmark' : 'Mark grid meter replacement (zeroes Δ Grid)'}
                                  disabled={isDeleting || isTogglingGrid}
                                  onClick={() => actions.handleToggleGridReplacement(r)}
                                  className={[
                                    'inline-flex items-center justify-center w-5 h-5 rounded border transition-colors',
                                    'disabled:opacity-40 disabled:cursor-not-allowed',
                                    isGridRepl
                                      ? 'bg-kpi-grid border-kpi-grid text-white hover:bg-kpi-grid/90'
                                      : 'border-input bg-background hover:border-kpi-grid/40 hover:bg-kpi-grid/10',
                                  ].join(' ')}
                                >
                                  {isTogglingGrid
                                    ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                    : isGridRepl ? <span className="text-3xs font-bold leading-none">✓</span> : null}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}

                      {hasSolar && (
                        <tr className="hover:bg-muted/30">
                          {anyEditable && <td />}
                          <td className="px-3 py-1 pl-6">
                            <span className="flex items-center gap-1 text-2xs">
                              <span className="text-kpi-solar text-xs leading-none">☀</span>
                              <span className="text-muted-foreground">Solar</span>
                            </span>
                          </td>
                          <td className="px-3 py-1 text-right font-mono-num text-kpi-solar text-2xs">
                            {solarDisplayVal != null ? fmtNum(solarDisplayVal, 2) : '—'}
                          </td>
                          <td className="px-3 py-1 text-right font-mono-num text-2xs">
                            {isSolarRepl
                              ? <span className="text-kpi-solar font-medium">0.00</span>
                              : isSolarDirectMode
                                ? (solarDisplayVal != null
                                    ? <span className={solarDisplayVal < 0 ? 'text-destructive font-semibold' : 'text-kpi-solar'}>{fmtNum(solarDisplayVal, 2)}</span>
                                    : '—')
                                : (predecessor?.solar_meter_reading != null && r.solar_meter_reading != null)
                                  ? (() => {
                                      const sDelta = r.solar_meter_reading - predecessor.solar_meter_reading;
                                      return <span className={sDelta < 0 ? 'text-destructive font-semibold' : 'text-kpi-solar'}>{fmtNum(sDelta, 2)}</span>;
                                    })()
                                  : r.daily_solar_kwh != null && +r.daily_solar_kwh !== 0
                                    ? <span className={+r.daily_solar_kwh < 0 ? 'text-destructive font-semibold' : 'text-kpi-solar'}>{fmtNum(+r.daily_solar_kwh, 2)}</span>
                                    : '—'
                            }
                          </td>
                          <td />
                          <td />
                          <td className="px-2 py-1 text-center">
                            <button
                              title={isSolarRepl ? 'Solar replacement — click to unmark' : 'Mark solar meter replacement (zeroes Δ Solar)'}
                              aria-label={isSolarRepl ? 'Solar replacement — click to unmark' : 'Mark solar meter replacement (zeroes Δ Solar)'}
                              disabled={isDeleting || isTogglingSolar}
                              onClick={() => actions.handleToggleSolarReplacement(r)}
                              className={[
                                'inline-flex items-center justify-center w-5 h-5 rounded border transition-colors',
                                'disabled:opacity-40 disabled:cursor-not-allowed',
                                isSolarRepl
                                  ? 'bg-kpi-solar border-kpi-solar text-white hover:bg-kpi-solar/90'
                                  : 'border-input bg-background hover:border-kpi-solar/40 hover:bg-kpi-solar/10',
                              ].join(' ')}
                            >
                              {isTogglingSolar
                                ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                : isSolarRepl ? <span className="text-3xs font-bold leading-none">✓</span> : null}
                            </button>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                }

                const isEstimated = !!r.is_estimated;
                const flagsList: React.ReactNode[] = [];
                if (isEstimated) {
                  flagsList.push(
                    <StatusPill
                      key="est"
                      tone="warn"
                      title="System-generated / Backfilled reading — no manual operator entry on file. Saving an edit converts this to a verified human reading."
                      aria-label="Estimated reading"
                    >
                      Est.
                    </StatusPill>
                  );
                }
                if (r.off_location_flag) {
                  flagsList.push(
                    <StatusPill
                      key="off-loc"
                      tone="warn"
                      title="GPS mismatch at entry"
                      aria-label="Off location reading"
                    >
                      off-loc
                    </StatusPill>
                  );
                }
                const flagsCell = (
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    {flagsList.length > 0 ? (
                      <div className="flex items-center gap-1 flex-wrap">{flagsList}</div>
                    ) : (
                      <span className="text-muted-foreground/30 text-2xs">—</span>
                    )}
                  </td>
                );

                return (
                  <tr
                    key={r.id ?? i}
                    className={[
                      'group border-b border-border/40 transition-colors',
                      isEditing      ? 'bg-primary-soft/60'
                      : isMeterReplacement ? 'bg-warn-soft/40'
                      : isEstimated  ? 'bg-warn-soft/20'
                      : 'hover:bg-muted/40',
                    ].join(' ')}
                  >
                    {anyEditable && (
                      <td className="px-2 py-1.5 w-8">
                        {rowEditable && (
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 accent-primary cursor-pointer"
                            checked={actions.selectedIds.has(r.id)}
                            onChange={() => actions.handleSelectOne(r.id)}
                          />
                        )}
                      </td>
                    )}
                    <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        {dateStr}
                        {isMeterReplacement && (
                          <span className="text-3xs font-semibold uppercase tracking-wide text-kpi-solar bg-kpi-solar/15 px-1 py-0.5 rounded leading-none">
                            repl.
                          </span>
                        )}
                      </span>
                    </td>

                    {module === 'locator' && (isDirectMode ? <>
                      <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap">{fmtNum(r.current_reading, 2)}</td>
                      {replCell}
                      {flagsCell}
                    </> : <>
                      <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap">{fmtNum(r.current_reading, 2)}</td>
                      <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap">
                        {isMeterReplacement
                          ? <span className="text-kpi-solar font-medium">0.00</span>
                          : rawDelta != null ? <span className={rawDelta < 0 ? 'text-destructive font-semibold' : ''}>{fmtNum(rawDelta, 2)}</span> : '—'
                        }
                      </td>
                      {replCell}
                      {flagsCell}
                    </>)}

                    {module === 'well' && (isDirectMode ? <>
                      <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap">{fmtNum(r.current_reading, 2)}</td>
                      {replCell}
                      <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap">
                        {r.power_meter_reading != null ? fmtNum(r.power_meter_reading, 2) : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap">
                        {r.tds_ppm != null ? fmtNum(r.tds_ppm, 2) : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap">
                        {(r as any).turbidity_ntu != null ? (+((r as any).turbidity_ntu)).toFixed(2) : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap">
                        {r.pressure_psi != null ? fmtNum(r.pressure_psi, 2) : '—'}
                      </td>
                      {flagsCell}
                    </> : <>
                      <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap">{fmtNum(r.current_reading, 2)}</td>
                      <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap">
                        {isMeterReplacement
                          ? <span className="text-kpi-solar font-medium">0.00</span>
                          : rawDelta != null ? <span className={rawDelta < 0 ? 'text-destructive font-semibold' : ''}>{fmtNum(rawDelta, 2)}</span> : '—'
                        }
                      </td>
                      {replCell}
                      <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap">
                        {r.power_meter_reading != null ? fmtNum(r.power_meter_reading, 2) : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap">
                        {r.tds_ppm != null ? fmtNum(r.tds_ppm, 2) : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap">
                        {(r as any).turbidity_ntu != null ? (+((r as any).turbidity_ntu)).toFixed(2) : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap">
                        {r.pressure_psi != null ? fmtNum(r.pressure_psi, 2) : '—'}
                      </td>
                      {flagsCell}
                    </>)}

                    {module === 'blending' && <>
                      <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap text-muted-foreground">
                        {r.raw_meter_reading != null ? fmtNum(r.raw_meter_reading, 2) : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap">
                        <span className={(r.volume_m3 ?? 0) < 0 ? 'text-destructive font-semibold' : ''}>
                          {fmtNum(r.volume_m3 ?? 0, 2)}
                        </span>
                      </td>
                      {replCell}
                      {flagsCell}
                    </>}

                    {anyEditable && (
                      <td className="px-2 py-1 text-center whitespace-nowrap sticky right-0 z-10 border-l border-border/30 shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.12)] transition-colors bg-background group-hover:bg-muted/40">
                        {rowEditable && (
                          <div className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 max-md:opacity-100 transition-opacity flex items-center justify-center gap-0.5">
                            <button
                              title="Edit"
                              aria-label="Edit"
                              disabled={!!actions.editRow || isDeleting}
                              onClick={() => actions.startEdit(r)}
                              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              title="Delete"
                              aria-label="Delete"
                              disabled={!!actions.editRow || isDeleting}
                              onClick={() => actions.setPendingDeleteId(r.id)}
                              className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-40"
                            >
                              {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-2xs text-muted-foreground">
        {days === 'custom'
          ? `Showing ${appliedFrom} → ${appliedTo}`
          : `Showing up to ${days} days of history`
        } · {rows?.length ?? 0} records
      </p>

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
          }}
          onClose={() => actions.setReplaceReadingId(null)}
        />
      )}
    </>
  );
}
