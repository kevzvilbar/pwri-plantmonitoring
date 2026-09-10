import React, { useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { ReadingHistoryDialog } from '@/components/ReadingHistoryDialog';
import { ReplaceMeterDialog } from '@/pages/plants/locators/LocatorDialogs';
import { ReasonDialog } from '@/components/ReasonDialog';
import { CorrectionReasonField } from '@/components/CorrectionReasonField';
import { StatusPill } from '@/components/StatusPill';
import { AnomalyRemarkBanner } from '@/components/AnomalyRemarkBanner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { fmtNum, ALERTS } from '@/lib/calculations';
import { computeRate, classifyDeviation } from '@/lib/flowRateGuards';
import { fmtSaveToast, lastReadingFreshness } from '@/lib/format';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { submitAnomalyRemark, isAnomalyRemarkValid } from '@/lib/anomalyRemarks';
import { isReasonComplete, resolveReason } from '@/lib/correctionReasons';
import { reasonCategoryLabel } from '@/lib/reasonCodes';
import { logReadingEdit, diffFields, canEditEntry } from '@/pages/ro-trains/helpers';
import { logProductionCalc, invalidateProductMeterDash } from '@/pages/operations/shared';
import { Gauge, Droplet, Pencil, X, Loader2, AlertCircle } from 'lucide-react';

interface ProductMeterHistoryDialogProps {
  meter: any;
  plantId: string;
  onClose: () => void;
}

export function ProductMeterHistoryDialog({ meter, plantId, onClose }: ProductMeterHistoryDialogProps) {
  const qc = useQueryClient();
  const { user, activeOperator, isAdmin, isManager, isDataAnalyst, activeOperatorId } = useAuth();
  const hasFullAccess = isAdmin || isManager || isDataAnalyst;
  const [days, setDays] = useState<7 | 14 | 30 | 60 | 'custom'>(30);
  const [customFrom, setCustomFrom] = useState(format(new Date(Date.now() - 30 * 86400000), 'yyyy-MM-dd'));
  const [customTo, setCustomTo]     = useState(format(new Date(), 'yyyy-MM-dd'));
  const [appliedFrom, setAppliedFrom] = useState(customFrom);
  const [appliedTo, setAppliedTo]     = useState(customTo);
  const [editRow, setEditRow] = useState<{ id: string; datetime: string; value: string } | null>(null);
  const [reason, setReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [replaceReadingId, setReplaceReadingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const WINDOWS = [{ label: '7D', days: 7 }, { label: '14D', days: 14 }, { label: '30D', days: 30 }, { label: '60D', days: 60 }] as const;

  const localMidnight = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  const queryKey = ['product-meter-history', meter.id, days, appliedFrom, appliedTo];

  const { data: rows, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      let sinceIso: string;
      let untilIso: string;
      if (days === 'custom') {
        sinceIso = localMidnight(appliedFrom).toISOString();
        const end = localMidnight(appliedTo);
        end.setHours(23, 59, 59, 999);
        untilIso = end.toISOString();
      } else {
        const since = new Date();
        since.setDate(since.getDate() - days);
        sinceIso = since.toISOString();
        untilIso = new Date().toISOString();
      }
      const { data, error } = await supabase
        .from('product_meter_readings' as any)
        .select('id, current_reading, previous_reading, daily_volume, reading_datetime, is_meter_replacement, is_estimated, recorded_by, created_at, norm_status')
        .eq('meter_id', meter.id)
        .gte('reading_datetime', sinceIso)
        .lte('reading_datetime', untilIso)
        .order('reading_datetime', { ascending: false });
      if (!error) return (data ?? []) as any[];
      const { data: fallback, error: fallbackErr } = await supabase
        .from('product_meter_readings' as any)
        .select('id, current_reading, previous_reading, daily_volume, reading_datetime, is_estimated, recorded_by, created_at, norm_status')
        .eq('meter_id', meter.id)
        .gte('reading_datetime', sinceIso)
        .lte('reading_datetime', untilIso)
        .order('reading_datetime', { ascending: false });
      if (fallbackErr) throw fallbackErr;
      return (fallback ?? []) as any[];
    },
  });

  const resyncMeterChain = async (meterId: string) => {
    if (meter.is_derived) return;
    const { data: all, error } = await supabase
      .from('product_meter_readings' as any)
      .select('id, current_reading, previous_reading, daily_volume, reading_datetime')
      .eq('meter_id', meterId)
      .order('reading_datetime', { ascending: true });
    if (error || !all) return;

    let last: number | null = null;
    const updates: { id: string; previous_reading: number | null; daily_volume: number | null }[] = [];
    for (const row of all as any[]) {
      const newPrev = last;
      const newVol = newPrev != null ? +row.current_reading - newPrev : null;
      if (row.previous_reading !== newPrev || row.daily_volume !== newVol) {
        updates.push({ id: row.id, previous_reading: newPrev, daily_volume: newVol });
      }
      last = +row.current_reading;
    }
    if (updates.length) {
      await Promise.all(updates.map(u => supabase
        .from('product_meter_readings' as any)
        .update({ previous_reading: u.previous_reading, daily_volume: u.daily_volume } as any)
        .eq('id', u.id)));
    }
  };

  const actorLabel = () =>
    `${activeOperator?.first_name ?? ''} ${activeOperator?.last_name ?? ''}`.trim()
    || activeOperator?.username || null;

  const saveEdit = async () => {
    if (!editRow) return;
    const beforeRowCheck = rows?.find((r: any) => r.id === editRow.id);
    if (!beforeRowCheck || !canEditEntry(beforeRowCheck, hasFullAccess, activeOperatorId)) {
      toast.error(
        beforeRowCheck?.norm_status === 'pending_review'
          ? 'This reading is flagged and awaiting review in Data Corrections — it can’t be edited until a reviewer approves or rejects it.'
          : 'You can only edit your own entries, within 8 hours of submitting them.',
      );
      setEditRow(null);
      return;
    }
    if (!reason) { toast.error('Select a reason for this edit'); return; }
    if (!isReasonComplete(reason, customReason)) { toast.error('Describe the reason for this edit'); return; }
    setSaving(true);
    const newCur = +editRow.value;
    const beforeRow = beforeRowCheck ?? null;
    let updatePayload: Record<string, any>;
    if (meter.is_derived) {
      updatePayload = {
        current_reading: newCur,
        previous_reading: 0,
        daily_volume: newCur,
        reading_datetime: new Date(editRow.datetime).toISOString(),
        is_estimated: false,
      };
    } else {
      const existingRow = rows?.find((r: any) => r.id === editRow.id);
      const existingPrev = existingRow?.previous_reading;
      const newDailyVol = existingPrev != null ? newCur - existingPrev : null;
      updatePayload = {
        current_reading: newCur,
        reading_datetime: new Date(editRow.datetime).toISOString(),
        daily_volume: newDailyVol,
      };
    }
    const { error } = await supabase.from('product_meter_readings' as any)
      .update(updatePayload as any).eq('id', editRow.id);
    if (error) { setSaving(false); toast.error(friendlyError(error)); return; }
    await resyncMeterChain(meter.id);
    await logReadingEdit({
      table_name:    'product_meter_readings',
      record_id:     editRow.id,
      plant_id:      plantId,
      actor_user_id: user?.id ?? null,
      actor_label:   actorLabel(),
      changes:       diffFields(beforeRow ?? {}, updatePayload),
      reason:        resolveReason(reason, customReason),
    });
    setSaving(false);
    toast.success('Reading updated');
    setEditRow(null); setReason(''); setCustomReason('');
    qc.invalidateQueries({ queryKey });
    invalidateProductMeterDash(qc);
  };

  const toggleMeterReplacement = async (r: any) => {
    const next = !r.is_meter_replacement;
    if (next) {
      setReplaceReadingId(r.id);
      return;
    }
    setTogglingId(r.id);
    const { error } = await (supabase.from('product_meter_readings' as any) as any)
      .update({ is_meter_replacement: next }).eq('id', r.id);
    if (error) {
      setTogglingId(null);
      if (error.message?.includes('does not exist') || error.message?.includes('is_meter_replacement')) return;
      toast.error(friendlyError(error));
      return;
    }
    await resyncMeterChain(meter.id);
    setTogglingId(null);
    toast.success(next ? 'Marked as meter replacement — Δ zeroed' : 'Meter replacement flag removed');
    qc.invalidateQueries({ queryKey });
    invalidateProductMeterDash(qc);
  };

  const deleteRow = async (id: string) => {
    const row = rows?.find((r: any) => r.id === id);
    if (!row || !canEditEntry(row, hasFullAccess, activeOperatorId)) {
      toast.error(
        row?.norm_status === 'pending_review'
          ? 'This reading is flagged and awaiting review in Data Corrections — it can’t be deleted until a reviewer approves or rejects it.'
          : 'You can only delete your own entries, within 8 hours of submitting them.',
      );
      setPendingDeleteId(null);
      return;
    }
    setPendingDeleteId(null);
    setDeletingId(id);
    const { error } = await supabase.from('product_meter_readings' as any).delete().eq('id', id);
    if (error) { setDeletingId(null); toast.error(friendlyError(error)); return; }
    await logReadingEdit({
      table_name:    'product_meter_readings',
      record_id:     id,
      plant_id:      plantId,
      action:        'delete',
      actor_user_id: user?.id ?? null,
      actor_label:   actorLabel(),
    });
    await resyncMeterChain(meter.id);
    setDeletingId(null);
    toast.success('Reading deleted');
    qc.invalidateQueries({ queryKey });
    invalidateProductMeterDash(qc);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-1.5">
            <Gauge className="h-4 w-4 text-primary" /> {meter.name} — History
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
            {WINDOWS.map(({ label, days: d }) => (
              <button key={label} onClick={() => { setDays(d as any); setEditRow(null); }}
                className={['px-3 py-1 text-xs font-medium rounded-md transition-all',
                  days === d ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}>{label}</button>
            ))}
            <button onClick={() => { setDays('custom'); setEditRow(null); }}
              className={['px-3 py-1 text-xs font-medium rounded-md transition-all',
                days === 'custom' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}>Custom</button>
          </div>
          {days === 'custom' && (
            <div className="flex items-center gap-1.5">
              <input type="date" value={customFrom} max={customTo}
                onChange={e => setCustomFrom(e.target.value)}
                className="h-7 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
              <span className="text-xs text-muted-foreground">to</span>
              <input type="date" value={customTo} min={customFrom} max={format(new Date(), 'yyyy-MM-dd')}
                onChange={e => setCustomTo(e.target.value)}
                className="h-7 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
              <Button size="sm" className="h-7 px-3 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={() => { setAppliedFrom(customFrom); setAppliedTo(customTo); setEditRow(null); }}>
                Apply
              </Button>
            </div>
          )}
        </div>

        {editRow && (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2 text-xs">
            <p className="font-medium">Editing reading</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="productsection-date-amp-time" className="text-xs">Date &amp; Time</Label>
                <Input type="datetime-local" value={editRow.datetime}
                  onChange={e => setEditRow({ ...editRow, datetime: e.target.value })} className="h-8 text-xs" id="productsection-date-amp-time"/>
              </div>
              <div>
                <Label htmlFor="productsection-field" className="text-xs">{meter.is_derived ? 'Volume (m³)' : 'Reading'}</Label>
                <Input type="number" step="any" value={editRow.value}
                  onChange={e => setEditRow({ ...editRow, value: e.target.value })} className="h-8 text-xs" id="productsection-field"/>
              </div>
            </div>
            <CorrectionReasonField
              reason={reason} onReasonChange={setReason}
              customReason={customReason} onCustomReasonChange={setCustomReason}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={saveEdit} disabled={saving || !editRow.value || !isReasonComplete(reason, customReason)}
                className="bg-primary text-primary-foreground hover:bg-primary/90 h-7 text-xs px-3">
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save changes'}
              </Button>
              <Button size="sm" variant="outline"
                onClick={() => { setEditRow(null); setReason(''); setCustomReason(''); }}
                disabled={saving} className="h-7 text-xs px-3">Cancel</Button>
            </div>
          </div>
        )}

        {meter.is_derived && (
          <div className="flex items-center gap-1.5 rounded-md bg-primary-soft border border-primary/30 px-2.5 py-1.5 text-xs text-primary">
            <Droplet className="h-3 w-3 shrink-0" />
            This entity's input is already a period volume, so there's no Δ to compute — the value below is the volume itself.
          </div>
        )}

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
            <table className="w-full text-left">
              <thead className="bg-muted sticky top-0">
                <tr>
                  <th className="px-3 py-2 font-medium">Date & Time</th>
                  {meter.is_derived ? (
                    <th className="px-3 py-2 font-medium text-right">Volume (m³)</th>
                  ) : (
                    <>
                      <th className="px-3 py-2 font-medium text-right">Reading</th>
                      <th className="px-3 py-2 font-medium text-right">Production (m³)</th>
                    </>
                  )}
                  <th className="px-2 py-2 font-medium text-center">Repl.</th>
                  <th className="px-2 py-2 font-medium text-center w-16">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any, i: number) => {
                  const predecessor: any = rows[i + 1] ?? null;
                  const vol = predecessor != null ? r.current_reading - predecessor.current_reading : null;
                  const isEditing = editRow?.id === r.id;
                  const isDeleting = deletingId === r.id;
                  const isToggling = togglingId === r.id;
                  const isMeterReplacement = !!r.is_meter_replacement;
                  const isEstimated = !!r.is_estimated;
                  const rowEditable = canEditEntry(r, hasFullAccess, activeOperatorId);
                  return (
                    <tr key={r.id ?? i} className={[
                      'border-t',
                      isEditing            ? 'bg-primary-soft/60'
                      : isMeterReplacement ? 'bg-kpi-solar/40'
                      : isEstimated        ? 'bg-warn-soft/20'
                      : 'hover:bg-muted/40',
                    ].join(' ')}>
                      <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          {r.reading_datetime ? format(new Date(r.reading_datetime), 'MMM d, yyyy HH:mm') : '—'}
                          {isEstimated && (
                            <span className="text-3xs font-semibold uppercase tracking-wide text-warn bg-warn-soft/40 px-1 py-0.5 rounded leading-none border border-warn/40" title="Auto-backfilled reading">
                              Est.
                            </span>
                          )}
                          {isMeterReplacement && (
                            <span className="text-3xs font-semibold uppercase tracking-wide text-kpi-solar bg-kpi-solar/15 px-1 py-0.5 rounded leading-none">
                              repl.
                            </span>
                          )}
                        </span>
                      </td>
                      {meter.is_derived ? (
                        <td className={cn('px-3 py-1.5 text-right font-mono-num', (r.daily_volume ?? r.current_reading) < 0 ? 'text-destructive font-semibold' : 'text-primary')}>
                          {fmtNum(r.daily_volume ?? r.current_reading, 1)}
                        </td>
                      ) : (
                        <>
                          <td className="px-3 py-1.5 text-right font-mono-num">{fmtNum(r.current_reading, 1)}</td>
                          <td className="px-3 py-1.5 text-right font-mono-num text-primary">
                            {isMeterReplacement
                              ? <span className="text-kpi-solar font-medium">0.0</span>
                              : vol != null ? <span className={vol < 0 ? 'text-destructive font-semibold' : ''}>{fmtNum(vol, 1)}</span> : '—'
                            }
                          </td>
                        </>
                      )}
                      <td className="px-2 py-1.5 text-center">
                        <button
                          title={isMeterReplacement ? 'Meter replacement — click to unmark' : 'Mark as meter replacement (zeroes production)'}
                          aria-label={isMeterReplacement ? 'Meter replacement — click to unmark' : 'Mark as meter replacement (zeroes production)'}
                          disabled={isDeleting || isToggling}
                          onClick={() => toggleMeterReplacement(r)}
                          className={[
                            'inline-flex items-center justify-center w-5 h-5 rounded border transition-colors',
                            'disabled:opacity-40 disabled:cursor-not-allowed',
                            isMeterReplacement
                              ? 'bg-kpi-solar border-kpi-solar text-white hover:bg-kpi-solar/90'
                              : 'border-input bg-background hover:border-kpi-solar/90 hover:bg-kpi-solar/15',
                          ].join(' ')}
                        >
                          {isToggling
                            ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                            : isMeterReplacement ? <span className="text-3xs font-bold leading-none">✓</span> : null
                          }
                        </button>
                      </td>
                      <td className="px-2 py-1 text-center">
                        {rowEditable && (
                          <div className="flex items-center justify-center gap-0.5">
                            <button title="Edit" aria-label="Edit" disabled={!!editRow || isDeleting}
                              onClick={() => {
                                setPendingDeleteId(null);
                                setReason(''); setCustomReason('');
                                setEditRow({ id: r.id, datetime: format(new Date(r.reading_datetime), "yyyy-MM-dd'T'HH:mm"), value: String(r.current_reading) });
                              }}
                              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40">
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button title="Delete" aria-label="Delete" disabled={!!editRow || isDeleting}
                              onClick={() => setPendingDeleteId(r.id)}
                              className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-40">
                              {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-2xs text-muted-foreground">
          {days === 'custom' ? `Showing ${appliedFrom} → ${appliedTo}` : `Showing up to ${days} days`} · {rows?.length ?? 0} records
        </p>

        <AlertDialog open={!!pendingDeleteId} onOpenChange={(o) => !o && setPendingDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this reading?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently remove the reading. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => pendingDeleteId && deleteRow(pendingDeleteId)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {replaceReadingId && (
          <ReplaceMeterDialog
            kind="product"
            assetId={meter.id}
            plantId={plantId}
            oldSerial={meter.meter_serial ?? null}
            readingId={replaceReadingId}
            onSuccess={() => {
              qc.invalidateQueries({ queryKey });
              invalidateProductMeterDash(qc);
            }}
            onClose={() => setReplaceReadingId(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
