/**
 * frontend/src/pages/ro-trains/components/PreTreatLogTable.tsx
 *
 * Pre-Treatment table section for the TrainLogModal. Receives all data
 * and callbacks as props so it can render loading/empty states, the
 * table header, and every row type (banner, gap, offline-span, reading).
 */
import React from 'react';
import { Loader2, Calendar, Pencil, Trash2, MessageSquarePlus } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { canEditEntry } from '../helpers';
import { TrainStatusBannerRow, GapBadgeRow, OfflineSpanRow } from './TrainLogRowComponents';

interface PreTreatLogTableProps {
  isLoading: boolean;
  logsLength: number;
  pagePreItems: any[];
  itemsLength: number;
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
  setEditingPretreatRow: (v: any) => void;
  setPendingDelete: (v: any) => void;
  setCorrectionTarget: (v: any) => void;
  canEditEntry: (row: any, hasFullAccess: boolean, userId: string | undefined, isRo: boolean) => boolean;
  hasFullAccess: boolean;
  activeOperator: any;
  isManager: boolean;
  editingPretreatRow: any;
  fmtVal: (v: any, unit?: string) => React.ReactNode;
  format: (date: Date, format: string) => string;
  /** "was actually running? report" handler for open auto-flagged Offline banners. */
  onReportRunning?: (segment: any) => void;
  reportingBanner?: boolean;
  trainLabel: string;
}

export function PreTreatLogTable({
  isLoading, logsLength, pagePreItems, itemsLength, logTab,
  highlightId, highlightGapStartAt, highlightRowRef, highlightJumped,
  expandedSpanIds, toggleSpanExpand,
  gapDialogTarget, setGapDialogTarget, gapDialogBusy, submitGapReason,
  setEditingPretreatRow, setPendingDelete, setCorrectionTarget,
  canEditEntry, hasFullAccess, activeOperator, isManager,
  editingPretreatRow, fmtVal, format, onReportRunning, reportingBanner, trainLabel,
}: PreTreatLogTableProps) {
  if (logTab !== 'pretreat') return null;

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
        <p className="text-sm font-medium">No pre-treatment records found</p>
        <p className="text-xs mt-0.5">Try expanding the date range.</p>
      </div>
    );
  }

  const pressurePills = (units: any[], getLabel = (u: any) => `U${u.unit}`) =>
    units.length === 0
      ? <span className="text-muted-foreground/30">—</span>
      : <div className="flex flex-wrap gap-0.5 justify-end">
          {units.map((u: any, j: number) => {
            const inP  = u.in_psi ?? u.inlet_psi ?? null;
            const outP = u.out_psi ?? u.outlet_psi ?? null;
            const dp   = u.dp_psi != null ? u.dp_psi : (inP != null && outP != null ? (inP - outP).toFixed(1) : null);
            if (u.backwash_on) {
              const mRow   = (u._mmfReadings ?? []).find((m: any) => m.unit === u.unit);
              const mDelta = mRow?.meter_start != null && mRow?.meter_end != null ? ` +${(mRow.meter_end - mRow.meter_start).toFixed(0)}` : '';
              return <span key={j} className="text-3xs px-1 py-0.5 rounded bg-warn-soft border border-warn font-mono whitespace-nowrap text-warn">{getLabel(u)} BW{mDelta}</span>;
            }
            return <span key={j} className="text-3xs px-1 py-0.5 rounded bg-muted/50 border border-border/40 font-mono whitespace-nowrap">{getLabel(u)}{dp != null ? ` ΔP=${dp}` : inP != null ? ` ${inP}→${outP}` : ''}</span>;
          })}
        </div>;

  const boosterPills = (units: any[]) =>
    units.length === 0
      ? <span className="text-muted-foreground/30">—</span>
      : <div className="flex flex-wrap gap-0.5 justify-end">
          {units.map((u: any, j: number) => (
            <span key={j} className="text-3xs px-1 py-0.5 rounded bg-info-soft border border-info font-mono whitespace-nowrap">
              P{u.unit} {u.target_pressure_psi != null ? `${u.target_pressure_psi}psi` : u.target_hz != null ? `${u.target_hz}Hz` : '—'}{u.amperage != null ? ` ${u.amperage}A` : ''}
            </span>
          ))}
        </div>;

  return (
    <table className="w-full text-xs border-collapse">
      <thead className="sticky top-0 bg-background border-b border-border/60 z-20 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
        <tr className="text-muted-foreground uppercase tracking-wide text-2xs">
          {['Date / Time','Operator','HPP (psi)','AFM/MMF Units','Booster Pumps','Cart./Bag Housings','Changed','Remarks',''].map((h, i) => (
            <th key={i} className={cn(
              'px-2 py-2 font-semibold whitespace-nowrap',
              i === 0 ? 'text-left px-3 w-[130px] sticky left-0 top-0 z-30 bg-background border-r border-border/30 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.12)]'
              : i === 1 ? 'text-left w-[100px]'
              : i === 7 ? 'text-left'
              : i === 8 ? 'text-center w-[44px] sticky right-0 top-0 z-30 bg-background border-l border-border/30 shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.12)]'
              : 'text-right'
            )}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y">
        {pagePreItems.map((item, i) => {
          if (item.kind === 'banner') {
            return <TrainStatusBannerRow key={`banner-${item.segment.startAt}`} segment={item.segment} onReportRunning={onReportRunning} reporting={reportingBanner} />;
          }
          if (item.kind === 'gap') {
            const isHighlighted = highlightGapStartAt === item.gap.gapStartAt;
            return (
              <GapBadgeRow
                key={`gap-${item.gap.gapStartAt}`}
                gap={item.gap}
                existingReason={item.existingReason}
                onClick={() => setGapDialogTarget({ gap: item.gap, sourceTable: 'ro_pretreatment_readings' })}
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
                  const opName   = r._operatorName ?? 'Unknown';
                  const initials = opName !== 'Unknown' ? opName.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase() : '?';
                  const isHighlighted = highlightId != null && r.id === highlightId;
                  return (
                    <tr
                      key={r.id ?? `nested-pre-${childIdx}`}
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
                      <td colSpan={5} className="px-2 py-1.5 text-muted-foreground italic text-left">
                        {r.incomplete_reason || 'Offline check-in (no active pre-treatment data)'}
                      </td>
                      <td className="px-2 py-1.5 text-left text-muted-foreground truncate max-w-[120px]">
                        {r.remarks ? <span title={r.remarks}>{r.remarks}</span> : <span className="text-muted-foreground/30">—</span>}
                      </td>
                      <td className={cn(
                        'px-2 py-1.5 text-center sticky right-0 z-10 border-l border-border/30 shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.12)] transition-colors',
                        isHighlighted ? 'bg-danger-soft' : 'bg-background group-hover:bg-muted/30'
                      )}>
                        <div className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 max-md:opacity-100 transition-opacity flex items-center justify-center gap-0.5">
                          {canEditEntry(r, hasFullAccess, activeOperator?.id, true) ? (
                            <>
                              <button onClick={() => setEditingPretreatRow(r)} title="Edit reading" aria-label="Edit reading"
                                disabled={false}
                                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40">
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button onClick={() => setPendingDelete({ type: 'pretreat', row: r })}
                                title="Delete reading" aria-label="Delete reading"
                                disabled={false}
                                className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40">
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </OfflineSpanRow>
            );
          }
          const r: any = item.row;
          const opName   = r._operatorName ?? 'Unknown';
          const initials = opName !== 'Unknown' ? opName.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase() : '?';
          const isHighlighted = highlightId != null && r.id === highlightId;
          return (
            <tr
              key={r.id ?? i}
              ref={isHighlighted ? highlightRowRef : undefined}
              className={cn('group border-b border-border/40 transition-colors', isHighlighted ? 'bg-danger-soft ring-1 ring-inset ring-danger' : 'hover:bg-muted/40')}
            >
              <td className={cn(
                'px-3 py-2 whitespace-nowrap font-mono tabular-nums text-xs sticky left-0 z-10 border-r border-border/30 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.12)] transition-colors',
                isHighlighted ? 'bg-danger-soft' : 'bg-background group-hover:bg-muted/40'
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
                      <span className="text-3xs text-warn leading-tight truncate max-w-[110px] block" title={r.incomplete_reason}>
                        {r.incomplete_reason}
                      </span>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap text-xs">
                {r.hpp_target_pressure_psi != null ? <span>{r.hpp_target_pressure_psi}<span className="text-muted-foreground/60 ml-0.5 text-3xs">psi</span></span> : <span className="text-muted-foreground/30">—</span>}
              </td>
              <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap">{pressurePills(r.afm_units ?? [])}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap">{boosterPills(r.booster_pumps ?? [])}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap">{pressurePills(r.cartridge_filter_housings ?? [], u => `H${u.unit}`)}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap text-xs">
                {r.bag_filters_changed != null && r.bag_filters_changed > 0
                  ? <span className="text-warn font-semibold">{r.bag_filters_changed}</span>
                  : <span className="text-muted-foreground/30">—</span>}
              </td>
              <td className="px-2 py-2 text-left text-xs text-muted-foreground max-w-[150px] truncate">
                {r.remarks ? <span title={r.remarks}>{r.remarks}</span> : <span className="text-muted-foreground/30">—</span>}
              </td>
              <td className={cn(
                'px-2 py-2 text-center whitespace-nowrap sticky right-0 z-10 border-l border-border/30 shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.12)] transition-colors',
                isHighlighted ? 'bg-danger-soft' : 'bg-background group-hover:bg-muted/40'
              )}>
                <div className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 max-md:opacity-100 transition-opacity flex items-center justify-center gap-0.5">
                  {canEditEntry(r, hasFullAccess, activeOperator?.id, true) ? (
                    <>
                      <button onClick={() => setEditingPretreatRow(r)} title="Edit reading" aria-label="Edit reading"
                        disabled={false}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40">
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button onClick={() => setPendingDelete({ type: 'pretreat', row: r })}
                        title="Delete reading" aria-label="Delete reading"
                        disabled={false}
                        className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </>
                  ) : !hasFullAccess && activeOperator?.id && (
                    <button
                      onClick={() => setCorrectionTarget({
                        id: r.id, sourceTable: 'ro_train_readings',
                        plantId: r.plant_id ?? '', entityName: `${trainLabel} (pre-treatment)`,
                        currentReading: r.hpp_target_pressure_psi ?? 0,
                        previousReading: null, dailyVolume: null,
                        readingDatetime: r.reading_datetime ?? new Date().toISOString(),
                      })}
                      title="Request correction" aria-label="Request correction"
                      className="p-1 rounded hover:bg-warn-soft text-muted-foreground/40 hover:text-warn/90 transition-colors">
                      <MessageSquarePlus className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
