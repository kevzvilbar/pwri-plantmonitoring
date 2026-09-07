import React, { useState, useMemo } from 'react';
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
} from '../TrendChartPivotShared';

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
                <div className="text-right leading-tight break-words hyphens-auto" style={{ wordBreak: 'break-word' }}>{e.label}</div>
                <div className="text-3xs font-normal opacity-60 mt-0.5 text-right">{unit}</div>
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
                  const hasVal = val != null && val !== 0;
                  return (
                    <td key={e.id} className={TD}>
                      {hasVal ? (
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
                            <span className={val < 0 ? 'text-destructive font-semibold' : ''}>{fmtV(val)}</span>
                          </div>
                        ) : (
                          val < 0 ? <span className="text-destructive font-semibold">{fmtV(val)}</span> : fmtV(val)
                        )
                      ) : reason && canLog ? (
                        // Has a reason on file, but no non-zero reading: show ONLY the note icon (never combine with dash)
                        <button
                          type="button"
                          onClick={() => setGapTarget({ entityId: e.id, entityLabel: e.label, dateKey: date, existing: reason })}
                          title={`${reasonTitle} (click to edit note)`}
                          className="inline-flex items-center justify-center text-warn cursor-pointer hover:opacity-70 transition-opacity"
                          data-testid={`pivot-gap-icon-${e.id}-${date}`}
                        >
                          <MessageCircleOff className="h-3 w-3" />
                        </button>
                      ) : reason ? (
                        // Read-only reason note on empty cell: show ONLY the note icon
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
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
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
