// Extracted from TrendChart.tsx (Phase 1 of pwri-improvement-plan.md).
// PivotTable and OverviewTable are only used by DataSummaryPopup — the main
// TrendChart component doesn't reference either directly (verified before
// this extraction).

import React, { useState } from 'react';
import { MessageCircleOff } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { friendlyError } from '@/lib/supabaseErrors';
import { ReasonDialog } from '@/components/ReasonDialog';
import { reasonCategoryLabel, reasonEntityPrefix } from '@/lib/reasonCodes';
import {
  TH, TH_DATE, TH_TOTAL, TD, TD_TOTAL_COL,
  fmtV, fmtDateKey, useGapReasonLookup,
  GAP_ENTITY_TABLE, type GapReasonHit,
  GRID_METER_OTHER_KEY, type GridMeterBreakdown, type GridMeterColumn,
} from './TrendChartPivotShared';

/** Generic pivot table: Date rows × entity columns × Total column */
export function PivotTable({
  dates,
  entities,       // [{id, label}]
  pivot,          // dateKey → entityId → value
  totalLabel,
  unit = 'm³',
  colorClass = 'text-primary',
  entityType,
}: {
  dates: string[];
  entities: { id: string; label: string }[];
  pivot: Map<string, Map<string, number>>;
  totalLabel: string;
  unit?: string;
  colorClass?: string;
  /** Enables "why is this blank" reason lookups for blank cells. */
  entityType?: 'well' | 'locator' | 'ro_train' | 'meter' | 'blending' | 'power';
}) {
  const rowTotals = dates.map((d) =>
    entities.reduce((s, e) => s + (pivot.get(d)?.get(e.id) ?? 0), 0),
  );

  const { getReason, refetchReasons } = useGapReasonLookup(entityType, entities, dates);
  const { user } = useAuth();

  // Single shared dialog for the whole table, rather than one per cell —
  // avoids mounting hundreds of AlertDialog instances for a large pivot.
  // Holds whichever blank cell was last clicked, or null when closed.
  const [gapTarget, setGapTarget] = useState<{
    entityId: string; entityLabel: string; dateKey: string; existing: GapReasonHit | null;
  } | null>(null);
  const [gapSaving, setGapSaving] = useState(false);

  const today = new Date(); today.setHours(23, 59, 59, 999);

  const saveGapReason = async (category: string, detail: string) => {
    if (!gapTarget || !entityType) return;
    setGapSaving(true);
    // reading_gap_reasons.plant_id is NOT NULL, but the entity's plant isn't
    // reliably available this far down (locator_readings in particular
    // carries no plant_id — see GAP_ENTITY_TABLE's comment), so resolve it
    // directly from the entity's own row at save time instead of threading
    // a plant map through every layer between here and TrendChart.tsx.
    const { data: entityRow, error: entityErr } = await (supabase.from(GAP_ENTITY_TABLE[entityType] as never) as any)
      .select('plant_id')
      .eq('id', gapTarget.entityId)
      .single();
    if (entityErr || !entityRow?.plant_id) {
      setGapSaving(false);
      toast.error("Couldn't determine this entity's plant — try again.");
      return;
    }
    const { error } = await supabase.from('reading_gap_reasons' as any).upsert(
      [{
        entity_type: entityType, entity_id: gapTarget.entityId, plant_id: entityRow.plant_id,
        gap_date: gapTarget.dateKey, reason_category: category, reason_detail: detail || null,
        logged_by: user?.id ?? null,
      }] as any,
      { onConflict: 'entity_type,entity_id,gap_date' },
    );
    setGapSaving(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success(`${gapTarget.entityLabel}: reason logged for ${fmtDateKey(gapTarget.dateKey)}`);
    setGapTarget(null);
    refetchReasons();
  };

  if (entities.length === 0) {
    return <div className="flex items-center justify-center h-24 text-xs text-muted-foreground">No entity data found.</div>;
  }

  return (
    // Single scroll container for header + body together (was two separate
    // overflow-x-auto/overflow-auto divs, each with its own scrollbar and no
    // link between them — scrolling one didn't move the other, so header and
    // data columns fell out of alignment). One <table> now shares one
    // <colgroup>, so column widths can't drift between header and body
    // either. The header row stays pinned via `sticky top-0` on its cells
    // (see TH/TH_DATE/TH_TOTAL) instead of living in a non-scrolling div.
    <div className="h-full overflow-auto">
      <table className="border-collapse text-xs w-full table-fixed" style={{ minWidth: `${72 + entities.length * 72 + 80}px` }}>
        <colgroup>
          <col style={{ width: '72px', minWidth: '72px' }} />
          {entities.map((e) => <col key={e.id} style={{ minWidth: '72px' }} />)}
          <col style={{ width: '80px', minWidth: '80px' }} />
        </colgroup>
        <thead>
          <tr className="bg-muted/95">
            <th className={TH_DATE}>Date</th>
            {entities.map((e) => (
              <th key={e.id} className={TH} title={e.label}>
                <div className="text-center leading-tight break-words hyphens-auto" style={{ wordBreak: 'break-word' }}>{e.label}</div>
                <div className="text-3xs font-normal opacity-60 mt-0.5">{unit}</div>
              </th>
            ))}
            <th className={TH_TOTAL}>{totalLabel}<br /><span className="text-3xs font-normal opacity-80">{unit}</span></th>
          </tr>
        </thead>
        <tbody>
          {[...dates].reverse().map((date, di) => {
            const isEven = di % 2 === 0;
            const rowIdx = dates.length - 1 - di;
            const rowTotal = rowTotals[rowIdx];
            return (
              <tr key={date} className={isEven ? 'bg-background hover:bg-muted/15' : 'bg-muted/10 hover:bg-muted/25'}>
                <td className={[
                  'px-3 py-1.5 whitespace-nowrap font-medium text-xs text-muted-foreground sticky left-0 z-10 border-r border-border',
                  isEven ? 'bg-background' : 'bg-muted/10',
                ].join(' ')}>
                  {fmtDateKey(date)}
                </td>
                {entities.map((e) => {
                  const val = pivot.get(date)?.get(e.id) ?? null;
                  const reason = getReason(e.id, date);
                  // Only wells/locators/RO trains carry a gap-reason lookup
                  // (entityType set — see the callers in
                  // TrendChartDataSummaryPopup.tsx); plain product meters
                  // keep today's non-interactive dash. Future dates can't be
                  // explained yet either, so they stay non-interactive too.
                  const isPastOrToday = new Date(date + 'T00:00:00').getTime() <= today.getTime();
                  const canLog = !!entityType && isPastOrToday;
                  const reasonTitle = reason
                    ? `${reasonEntityPrefix(entityType!, reason.source === 'status')}: ${reasonCategoryLabel(reason.category)}${reason.detail ? ' — ' + reason.detail : ''}`
                    : '';
                  return (
                    <td key={e.id} className={TD}>
                      {val != null ? (
                        reason ? (
                          // Both value (backfilled or real) and reason note exist: icon first, then number so decimals align
                          <div className="inline-flex items-center justify-end gap-1 w-full">
                            <button
                              type="button"
                              onClick={() => setGapTarget({ entityId: e.id, entityLabel: e.label, dateKey: date, existing: reason })}
                              title={`${reasonTitle} (click to edit note)`}
                              className="inline-flex items-center justify-center text-warn cursor-pointer hover:opacity-70 transition-opacity shrink-0"
                              data-testid={`pivot-gap-icon-${e.id}-${date}`}
                            >
                              <MessageCircleOff className="h-3 w-3" />
                            </button>
                            <span className={val != null && val < 0 ? 'text-destructive font-semibold' : ''}>{fmtV(val)}</span>
                          </div>
                        ) : (
                          val != null && val < 0 ? <span className="text-destructive font-semibold">{fmtV(val)}</span> : fmtV(val)
                        )
                      ) : reason && canLog ? (
                        // Has a reason on file — either a per-day gap entry, or
                        // one inferred from a multi-day Offline/Inactive
                        // interval (source: 'status'). Either way, clicking
                        // writes a day-specific reading_gap_reasons row, which
                        // always takes precedence over the inferred interval
                        // (see getReason above) — so this lets an operator
                        // layer a more specific note onto one day of a longer
                        // offline stretch without touching the status log.
                        <button
                          type="button"
                          onClick={() => setGapTarget({ entityId: e.id, entityLabel: e.label, dateKey: date, existing: reason })}
                          title={`${reasonTitle} (click to edit)`}
                          className="inline-flex items-center justify-center text-warn cursor-pointer hover:opacity-70 transition-opacity"
                          data-testid={`pivot-gap-icon-${e.id}-${date}`}
                        >
                          <MessageCircleOff className="h-3 w-3" />
                        </button>
                      ) : reason ? (
                        // Only reachable for a future date (see canLog) —
                        // read-only, matching the original behavior.
                        <span
                          title={reasonTitle}
                          className="inline-flex items-center justify-center text-warn cursor-help"
                        >
                          <MessageCircleOff className="h-3 w-3" />
                        </span>
                      ) : canLog ? (
                        // Blank cell, no reason on file yet — click to log one.
                        <button
                          type="button"
                          onClick={() => setGapTarget({ entityId: e.id, entityLabel: e.label, dateKey: date, existing: null })}
                          title="No reading — click to log why"
                          className="text-muted-foreground/40 hover:text-warn transition-colors cursor-pointer"
                          data-testid={`pivot-gap-empty-${e.id}-${date}`}
                        >
                          —
                        </button>
                      ) : val != null && val < 0 ? <span className="text-destructive font-semibold">{fmtV(val)}</span> : fmtV(val)}
                    </td>
                  );
                })}
                <td className={[
                  TD_TOTAL_COL,
                  colorClass,
                  isEven ? 'bg-background' : 'bg-muted/10',
                ].join(' ')}>
                  {rowTotal !== 0 ? <span className={rowTotal < 0 ? 'text-destructive font-semibold' : ''}>{rowTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <ReasonDialog
        open={!!gapTarget}
        onOpenChange={(o) => { if (!o) setGapTarget(null); }}
        title={
          gapTarget
            ? `No reading — why? (${gapTarget.entityLabel}, ${fmtDateKey(gapTarget.dateKey)})`
            : ''
        }
        description="This explains the gap in Data Summary for this date. If a reading later comes in for this day, it takes priority over this note."
        confirmLabel={gapTarget?.existing ? 'Update reason' : 'Log reason'}
        busy={gapSaving}
        onConfirm={saveGapReason}
      />
    </div>
  );
}

/** Overview tab — aggregated columns only (matches original single-column layout) */
export function OverviewTable({
  metric,
  chartData,
}: {
  metric: string;
  chartData: any[];
}) {
  if (chartData.length === 0) {
    return <div className="flex items-center justify-center h-24 text-xs text-muted-foreground">No data in selected range.</div>;
  }

  // Determine columns for this metric
  type ColDef = { key: string; label: string; fmt: (d: any) => React.ReactNode };

  const cols: ColDef[] = [];

  if (metric === 'production' || metric === 'nrw') {
    cols.push({
      key: 'production', label: 'Production (m³)',
      fmt: (d) => d.production != null ? <span className={d.production < 0 ? 'text-destructive font-semibold' : ''}>{d.production.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> : '—',
    });
    cols.push({
      key: 'consumption', label: 'Consumption (m³)',
      fmt: (d) => d.consumption != null ? <span className={d.consumption < 0 ? 'text-destructive font-semibold' : ''}>{d.consumption.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> : '—',
    });
  }
  if (metric === 'nrw') {
    cols.push({
      key: 'nrw', label: 'NRW (%)',
      fmt: (d) => <span className={d.nrw != null && d.nrw > 20 ? 'text-danger font-semibold' : ''}>{d.nrw != null ? d.nrw + '%' : '—'}</span>,
    });
  }
  if (metric === 'rawwater') {
    cols.push({
      key: 'rawwater', label: 'Raw Water (m³)',
      fmt: (d) => d.rawwater != null ? <span className={d.rawwater < 0 ? 'text-destructive font-semibold' : ''}>{d.rawwater.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> : '—',
    });
  }
  if (metric === 'recovery') {
    cols.push({
      key: 'recovery', label: 'Recovery (%)',
      fmt: (d) => d.recovery != null ? d.recovery + '%' : '—',
    });
  }
  if (metric === 'tds') {
    cols.push({
      key: 'tds', label: 'Permeate TDS (ppm)',
      fmt: (d) => d.tds != null ? d.tds + ' ppm' : '—',
    });
  }
  if (metric === 'pv') {
    cols.push(
      { key: 'production', label: 'Production (m³)', fmt: (d) => d.production != null ? <span className={d.production < 0 ? 'text-destructive font-semibold' : ''}>{d.production.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> : '—' },
      { key: 'kwh', label: 'Grid (kWh)', fmt: (d) => d.kwh != null ? <span className={d.kwh < 0 ? 'text-destructive font-semibold' : ''}>{d.kwh.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> : '—' },
      { key: 'solarKwh', label: 'Solar (kWh)', fmt: (d) => (d.solarKwh ?? 0) !== 0 ? <span className={d.solarKwh < 0 ? 'text-destructive font-semibold' : ''}>{d.solarKwh.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> : '—' },
      { key: 'pvGrid', label: 'Grid PV (kWh/m³)', fmt: (d) => d.production > 0 ? (d.kwh / d.production).toFixed(2) : '—' },
      { key: 'pvTotal', label: '(Grid+Solar) PV (kWh/m³)', fmt: (d) => d.production > 0 && (d.kwh + d.solarKwh) > 0 ? ((d.kwh + d.solarKwh) / d.production).toFixed(2) : '—' },
    );
  }
  if (metric === 'productionCost') {
    cols.push(
      { key: 'powerCost', label: 'Power (₱/m³)', fmt: (d) => d.powerCost != null ? `₱${(+d.powerCost).toFixed(4)}/m³` : '—' },
      { key: 'chemCost',  label: 'Chem (₱/m³)',  fmt: (d) => d.chemCost  != null ? `₱${(+d.chemCost).toFixed(4)}/m³`  : '—' },
      { key: 'totalCost', label: 'Prod Cost (₱/m³)', fmt: (d) => d.totalCost != null ? `₱${(+d.totalCost).toFixed(4)}/m³` : '—' },
    );
  }
  // chemCost and powerCost are now part of productionCost (₱/m³ toggles)
  if (metric === 'kwh') {
    cols.push(
      {
        key: 'solarKwh',
        label: '☀ Solar (kWh)',
        fmt: (d) => (d.solarKwh ?? 0) !== 0
          ? <span className={+d.solarKwh < 0 ? 'text-destructive font-semibold' : ''}>{(+d.solarKwh).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          : <span className="text-muted-foreground/40">—</span>,
      },
      {
        key: 'kwh',
        label: '⚡ Grid (kWh)',
        fmt: (d) => (d.kwh ?? 0) !== 0
          ? <span className={+d.kwh < 0 ? 'text-destructive font-semibold' : ''}>{(+d.kwh).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          : <span className="text-muted-foreground/40">—</span>,
      },
      {
        key: 'totalKwh',
        label: 'Total (kWh)',
        fmt: (d) => {
          const t = (d.solarKwh ?? 0) + (d.kwh ?? 0);
          return t > 0
            ? <span className="font-semibold text-primary">{t.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            : <span className="text-muted-foreground/40">—</span>;
        },
      },
      {
        key: 'solarPct',
        label: 'Solar %',
        fmt: (d) => {
          const t = (d.solarKwh ?? 0) + (d.kwh ?? 0);
          return t > 0 && (d.solarKwh ?? 0) > 0
            ? <span className="text-warn font-medium">{(((d.solarKwh ?? 0) / t) * 100).toFixed(1)}%</span>
            : <span className="text-muted-foreground/40">—</span>;
        },
      },
    );
  }

  return (
    // Same fix as PivotTable above: one table, one scroll container, sticky
    // header instead of a second independently-scrolling header div.
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead className="bg-muted/95">
          <tr>
            <th className={TH_DATE}>Date</th>
            {cols.map((c) => <th key={c.key} className={TH}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {[...chartData].reverse().map((d, i) => (
            <tr key={d.date} className={i % 2 === 0 ? 'bg-background hover:bg-muted/15' : 'bg-muted/10 hover:bg-muted/25'}>
              <td className={[
                'px-3 py-1.5 whitespace-nowrap font-medium text-xs text-muted-foreground sticky left-0 z-10',
                i % 2 === 0 ? 'bg-background' : 'bg-muted/10',
              ].join(' ')}>{d.date}</td>
              {cols.map((c) => <td key={c.key} className={TD}>{c.fmt(d)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Grid-by-meter breakdown table (kWh Data Summary side table) ──────────────
// Sits next to the Solar vs Grid OverviewTable for metric === 'kwh'. Rows are
// date-for-date aligned with the left table via `dates` (the popup's
// overviewDates, yyyy-MM-dd keys) — days without per-meter data render as
// dashes. The Total column always equals the Solar vs Grid table's Grid (kWh)
// value for the same day (guaranteed by computeGridMeterBreakdown's parity
// with the chart's grid-kWh walk).
export function GridMeterBreakdownTable({
  dates,
  breakdown,
}: {
  dates: string[];
  breakdown: GridMeterBreakdown;
}) {
  const { columns, byDate, hasUnattributed } = breakdown;
  const cols: GridMeterColumn[] = hasUnattributed
    ? [...columns, {
        key: GRID_METER_OTHER_KEY,
        label: 'Other',
        title: 'Days recorded as a stored daily total without per-meter readings — cannot be attributed to a specific meter.',
      }]
    : columns;

  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead className="bg-muted/95">
          <tr>
            <th className={TH_DATE}>Date</th>
            {cols.map((c) => <th key={c.key} className={TH} title={c.title}>{c.label}</th>)}
            <th className={TH_TOTAL}>Total (kWh)</th>
          </tr>
        </thead>
        <tbody>
          {[...dates].reverse().map((dk, i) => {
            const row = byDate.get(dk);
            const zebra = i % 2 === 0 ? 'bg-background' : 'bg-muted/10';
            return (
              <tr key={dk} className={`${zebra} hover:bg-muted/25`}>
                <td className={`px-3.5 py-1.5 whitespace-nowrap font-medium text-xs text-muted-foreground sticky left-0 z-10 ${zebra}`}>
                  {fmtDateKey(dk)}
                </td>
                {cols.map((c) => {
                  const v = row?.values[c.key];
                  return (
                    <td key={c.key} className={TD}>
                      {v != null
                        ? <span className={v < 0 ? 'text-destructive font-semibold' : ''}>{v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        : <span className="text-muted-foreground/40">—</span>}
                    </td>
                  );
                })}
                <td className={TD_TOTAL_COL}>
                  {row && row.total > 0
                    ? row.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    : <span className="text-muted-foreground/40">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
