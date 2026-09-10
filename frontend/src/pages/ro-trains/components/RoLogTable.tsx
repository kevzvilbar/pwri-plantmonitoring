/**
 * frontend/src/pages/ro-trains/components/RoLogTable.tsx
 *
 * RO table section for the TrainLogModal. Receives all data and callbacks
 * as props so it can render loading/empty states, the table header, and
 * every row type (banner, gap, offline-span, reading).
 */
import React from 'react';
import { Loader2, Calendar, Pencil, Trash2, MessageSquarePlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TrainStatusBannerRow, GapBadgeRow, OfflineSpanRow } from './TrainLogRowComponents';

interface RoLogTableProps {
  isLoading: boolean;
  logsLength: number;
  pageRoItems: any[];
  roItemsLength: number;
  logTab: 'ro' | 'pretreat';
  highlightId?: string;
  highlightGapStartAt: string | null;
  highlightRowRef: React.RefObject<HTMLTableRowElement>;
  highlightJumped: boolean;
  expandedSpanIds: Set<string>;
  toggleSpanExpand: (id: string) => void;
  gapDialogTarget: any;
  setGapDialogTarget: (v: any) => void;
  gapDialogBusy: boolean;
  submitGapReason: (category: string, detail: string) => Promise<void>;
  togglingId: string | null;
  setEditingRoRow: (v: any) => void;
  setPendingDelete: (v: any) => void;
  canEditEntry: (row: any, hasFullAccess: boolean, userId: string | undefined, isRo: boolean) => boolean;
  hasFullAccess: boolean;
  activeOperator: any;
  isManager: boolean;
  editingRoRow: any;
  replaceReadingId: string | null;
  setReplaceReadingId: (v: string | null) => void;
  toggleMeterReplacement: (r: any) => Promise<void>;
  recalculateTrainDeltas: (trainId: string) => Promise<void>;
  trainId: string;
  qc: any;
  queryKey: any[];
  exportCSV: () => void;
  doDeleteReading: () => Promise<void>;
  fmtVal: (v: any, unit?: string) => React.ReactNode;
  format: (date: Date, format: string) => string;
}

export function RoLogTable({
  isLoading, logsLength, pageRoItems, roItemsLength, logTab,
  highlightId, highlightGapStartAt, highlightRowRef, highlightJumped,
  expandedSpanIds, toggleSpanExpand,
  gapDialogTarget, setGapDialogTarget, gapDialogBusy, submitGapReason,
  togglingId, setEditingRoRow, setPendingDelete,
  canEditEntry, hasFullAccess, activeOperator, isManager,
  editingRoRow, replaceReadingId, setReplaceReadingId,
  toggleMeterReplacement, recalculateTrainDeltas, trainId, qc, queryKey, exportCSV, doDeleteReading,
  fmtVal, format,
}: RoLogTableProps) {
  if (logTab !== 'ro') return null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (logsLength === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Calendar className="h-8 w-8 mb-2 opacity-30" />
        <p className="text-sm font-medium">No logs found</p>
        <p className="text-xs mt-0.5">Try expanding the date range.</p>
      </div>
    );
  }

  return (
    <table className="w-full text-xs border-collapse">
      <thead className="sticky top-0 bg-background border-b border-border/60 z-20 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
        <tr className="text-muted-foreground uppercase tracking-wide text-2xs">
          <th className="text-left px-3 py-2 font-semibold whitespace-nowrap w-[130px] sticky left-0 top-0 z-30 bg-background border-r border-border/30 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.12)]">Date / Time</th>
          <th className="text-left px-2 py-2 font-semibold w-[100px] whitespace-nowrap">Operator</th>
          <th className="text-right px-0 py-0 font-semibold whitespace-nowrap" colSpan={2}>
            <div className="flex flex-col items-end">
              <span className="px-2 pt-2 pb-0.5">Perm Flow</span>
              <div className="flex border-t border-border/40 w-full">
                <span className="flex-1 px-1.5 pb-1.5 pt-0.5 text-3xs text-right border-r border-border/30">EM</span>
                <span className="flex-1 px-1.5 pb-1.5 pt-0.5 text-3xs text-right text-primary">Meter</span>
              </div>
            </div>
          </th>
          {['Feed Flow','Rej. Flow','Feed Press.','Rej. Press.','Suction',
            'Feed TDS','Perm TDS','Rej. TDS','Temp','Turbidity','Feed pH','Perm pH',
            'Cl Residual','Recovery','Feed Meter','Perm Meter','Δ Perm m³','Rej. Meter','Δ Rej m³'].map(h => (
            <th key={h} className="text-right px-2 py-2 font-semibold whitespace-nowrap">{h}</th>
          ))}
          <th className="px-2 py-2 font-semibold text-center text-kpi-solar whitespace-nowrap w-[50px]" title="Meter Replacement flag">Repl.</th>
          <th className="text-left px-2 py-2 font-semibold whitespace-nowrap">Remarks</th>
          <th className="px-2 py-2 font-semibold text-center whitespace-nowrap w-[44px] sticky right-0 top-0 z-30 bg-background border-l border-border/30 shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.12)]"></th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {pageRoItems.map((item, i) => {
          if (item.kind === 'banner') {
            return <TrainStatusBannerRow key={`banner-${item.segment.startAt}`} segment={item.segment} />;
          }
          if (item.kind === 'gap') {
            const isHighlighted = highlightGapStartAt === item.gap.gapStartAt;
            return (
              <GapBadgeRow
                key={`gap-${item.gap.gapStartAt}`}
                gap={item.gap}
                existingReason={item.existingReason}
                onClick={() => setGapDialogTarget({ gap: item.gap, sourceTable: 'ro_train_readings' })}
                highlighted={isHighlighted}
                rowRef={isHighlighted ? highlightRowRef : undefined}
              />
            );
          }
          if (item.kind === 'offline-span') {
            const isExpanded = expandedSpanIds.has(item.span.id);
            return (
              <OfflineSpanRow
                key={item.span.id}
                span={item.span}
                isExpanded={isExpanded}
                onToggleExpand={() => toggleSpanExpand(item.span.id)}
              >
                {item.span.rows.map((r: any, childIdx: number) => {
                  const isRepl     = !!r.is_meter_replacement;
                  const opName     = r._operatorName ?? 'Unknown';
                  const initials   = opName !== 'Unknown'
                    ? opName.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase() : '?';
                  const isHighlighted = highlightId != null && r.id === highlightId;
                  return (
                    <tr
                      key={r.id ?? `nested-ro-${childIdx}`}
                      ref={isHighlighted ? highlightRowRef : undefined}
                      className={cn(
                        'group border-t border-border/40 transition-colors bg-muted/20 hover:bg-muted/30 text-2xs',
                        isHighlighted && 'bg-danger-soft ring-1 ring-inset ring-danger',
                      )}
                    >
                      <td className={cn(
                        'px-3 py-1.5 whitespace-nowrap font-mono tabular-nums text-xs pl-6 border-l-2 border-l-danger/60 sticky left-0 z-10 border-r border-border/30 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.12)] transition-colors',
                        isHighlighted ? 'bg-danger-soft' : 'bg-background group-hover:bg-muted/30'
                      )}>
                        <div className="text-foreground font-medium">{r.reading_datetime ? format(new Date(r.reading_datetime), 'MMM d, yyyy') : '—'}</div>
                        <div className="text-muted-foreground">{r.reading_datetime ? format(new Date(r.reading_datetime), 'HH:mm') : ''}</div>
                      </td>
                      <td className="px-2 py-1.5 text-left">
                        <div className="flex items-center gap-1.5">
                          <span className="h-4 w-4 rounded-full bg-primary-soft text-primary text-3xs font-bold inline-flex items-center justify-center shrink-0">{initials}</span>
                          <span className="text-xs font-medium leading-tight truncate max-w-[90px] block" title={opName}>{opName}</span>
                        </div>
                      </td>
                      <td colSpan={20} className="px-2 py-1.5 text-muted-foreground italic text-left">
                        {r.incomplete_reason || 'Offline check-in (no production flow)'}
                      </td>
                      <td className="px-2 py-1.5 text-left text-muted-foreground truncate max-w-[120px]">
                        {r.remarks ? <span title={r.remarks}>{r.remarks}</span> : <span className="text-muted-foreground/30">—</span>}
                      </td>
                      <td className={cn(
                        'px-2 py-1.5 text-center sticky right-0 z-10 border-l border-border/30 shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.12)] transition-colors',
                        isHighlighted ? 'bg-danger-soft' : 'bg-background group-hover:bg-muted/30'
                      )}>
                        <div className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 max-md:opacity-100 transition-opacity flex items-center justify-center gap-1">
                          {canEditEntry(r, hasFullAccess, activeOperator?.id, false) && (
                            <button
                              type="button"
                              onClick={() => setEditingRoRow(r)}
                              className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                              title="Edit entry"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          )}
                          {canEditEntry(r, hasFullAccess, activeOperator?.id, true) && (
                            <button
                              type="button"
                              onClick={() => setPendingDelete({ type: 'ro', row: r })}
                              className="p-1 rounded text-muted-foreground hover:text-danger transition-colors"
                              title="Delete entry"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </OfflineSpanRow>
            );
          }
          const r: any = item.row;
          const isRepl     = !!r.is_meter_replacement;
          const isToggling = togglingId === r.id;
          const opName     = r._operatorName ?? 'Unknown';
          const initials   = opName !== 'Unknown'
            ? opName.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase() : '?';
          const delta = r._computed_delta ?? r.permeate_meter_delta;
          const isHighlighted = highlightId != null && r.id === highlightId;
          return (
            <tr
              key={r.id ?? i}
              ref={isHighlighted ? highlightRowRef : undefined}
              className={cn(
                'group border-b border-border/40 transition-colors',
                isHighlighted ? 'bg-danger-soft ring-1 ring-inset ring-danger' : isRepl ? 'bg-kpi-solar/40' : 'hover:bg-muted/40',
              )}
            >
              <td className={cn(
                'px-3 py-2 whitespace-nowrap font-mono tabular-nums text-xs sticky left-0 z-10 border-r border-border/30 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.12)] transition-colors',
                isHighlighted ? 'bg-danger-soft' : isRepl ? 'bg-kpi-solar/40' : 'bg-background group-hover:bg-muted/40'
              )}>
                <div className="text-foreground font-medium">{r.reading_datetime ? format(new Date(r.reading_datetime), 'MMM d, yyyy') : '—'}</div>
                <div className="text-muted-foreground text-3xs">{r.reading_datetime ? format(new Date(r.reading_datetime), 'HH:mm') : ''}</div>
              </td>
              <td className="px-2 py-2 text-left">
                <div className="flex items-center gap-1.5">
                  <span className="h-5 w-5 rounded-full bg-primary-soft text-primary text-3xs font-bold inline-flex items-center justify-center shrink-0">{initials}</span>
                  <div className="min-w-0">
                    <span className="text-xs font-medium leading-tight truncate max-w-[90px] block" title={opName}>{opName}</span>
                    {r.incomplete_reason && (
                      <span className="text-3xs text-kpi-solar leading-tight truncate max-w-[110px] block" title={r.incomplete_reason}>
                        {r.incomplete_reason}
                      </span>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap border-r border-border/20">{fmtVal(r.permeate_flow, 'm³/h')}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                {isRepl ? <span className="text-kpi-solar text-2xs">—</span>
                  : r._perm_flow_meter != null
                    ? <span className="text-primary font-mono tabular-nums text-xs">{r._perm_flow_meter}<span className="text-muted-foreground/60 ml-0.5 text-3xs">m³/h</span></span>
                    : <span className="text-muted-foreground/30">—</span>}
              </td>
              <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap">{fmtVal(r.feed_flow, 'm³/h')}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap">{fmtVal(r.reject_flow, 'm³/h')}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap">{fmtVal(r.feed_pressure_psi, 'psi')}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap">{fmtVal(r.reject_pressure_psi, 'psi')}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap">{fmtVal(r.suction_pressure_psi, 'psi')}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap">{fmtVal(r.feed_tds, 'ppm')}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap">{fmtVal(r.permeate_tds, 'ppm')}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap">{fmtVal(r.reject_tds, 'ppm')}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap">{fmtVal(r.temperature_c, '°C')}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap">{fmtVal(r.turbidity_ntu, 'NTU')}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap">{fmtVal(r.feed_ph, '')}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap">{fmtVal(r.permeate_ph, '')}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap">{fmtVal(r.chlorine_residual_mg_l, 'mg/L')}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap">{fmtVal(r.recovery_pct, '%')}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap text-xs">
                {r.feed_meter != null ? Number(r.feed_meter).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : <span className="text-muted-foreground/30">—</span>}
              </td>
              <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap text-xs">
                {r.permeate_meter != null ? Number(r.permeate_meter).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : <span className="text-muted-foreground/30">—</span>}
              </td>
              <td className={cn('px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap text-xs', isRepl && 'text-kpi-solar')}>
                {isRepl ? <span className="text-kpi-solar font-semibold">★ 0.00</span>
                  : delta != null ? <span className={+delta < 0 ? 'text-destructive font-semibold' : ''}>{Number(delta).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<span className="text-muted-foreground/60 ml-0.5 text-3xs">m³</span></span>
                  : <span className="text-muted-foreground/30">—</span>}
              </td>
              <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap text-xs">
                {r.reject_meter != null ? Number(r.reject_meter).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : <span className="text-muted-foreground/30">—</span>}
              </td>
              <td className={cn('px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap text-xs', r.is_reject_meter_replacement && 'text-kpi-solar')}>
                {(() => {
                  const isRejRepl = !!(r.is_reject_meter_replacement);
                  const rejDelta  = r._computed_rej_delta ?? (r.reject_meter_delta != null ? +r.reject_meter_delta : null);
                  if (isRejRepl)         return <span className="text-kpi-solar font-semibold">★ 0.00</span>;
                  if (rejDelta != null)   return <span className={+rejDelta < 0 ? 'text-destructive font-semibold' : ''}>{Number(rejDelta).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<span className="text-muted-foreground/60 ml-0.5 text-3xs">m³</span></span>;
                  return <span className="text-muted-foreground/30">—</span>;
                })()}
              </td>
              <td className="px-2 py-2 text-center whitespace-nowrap">
                {isManager ? (
                  <button onClick={() => toggleMeterReplacement(r)} disabled={isToggling}
                    title={isRepl ? 'Meter replacement — click to unmark' : 'Toggle meter replacement flag'}
                    aria-label={isRepl ? 'Meter replacement — click to unmark' : 'Toggle meter replacement flag'}
                    className={cn('h-5 w-5 rounded border-2 inline-flex items-center justify-center transition-colors mx-auto',
                      isRepl ? 'border-kpi-solar bg-kpi-solar text-white' : 'border-border bg-background hover:border-kpi-solar/90',
                      isToggling ? 'opacity-50 cursor-wait' : 'cursor-pointer')}>
                    {isToggling ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : isRepl ? <span className="text-3xs font-bold leading-none">✓</span> : null}
                  </button>
                ) : isRepl ? <span className="text-kpi-solar text-2xs">★</span> : null}
              </td>
              <td className="px-2 py-2 text-left text-xs text-muted-foreground max-w-[150px] truncate">
                {r.remarks ? <span title={r.remarks}>{r.remarks}</span> : <span className="text-muted-foreground/30">—</span>}
              </td>
              <td className={cn(
                'px-2 py-2 text-center whitespace-nowrap sticky right-0 z-10 border-l border-border/30 shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.12)] transition-colors',
                isHighlighted ? 'bg-danger-soft' : isRepl ? 'bg-kpi-solar/40' : 'bg-background group-hover:bg-muted/40'
              )}>
                <div className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 max-md:opacity-100 transition-opacity flex items-center justify-center gap-0.5">
                  {canEditEntry(r, hasFullAccess, activeOperator?.id, true) ? (
                    <>
                      <button onClick={() => setEditingRoRow(r)} title="Edit reading" aria-label="Edit reading"
                        disabled={false}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40">
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button onClick={() => setPendingDelete({ type: 'ro', row: r })}
                        title="Delete reading" aria-label="Delete reading"
                        disabled={false}
                        className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </>
                  ) : !hasFullAccess && activeOperator?.id && r.permeate_meter != null ? (
                    <button
                      onClick={() => {}}
                      title="Request correction" aria-label="Request correction"
                      className="p-1 rounded hover:bg-warn-soft text-muted-foreground/40 hover:text-warn/90 transition-colors">
                      <MessageSquarePlus className="h-3 w-3" />
                    </button>
                  ) : null}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
