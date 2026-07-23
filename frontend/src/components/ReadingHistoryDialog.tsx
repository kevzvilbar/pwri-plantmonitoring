import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useIsMobile } from '@/hooks/use-mobile';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { friendlyError } from '@/lib/supabaseErrors';
import { useDraft } from '@/hooks/useDraft';
import { CorrectionRequestDialog } from '@/components/CorrectionRequestDialog';
import type { CorrectionTarget } from '@/components/CorrectionRequestDialog';
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
import { fmtNum, getCurrentPosition, isOffLocation, ALERTS } from '@/lib/calculations';
import { fmtSaveToast } from '@/lib/format';
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

// High-voltage transmission tower icon — matches Plants.tsx grid icon exactly.


export type HistoryModule = 'locator' | 'well' | 'blending' | 'power';
const HISTORY_WINDOWS = [
  { label: '7D', days: 7 },
  { label: '14D', days: 14 },
  { label: '30D', days: 30 },
  { label: '60D', days: 60 },
] as const;

// Inline edit state for a history row
export interface HistoryEditState {
  id: string;
  datetime: string;          // "yyyy-MM-dd'T'HH:mm"
  value: string;             // primary numeric field
  value2?: string;           // secondary (power for well, or solar for power)
  value3?: string;           // tertiary (grid for power)
  value4?: string;           // TDS ppm (well)
  value5?: string;           // pressure psi (well)
  value6?: string;           // turbidity NTU (well)
  isMeterReplacement?: boolean;
  /** True only when is_meter_replacement was actually returned by the SELECT query.
   *  When false/undefined the column is absent from the schema cache and must be
   *  omitted from the UPDATE payload to avoid the PostgREST
   *  "relation 'well_readings' does not exist" error. */
  hasMeterReplacement?: boolean;
}

export function ReadingHistoryDialog({ entityName, module, entityId, plantId, multiplier = 1,
  gridMeterCount: gridMeterCountProp = 1, gridMeterNames = [], gridMultipliers = [], meterFilter, onClose }: {
  entityName: string;
  module: HistoryModule;
  entityId: string;
  plantId?: string;
  /** CT multiplier for meter-0 (fallback when gridMultipliers is absent). Defaults to 1. */
  multiplier?: number;
  /** Number of grid meters configured for this plant. Defaults to 1. */
  gridMeterCount?: number;
  /** Display labels for each grid meter (index-aligned). Falls back to "Grid Meter N". */
  gridMeterNames?: string[];
  /** Per-meter CT multipliers (index-aligned). Falls back to `multiplier` prop. */
  gridMultipliers?: number[];
  /** When set, scopes the power history to a single meter (solar or grid-N). */
  meterFilter?: { type: 'solar'; idx: number } | { type: 'grid'; idx: number };
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [days, setDays] = useState<7 | 14 | 30 | 60 | 'custom'>(30);
  const [customFrom, setCustomFrom] = useState(format(new Date(Date.now() - 30 * 86400000), 'yyyy-MM-dd'));
  const [customTo, setCustomTo]     = useState(format(new Date(), 'yyyy-MM-dd'));
  const [appliedFrom, setAppliedFrom] = useState(customFrom);
  const [appliedTo, setAppliedTo]     = useState(customTo);
  const [editRow, setEditRow] = useState<HistoryEditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [togglingGridId, setTogglingGridId] = useState<string | null>(null);
  const [togglingSolarId, setTogglingSolarId] = useState<string | null>(null);
  // Delete confirmation now goes through an AlertDialog (themed, works in iframes,
  // unlike the native window.confirm() this previously used).
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [bulkDeletePending, setBulkDeletePending] = useState(false);

  // Helper: parse a YYYY-MM-DD string as LOCAL midnight (avoids UTC timezone shift)
  const localMidnight = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  // ── Multi-meter helpers (power module) ─────────────────────────────────────
  const resolvedGridCount = Math.max(1, gridMeterCountProp);
  const getHistGridLabel = (idx: number): string =>
    gridMeterNames[idx] ?? (resolvedGridCount === 1 ? 'Grid Meter' : `Grid Meter ${idx + 1}`);
  const getHistGridMult = (idx: number): number =>
    Array.isArray(gridMultipliers) && +gridMultipliers[idx] > 0
      ? +gridMultipliers[idx]
      : multiplier;

  const queryKey = ['reading-history', module, entityId, days, appliedFrom, appliedTo];

  const { data: rows, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      // Use date-only strings (YYYY-MM-DD) for all filters — avoids UTC offset
      // cutting off records that were saved in a different timezone.
      let sinceDate: string;
      let untilNextDay: string; // exclusive upper bound = day after end date
      // Pure local-date arithmetic — avoids UTC offset shifting the date back
      // (e.g. UTC+8 would turn 2026-05-08T00:00:00 local → 2026-05-07T16:00:00Z).
      const _localStr = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const _addDay = (s: string, n: number) => {
        const [y, m, day] = s.split('-').map(Number);
        return _localStr(new Date(y, m - 1, day + n));
      };
      if (days === 'custom') {
        sinceDate = appliedFrom;
        untilNextDay = _addDay(appliedTo, 1);
      } else {
        sinceDate = _localStr(new Date(Date.now() - days * 86400_000));
        untilNextDay = _addDay(_localStr(new Date()), 1);
      }

      if (module === 'locator') {
        const { data } = await supabase
          .from('locator_readings')
          .select('id, current_reading, previous_reading, reading_datetime, off_location_flag, is_meter_replacement')
          .eq('locator_id', entityId)
          .gte('reading_datetime', sinceDate)
          .lt('reading_datetime', untilNextDay)
          .order('reading_datetime', { ascending: false });
        return data ?? [];
      }
      if (module === 'well') {
        const { data, error } = await supabase
          .from('well_readings')
          .select('id, current_reading, previous_reading, power_meter_reading, tds_ppm, turbidity_ntu, pressure_psi, reading_datetime, is_meter_replacement')
          .eq('well_id', entityId)
          .gte('reading_datetime', sinceDate)
          .lt('reading_datetime', untilNextDay)
          .order('reading_datetime', { ascending: false });
        if (!error) return data ?? [];
        // Fallback: base columns only (optional migration columns tds_ppm / pressure_psi /
        // is_meter_replacement may not exist yet — avoid the PostgREST schema-cache error)
        const { data: fallback } = await supabase
          .from('well_readings')
          .select('id, current_reading, previous_reading, power_meter_reading, reading_datetime')
          .eq('well_id', entityId)
          .gte('reading_datetime', sinceDate)
          .lt('reading_datetime', untilNextDay)
          .order('reading_datetime', { ascending: false });
        return fallback ?? [];
      }
      if (module === 'power') {
        const { data, error } = await supabase
          .from('power_readings')
          .select('id, meter_reading_kwh, grid_meter_readings, daily_consumption_kwh, daily_solar_kwh, daily_grid_kwh, solar_meter_reading, reading_datetime, is_meter_replacement')
          .eq('plant_id', entityId)
          .gte('reading_datetime', sinceDate)
          .lt('reading_datetime', untilNextDay)
          .order('reading_datetime', { ascending: false });
        if (!error) return data ?? [];
        // Fallback: base columns only (optional migration columns missing)
        const { data: fallback } = await supabase
          .from('power_readings')
          .select('id, meter_reading_kwh, daily_consumption_kwh, reading_datetime, is_meter_replacement')
          .eq('plant_id', entityId)
          .gte('reading_datetime', sinceDate)
          .lt('reading_datetime', untilNextDay)
          .order('reading_datetime', { ascending: false });
        return fallback ?? [];
      }
      if (module === 'blending') {
        try {
          let q = (supabase.from('blending_events' as any) as any)
            .select('id, well_id, plant_id, well_name, plant_name, event_date, reading_datetime, volume_m3, noted_at, is_meter_replacement, raw_meter_reading')
            .eq('well_id', entityId)
            .order('event_date', { ascending: false });
          if (days === 'custom') {
            q = q.gte('event_date', customFrom.slice(0, 10)).lte('event_date', customTo.slice(0, 10));
          } else {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - (days as number));
            q = q.gte('event_date', cutoff.toISOString().slice(0, 10));
          }
          const { data, error } = await q;
          if (error) {
            // is_meter_replacement may not exist yet — retry without it
            if (error.message?.includes('is_meter_replacement') || error.message?.includes('raw_meter_reading') || error.message?.includes('does not exist')) {
              // Retry with only the guaranteed base columns — neither is_meter_replacement
              // nor raw_meter_reading may exist yet if the migration hasn't been run.
              let q2 = (supabase.from('blending_events' as any) as any)
                .select('id, well_id, plant_id, well_name, plant_name, event_date, volume_m3, noted_at')
                .eq('well_id', entityId)
                .order('event_date', { ascending: false });
              if (days === 'custom') {
                q2 = q2.gte('event_date', customFrom.slice(0, 10)).lte('event_date', customTo.slice(0, 10));
              } else {
                const cutoff = new Date();
                cutoff.setDate(cutoff.getDate() - (days as number));
                q2 = q2.gte('event_date', cutoff.toISOString().slice(0, 10));
              }
              const { data: d2, error: e2 } = await q2;
              if (e2) throw e2; // surface unexpected errors rather than silently returning []
              return (d2 ?? []).map((r: any) => ({ ...r, is_meter_replacement: false, raw_meter_reading: null }));
            }
            throw error;
          }
          return (data ?? []).map((r: any) => ({ ...r, is_meter_replacement: !!r.is_meter_replacement }));
        } catch { return []; }
      }
      return [];
    },
    staleTime: 0,
  });

  const startEdit = (r: any) => {
    const dt = r.reading_datetime ?? r.created_at ?? '';
    const dtStr = dt ? format(new Date(dt), "yyyy-MM-dd'T'HH:mm") : format(new Date(), "yyyy-MM-dd'T'HH:mm");
    if (module === 'well') {
      // Use undefined (not '') for optional columns that may be absent from
      // the DB row — the saveEdit guard checks `!== undefined` to decide
      // whether to include them in the UPDATE payload.  Setting '' instead
      // of undefined (the old behaviour) meant the guard never fired, and
      // every save sent tds_ppm/turbidity_ntu/pressure_psi to PostgREST
      // even when the schema cache didn't know about those columns yet,
      // producing the misleading "relation 'well_readings' does not exist".
      setEditRow({
        id: r.id,
        datetime: dtStr,
        value: String(r.current_reading ?? ''),
        value2: r.power_meter_reading != null ? String(r.power_meter_reading) : '',
        value4: 'tds_ppm'       in r ? (r.tds_ppm        != null ? String(r.tds_ppm)                  : '') : undefined,
        value6: 'turbidity_ntu' in r ? ((r as any).turbidity_ntu != null ? String((r as any).turbidity_ntu) : '') : undefined,
        value5: 'pressure_psi'  in r ? (r.pressure_psi   != null ? String(r.pressure_psi)              : '') : undefined,
        // Guard is_meter_replacement the same way as the quality columns above.
        // When the fallback SELECT was used the column is absent from r, so we
        // must not send it in the UPDATE payload or PostgREST rejects the whole
        // request with "relation 'well_readings' does not exist".
        hasMeterReplacement: 'is_meter_replacement' in r,
        isMeterReplacement: !!r.is_meter_replacement,
      });
    } else if (module === 'locator') {
      setEditRow({ id: r.id, datetime: dtStr, value: String(r.current_reading ?? ''), isMeterReplacement: !!r.is_meter_replacement });
    } else if (module === 'power') {
      setEditRow({ id: r.id, datetime: dtStr, value: String(r.meter_reading_kwh ?? ''), value2: r.solar_meter_reading != null ? String(r.solar_meter_reading) : '', value3: r.daily_grid_kwh != null ? String(r.daily_grid_kwh) : '', isMeterReplacement: !!r.is_meter_replacement });
    } else if (module === 'blending') {
      const eventDt = r.event_date ?? r.noted_at ?? '';
      const blendDtStr = eventDt ? format(new Date(eventDt), "yyyy-MM-dd'T'HH:mm") : format(new Date(), "yyyy-MM-dd'T'HH:mm");
      setEditRow({ id: r.id, datetime: blendDtStr, value: String(r.volume_m3 ?? ''), isMeterReplacement: !!r.is_meter_replacement });
    }
  };

  // One-click toggle for shared (non-power) meter replacement
  const toggleMeterReplacement = async (r: any) => {
    setTogglingId(r.id);
    const next = !r.is_meter_replacement;
    let error: any = null;
    if (module === 'well') {
      ({ error } = await (supabase.from('well_readings') as any).update({ is_meter_replacement: next }).eq('id', r.id));
      // is_meter_replacement may not exist yet (pending migration) — silently skip toggle
      if (error?.message?.includes('does not exist')) error = null;
    } else if (module === 'locator')
      ({ error } = await (supabase.from('locator_readings') as any).update({ is_meter_replacement: next }).eq('id', r.id));
    else if (module === 'blending') {
      ({ error } = await (supabase.from('blending_events' as any) as any).update({ is_meter_replacement: next }).eq('id', r.id));
      // Column may not exist yet — silently skip (graceful degradation)
      if (error?.message?.includes('does not exist') || error?.message?.includes('is_meter_replacement')) error = null;
    }
    setTogglingId(null);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success(next ? 'Marked as meter replacement — Δ zeroed' : 'Meter replacement flag removed');
    qc.invalidateQueries({ queryKey });
  };

  // Power-specific: toggle grid meter replacement
  const toggleGridReplacement = async (r: any) => {
    setTogglingGridId(r.id);
    // Use the same fallback as the display: is_grid_replacement ?? is_meter_replacement.
    // Without this, when is_grid_replacement is null the toggle always evaluates
    // !null → true and can never be unchecked.
    const currentRepl = !!(r.is_grid_replacement ?? r.is_meter_replacement);
    const next = !currentRepl;
    const { error } = await (supabase.from('power_readings') as any)
      .update({ is_grid_replacement: next }).eq('id', r.id);
    setTogglingGridId(null);
    if (error) {
      // Column may not exist yet — fall back to shared flag
      const { error: e2 } = await (supabase.from('power_readings') as any)
        .update({ is_meter_replacement: next }).eq('id', r.id);
      if (e2) { toast.error(friendlyError(e2)); return; }
    }
    // When flagging as replacement, reset the CT multiplier in plant_power_config to 1
    // so the operator must explicitly re-enter the new meter's ratio.
    if (next && plantId) {
      try {
        const existingArr = Array.isArray(gridMultipliers) ? [...gridMultipliers] : [1];
        existingArr[0] = 1;
        await (supabase.from('plant_power_config' as any) as any)
          .upsert(
            { plant_id: plantId, grid_meter_multipliers: existingArr, updated_at: new Date().toISOString() },
            { onConflict: 'plant_id' }
          );
        qc.invalidateQueries({ queryKey: ['plant-power-config', plantId] });
        toast.success('Grid replacement marked — Δ zeroed · CT multiplier reset to 1. Update it in Plants → Power.');
      } catch {
        toast.success('Grid replacement marked — Δ zeroed');
      }
    } else {
      toast.success(next ? 'Grid replacement marked — Δ zeroed' : 'Grid replacement flag removed');
    }
    qc.invalidateQueries({ queryKey });
  };

  // Power-specific: toggle solar meter replacement
  const toggleSolarReplacement = async (r: any) => {
    setTogglingSolarId(r.id);
    const next = !r.is_solar_replacement;
    const { error } = await (supabase.from('power_readings') as any)
      .update({ is_solar_replacement: next }).eq('id', r.id);
    setTogglingSolarId(null);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success(next ? 'Solar replacement marked — Δ zeroed' : 'Solar replacement flag removed');
    qc.invalidateQueries({ queryKey });
  };

  // Row selection helpers
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (!rows?.length) return;
    setSelectedIds(prev =>
      prev.size === rows.length ? new Set() : new Set(rows.map((r: any) => r.id))
    );
  };

  // Bulk delete
  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setBulkDeletePending(false);
    setBulkDeleting(true);
    const ids = [...selectedIds];
    let error: any = null;
    if (module === 'well')
      ({ error } = await supabase.from('well_readings').delete().in('id', ids));
    else if (module === 'locator')
      ({ error } = await supabase.from('locator_readings').delete().in('id', ids));
    else if (module === 'power')
      ({ error } = await supabase.from('power_readings').delete().in('id', ids));
    else if (module === 'blending') {
      const { error: _be, count: _bc } = await (supabase.from('blending_events' as any) as any)
        .delete({ count: 'exact' }).in('id', ids);
      error = _be ?? (_bc === 0 ? new Error('Bulk delete blocked — check RLS policy on blending_events') : null);
    }
    setBulkDeleting(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success(`${ids.length} reading(s) deleted`);
    setSelectedIds(new Set());
    qc.invalidateQueries({ queryKey });
    if (module === 'power') qc.invalidateQueries({ queryKey: ['op-power', entityId] });
    if (module === 'locator') invalidateLocatorDash(qc);
    else if (module === 'well') invalidateWellDash(qc);
    else if (module === 'power') invalidatePowerDash(qc);
    else if (module === 'blending') invalidateWellDash(qc);
  };

  const deleteRow = async (id: string) => {
    setPendingDeleteId(null);
    setDeletingId(id);
    let error: any = null;
    if (module === 'well') ({ error } = await supabase.from('well_readings').delete().eq('id', id));
    else if (module === 'locator') ({ error } = await supabase.from('locator_readings').delete().eq('id', id));
    else if (module === 'power') ({ error } = await supabase.from('power_readings').delete().eq('id', id));
    else if (module === 'blending') {
      const { error: _be, count: _bc } = await (supabase.from('blending_events' as any) as any)
        .delete({ count: 'exact' }).eq('id', id);
      error = _be ?? (_bc === 0 ? new Error('Delete blocked — run the missing RLS policy SQL (see console)') : null);
      if (_bc === 0 && !_be) console.error('blending_events DELETE returned 0 rows. Add policy: CREATE POLICY "auth_delete_blending_events" ON blending_events FOR DELETE USING (auth.uid() IS NOT NULL);');
    }
    setDeletingId(null);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('Reading deleted');
    setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    qc.invalidateQueries({ queryKey });
    if (module === 'power') qc.invalidateQueries({ queryKey: ['op-power', entityId] });
    if (module === 'locator') { qc.invalidateQueries({ queryKey: ['op-loc-recent'] }); invalidateLocatorDash(qc); }
    else if (module === 'well') { qc.invalidateQueries({ queryKey: ['op-well-recent'] }); invalidateWellDash(qc); }
    else if (module === 'power') invalidatePowerDash(qc);
  };

  const saveEdit = async () => {
    if (!editRow) return;
    setSaving(true);
    let error: any = null;
    const dtIso = new Date(editRow.datetime).toISOString();

    if (module === 'well') {
      // Recalculate daily_volume so TrendChart/Dashboard totals stay correct after edits.
      // NOTE: unlike locator_readings, well_readings.daily_volume is a plain stored
      // column (not GENERATED ALWAYS AS) — the app owns it and must recompute it on
      // every edit, the same way WellSection.tsx does on insert. Previously this was
      // left stale after an edit, silently corrupting downstream totals.
      const wellRow = rows?.find((r: any) => r.id === editRow.id);
      const wellCur = +editRow.value;
      const wellPrev = wellRow?.previous_reading;
      const wellDailyVol = wellPrev != null ? Math.max(0, wellCur - wellPrev) : null;
      const wellEditPayload: Record<string, any> = {
        current_reading: wellCur,
        power_meter_reading: editRow.value2 ? +editRow.value2 : null,
        reading_datetime: dtIso,
        daily_volume: wellDailyVol,
      };
      // Only include optional columns when they were actually present in the row
      // returned by the SELECT query (hasMeterReplacement / value4/5/6 !== undefined).
      // Sending a column that doesn't exist in PostgREST's schema cache causes the
      // misleading "relation 'well_readings' does not exist" error.
      if (editRow.hasMeterReplacement) wellEditPayload.is_meter_replacement = !!editRow.isMeterReplacement;
      if (editRow.value4 !== undefined) wellEditPayload.tds_ppm = editRow.value4 ? +editRow.value4 : null;
      if (editRow.value6 !== undefined) wellEditPayload.turbidity_ntu = editRow.value6 ? +editRow.value6 : null;
      if (editRow.value5 !== undefined) wellEditPayload.pressure_psi = editRow.value5 ? +editRow.value5 : null;
      ({ error } = await (supabase.from('well_readings') as any).update(wellEditPayload).eq('id', editRow.id));
    } else if (module === 'locator') {
      // Recalculate daily_volume so TrendChart/Dashboard always use an up-to-date delta.
      // NOTE: daily_volume is GENERATED ALWAYS AS on locator_readings — cannot be set in UPDATE.
      const locRow = rows?.find((r: any) => r.id === editRow.id);
      const newCur = +editRow.value;
      // daily_volume is a GENERATED ALWAYS AS column on locator_readings — omit from UPDATE.
      // (CSV import already omits it for the same reason; this aligns saveEdit to match.)
      ({ error } = await (supabase.from('locator_readings') as any).update({
        current_reading: newCur,
        reading_datetime: dtIso,
        is_meter_replacement: !!editRow.isMeterReplacement,
        // daily_volume intentionally omitted — DB recomputes it automatically.
      }).eq('id', editRow.id));
    } else if (module === 'power') {
      // Fix #3 — daily_consumption_kwh was never recalculated on edit, so Dashboard
      // totals would drift after any history correction.  Re-derive it the same way
      // the initial insert does: find the predecessor row, compute Δ meter reading,
      // then apply the CT multiplier so PV ratios stay correct.
      const editedDt = new Date(dtIso).toISOString();
      const editedDate = editedDt.slice(0, 10);
      let recomputedConsumption: number | null = null;
      try {
        const { data: pred } = await supabase
          .from('power_readings')
          .select('meter_reading_kwh')
          .eq('plant_id', entityId)
          .lt('reading_datetime', `${editedDate}T00:00:00.000Z`)
          .order('reading_datetime', { ascending: false })
          .limit(1);
        if (pred && pred.length > 0) {
          const delta = +editRow.value - (pred[0] as any).meter_reading_kwh;
          if (delta >= 0) recomputedConsumption = delta * multiplier;
        }
      } catch { /* non-critical: proceed without updating daily_consumption_kwh */ }
      const powerUpdatePayload: Record<string, any> = {
        meter_reading_kwh: +editRow.value,
        solar_meter_reading: editRow.value2 ? +editRow.value2 : null,
        reading_datetime: dtIso,
        is_meter_replacement: !!editRow.isMeterReplacement,
      };
      // Keep grid_meter_readings key-0 in sync with the edited meter_reading_kwh.
      // Fetch the existing JSONB so we don't overwrite secondary meters (idx ≥ 1).
      try {
        const { data: existingPR } = await (supabase.from('power_readings') as any)
          .select('grid_meter_readings').eq('id', editRow.id).maybeSingle();
        const existingGmr = (existingPR?.grid_meter_readings as Record<string, number> | null) ?? {};
        powerUpdatePayload.grid_meter_readings = { ...existingGmr, '0': +editRow.value };
      } catch { /* non-critical: grid_meter_readings column may not exist yet */ }
      if (recomputedConsumption != null) {
        powerUpdatePayload.daily_consumption_kwh = recomputedConsumption;
        // BUG C FIX: daily_grid_kwh was never updated on history edits.
        // Plants.tsx chart reads daily_grid_kwh as its Priority-1 source, so
        // leaving it stale after an edit caused the Operations "Last 7 readings"
        // (dynamic recompute) and the Plants chart (stored column) to diverge.
        powerUpdatePayload.daily_grid_kwh = recomputedConsumption;
      }
      ({ error } = await (supabase.from('power_readings') as any).update(powerUpdatePayload).eq('id', editRow.id));
    }

    if (module === 'blending') {
      const blendPayload: Record<string, any> = {
        volume_m3: +editRow.value,
        event_date: editRow.datetime.slice(0, 10),
        is_meter_replacement: !!editRow.isMeterReplacement,
        // Preserve raw_meter_reading from the original row if available; editor
        // only changes volume_m3 so we copy it forward unchanged.
        ...(rows?.find((r: any) => r.id === editRow.id)?.raw_meter_reading != null
          ? { raw_meter_reading: rows.find((r: any) => r.id === editRow.id).raw_meter_reading }
          : {}),
      };
      const { error: _ue, count: _uc } = await (supabase.from('blending_events' as any) as any)
        .update(blendPayload, { count: 'exact' })
        .eq('id', editRow.id);
      error = _ue ?? (_uc === 0 ? new Error('Update blocked — run the missing RLS policy SQL (see console)') : null);
      if (_uc === 0 && !_ue) console.error('blending_events UPDATE returned 0 rows. Add policy: CREATE POLICY "auth_update_blending_events" ON blending_events FOR UPDATE USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);');
    }
    setSaving(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('Reading updated');
    setEditRow(null);
    qc.invalidateQueries({ queryKey });
    // Also invalidate the parent form queries so "Last 7 readings" refreshes
    if (module === 'power') qc.invalidateQueries({ queryKey: ['op-power', entityId] });
    if (module === 'locator') { qc.invalidateQueries({ queryKey: ['op-loc-recent'] }); invalidateLocatorDash(qc); }
    else if (module === 'well') { qc.invalidateQueries({ queryKey: ['op-well-recent'] }); invalidateWellDash(qc); }
    else if (module === 'power') invalidatePowerDash(qc);
    else if (module === 'blending') invalidateWellDash(qc);
  };

  const title = module === 'power'
    ? meterFilter
      ? meterFilter.type === 'solar'
        ? `Solar — ${entityName} — History`
        : `${getHistGridLabel(meterFilter.idx)} — ${entityName} — History`
      : `Power — ${entityName}`
    : `${entityName} — History`;
  const canEditDelete = true;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
        </DialogHeader>

        {/* Window selector */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
            {HISTORY_WINDOWS.map(({ label, days: d }) => (
              <button
                key={label}
                onClick={() => { setDays(d as any); setEditRow(null); }}
                className={[
                  'px-3 py-1 text-xs font-medium rounded-md transition-all',
                  days === d ? 'bg-teal-700 text-white shadow-sm' : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
            <button
              onClick={() => { setDays('custom'); setEditRow(null); }}
              className={[
                'px-3 py-1 text-xs font-medium rounded-md transition-all',
                days === 'custom' ? 'bg-teal-700 text-white shadow-sm' : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              Custom
            </button>
          </div>
          {days === 'custom' && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <input
                type="date"
                value={customFrom}
                max={customTo}
                onChange={e => setCustomFrom(e.target.value)}
                className="h-7 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <input
                type="date"
                value={customTo}
                min={customFrom}
                max={format(new Date(), 'yyyy-MM-dd')}
                onChange={e => setCustomTo(e.target.value)}
                className="h-7 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <Button size="sm" className="h-7 px-3 text-xs bg-teal-700 text-white hover:bg-teal-800"
                onClick={() => { setAppliedFrom(customFrom); setAppliedTo(customTo); setEditRow(null); }}>
                Apply
              </Button>
            </div>
          )}
        </div>

        {/* Inline edit form */}
        {editRow && (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2 text-xs">
            <p className="font-medium text-foreground">Editing reading</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[11px]">Date &amp; Time</Label>
                <Input type="datetime-local" value={editRow.datetime}
                  onChange={e => setEditRow({ ...editRow, datetime: e.target.value })}
                  className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-[11px]">
                  {module === 'well' ? 'Water (unitless)' : module === 'locator' ? 'Reading' : module === 'blending' ? 'Volume (m³)' : 'Grid Power Reading (kWh)'}
                </Label>
                <Input type="number" step="any" value={editRow.value}
                  onChange={e => setEditRow({ ...editRow, value: e.target.value })}
                  className="h-8 text-xs" />
              </div>
              {module === 'well' && (
                <div>
                  <Label className="text-[11px]">Power Meter (kWh)</Label>
                  <Input type="number" step="any" value={editRow.value2 ?? ''}
                    onChange={e => setEditRow({ ...editRow, value2: e.target.value })}
                    className="h-8 text-xs" placeholder="optional" />
                </div>
              )}
              {module === 'well' && (
                <div>
                  <Label className="text-[11px]">TDS (ppm)</Label>
                  <Input type="number" step="any" value={editRow.value4 ?? ''}
                    onChange={e => setEditRow({ ...editRow, value4: e.target.value })}
                    className="h-8 text-xs" placeholder="optional" />
                </div>
              )}
              {module === 'well' && (
                <div>
                  <Label className="text-[11px]">NTU</Label>
                  <Input type="number" step="any" value={editRow.value6 ?? ''}
                    onChange={e => setEditRow({ ...editRow, value6: e.target.value })}
                    className="h-8 text-xs" placeholder="optional" />
                </div>
              )}
              {module === 'well' && (
                <div>
                  <Label className="text-[11px]">Pressure (psi)</Label>
                  <Input type="number" step="any" value={editRow.value5 ?? ''}
                    onChange={e => setEditRow({ ...editRow, value5: e.target.value })}
                    className="h-8 text-xs" placeholder="optional" />
                </div>
              )}
              {module === 'power' && (
                <div>
                  <Label className="text-[11px]">Solar Power Reading (kWh)</Label>
                  <Input type="number" step="any" value={editRow.value2 ?? ''}
                    onChange={e => setEditRow({ ...editRow, value2: e.target.value })}
                    className="h-8 text-xs" placeholder="optional" />
                </div>
              )}
            </div>
            {module !== 'power' && (
              <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
                <input
                  type="checkbox"
                  checked={!!editRow.isMeterReplacement}
                  onChange={e => setEditRow({ ...editRow, isMeterReplacement: e.target.checked })}
                  className="h-3.5 w-3.5 accent-orange-500"
                />
                <span className="text-[11px] text-muted-foreground">Meter replacement / PMS (zeroes Δ)</span>
              </label>
            )}
            <div className="flex gap-2">
              <Button size="sm" onClick={saveEdit} disabled={saving || !editRow.value}
                className="bg-teal-700 text-white hover:bg-teal-800 h-7 text-xs px-3">
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save changes'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditRow(null)} disabled={saving} className="h-7 text-xs px-3">
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Bulk delete toolbar — shown when rows are selected */}
        {canEditDelete && selectedIds.size > 0 && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
            <span className="text-xs font-medium text-destructive flex-1">
              {selectedIds.size} row{selectedIds.size > 1 ? 's' : ''} selected
            </span>
            <Button
              size="sm"
              variant="destructive"
              className="h-7 px-3 text-xs gap-1.5"
              onClick={() => setBulkDeletePending(true)}
              disabled={bulkDeleting}
            >
              {bulkDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
              Delete selected
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
              onClick={() => { setSelectedIds(new Set()); setBulkDeletePending(false); }}>
              Clear
            </Button>
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
            <table className="w-full text-left">
              <thead className="bg-muted sticky top-0">
                <tr>
                  {canEditDelete && (
                    <th className="px-2 py-2 w-8">
                      <input type="checkbox"
                        className="h-3.5 w-3.5 accent-teal-700 cursor-pointer"
                        checked={!!rows?.length && selectedIds.size === rows.length}
                        onChange={toggleSelectAll}
                        title="Select all"
                      />
                    </th>
                  )}
                  <th className="px-3 py-2 font-medium">Date & Time</th>
                  {module === 'locator' && <>
                    <th className="px-3 py-2 font-medium text-right">Reading</th>
                    <th className="px-3 py-2 font-medium text-right">Δ</th>
                    <th className="px-2 py-2 font-medium text-center">Repl.</th>
                    <th className="px-3 py-2 font-medium">Flags</th>
                  </>}
                  {module === 'well' && <>
                    <th className="px-3 py-2 font-medium text-right">Water</th>
                    <th className="px-3 py-2 font-medium text-right">Δ</th>
                    <th className="px-2 py-2 font-medium text-center">Repl.</th>
                    <th className="px-3 py-2 font-medium text-right">Power (kWh)</th>
                    <th className="px-3 py-2 font-medium text-right">TDS (ppm)</th>
                    <th className="px-3 py-2 font-medium text-right">NTU</th>
                    <th className="px-3 py-2 font-medium text-right">Pressure (psi)</th>
                  </>}
                  {module === 'blending' && <>
                    <th className="px-3 py-2 font-medium text-right">Reading</th>
                    <th className="px-3 py-2 font-medium text-right">Volume (m³)</th>
                    <th className="px-2 py-2 font-medium text-center">Repl.</th>
                  </>}
                  {module === 'power' && <>
                    <th className="px-3 py-2 font-medium">Meter</th>
                    <th className="px-3 py-2 font-medium text-right">Reading</th>
                    <th className="px-3 py-2 font-medium text-right">Δ (kWh)</th>
                    <th className="px-2 py-2 font-medium text-center text-slate-500">×</th>
                    <th className="px-3 py-2 font-medium text-right text-blue-700 dark:text-blue-400">Power (kWh)</th>
                    <th className="px-2 py-2 font-medium text-center">Repl.</th>
                  </>}
                  {canEditDelete && <th className="px-2 py-2 font-medium text-center w-16">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any, i: number) => {
                  const dt = r.reading_datetime ?? r.event_date ?? r.noted_at ?? '';
                  // Blending stores event_date as a date-only string (YYYY-MM-DD).
                  // Parsing it with `new Date(str)` treats it as UTC midnight, which
                  // shifts the displayed time by the local UTC offset (e.g. +08:00 → 08:00).
                  // Use local-midnight construction + date-only format to avoid this.
                  let dateStr: string;
                  if (module === 'blending') {
                    if (r.reading_datetime) {
                      dateStr = format(new Date(r.reading_datetime), 'MMM d, yyyy HH:mm');
                    } else if (r.event_date) {
                      const [ey, em, ed] = r.event_date.split('-').map(Number);
                      dateStr = format(new Date(ey, em - 1, ed), 'MMM d, yyyy');
                    } else {
                      dateStr = '—';
                    }
                  } else {
                    dateStr = dt ? format(new Date(dt), 'MMM d, yyyy HH:mm') : '—';
                  }
                  const isEditing = editRow?.id === r.id;
                  const isDeleting = deletingId === r.id;
                  const isToggling = togglingId === r.id;
                  const isMeterReplacement = !!r.is_meter_replacement;
                  // rows sorted descending → rows[i+1] is the immediately preceding reading in time
                  const predecessor: any = rows[i + 1] ?? null;

                  const isGridRepl      = !!(r.is_grid_replacement  ?? r.is_meter_replacement);
                  const isSolarRepl     = !!(r.is_solar_replacement ?? false);
                  const isTogglingGrid  = togglingGridId  === r.id;
                  const isTogglingSolar = togglingSolarId === r.id;

                  // Shared "Repl." toggle cell — rendered for well / locator
                  const replCell = (
                    <td className="px-2 py-1.5 text-center">
                      <button
                        title={isMeterReplacement ? 'Meter replacement — click to unmark' : 'Mark as meter replacement (zeroes Δ)'}
                        aria-label={isMeterReplacement ? 'Meter replacement — click to unmark' : 'Mark as meter replacement (zeroes Δ)'}
                        disabled={isDeleting || isToggling}
                        onClick={() => toggleMeterReplacement(r)}
                        className={[
                          'inline-flex items-center justify-center w-5 h-5 rounded border transition-colors',
                          'disabled:opacity-40 disabled:cursor-not-allowed',
                          isMeterReplacement
                            ? 'bg-orange-500 border-orange-500 text-white hover:bg-orange-600'
                            : 'border-input bg-background hover:border-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/20',
                        ].join(' ')}
                      >
                        {isToggling
                          ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                          : isMeterReplacement ? <span className="text-[9px] font-bold leading-none">✓</span> : null
                        }
                      </button>
                    </td>
                  );

                  // ── Power module: card-style rows (date header + one sub-row per meter) ──
                  if (module === 'power') {
                    const gmr     = r.grid_meter_readings     as Record<string, number> | null | undefined;
                    const prevGmr = predecessor?.grid_meter_readings as Record<string, number> | null | undefined;
                    const hasSolar = r.solar_meter_reading != null || (r.daily_solar_kwh != null && +r.daily_solar_kwh > 0);
                    // colspan for the date cell: Date + all 6 data columns
                    const dateCols = 7;
                    const actionsCell = canEditDelete ? (
                      <td className="px-2 py-1 text-center align-top" rowSpan={resolvedGridCount + (hasSolar ? 1 : 0) + 1}>
                        <div className="flex items-center justify-center gap-0.5 pt-0.5">
                          <button
                            title="Edit"
                            aria-label="Edit"
                            disabled={!!editRow || isDeleting}
                            onClick={() => startEdit(r)}
                            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            title="Delete"
                            aria-label="Delete"
                            disabled={!!editRow || isDeleting}
                            onClick={() => setPendingDeleteId(r.id)}
                            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-40"
                          >
                            {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                          </button>
                        </div>
                      </td>
                    ) : null;

                    // ── meterFilter: flat single-row-per-record rendering ────────────────
                    if (meterFilter) {
                      const isSolar = meterFilter.type === 'solar';
                      const gridIdx = !isSolar ? (meterFilter as { type: 'grid'; idx: number }).idx : 0;
                      const mMult   = isSolar ? 1 : getHistGridMult(gridIdx);
                      const curr    = isSolar
                        ? r.solar_meter_reading
                        : (gmr?.[String(gridIdx)] ?? (gridIdx === 0 ? r.meter_reading_kwh : null));
                      const prevVal = isSolar
                        ? predecessor?.solar_meter_reading
                        : (prevGmr?.[String(gridIdx)] ?? (gridIdx === 0 ? predecessor?.meter_reading_kwh : null));
                      const rawDelta   = curr != null && prevVal != null ? curr - prevVal : null;
                      const isRepl     = isSolar ? isSolarRepl : isGridRepl;
                      const effective  = isRepl ? 0 : rawDelta != null ? rawDelta * mMult : null;
                      return (
                        <tr key={r.id ?? i}
                          className={[
                            'border-t',
                            isEditing  ? 'bg-teal-50/60 dark:bg-teal-950/20'
                            : isRepl   ? 'bg-orange-50/40 dark:bg-orange-950/10'
                            : 'hover:bg-muted/40',
                          ].join(' ')}
                        >
                          {canEditDelete && (
                            <td className="px-2 py-1.5 w-8">
                              <input type="checkbox" className="h-3.5 w-3.5 accent-teal-700 cursor-pointer"
                                checked={selectedIds.has(r.id)} onChange={() => toggleSelect(r.id)} />
                            </td>
                          )}
                          <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                            <span className="flex items-center gap-1.5">
                              {dateStr}
                              {isRepl && (
                                <span className={`text-[9px] font-semibold uppercase tracking-wide px-1 py-0.5 rounded leading-none ${isSolar ? 'text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30' : 'text-orange-600 bg-orange-100 dark:bg-orange-900/30'}`}>
                                  repl.
                                </span>
                              )}
                            </span>
                          </td>
                          {/* Meter column placeholder (hidden in filtered view) */}
                          <td />
                          {/* Reading */}
                          <td className="px-3 py-1.5 text-right font-mono-num text-[11px]">
                            <span className={isSolar ? 'text-yellow-600' : 'text-blue-600'}>
                              {curr != null ? fmtNum(curr) : '—'}
                            </span>
                          </td>
                          {/* Δ raw */}
                          <td className="px-3 py-1.5 text-right font-mono-num text-[11px]">
                            {isRepl
                              ? <span className="text-orange-500 font-medium">0</span>
                              : rawDelta != null ? fmtNum(rawDelta) : '—'
                            }
                          </td>
                          {/* × multiplier */}
                          <td className="px-2 py-1.5 text-center font-mono-num text-slate-500 text-[10px]">
                            {mMult !== 1 ? `×${mMult}` : '×1'}
                          </td>
                          {/* Effective kWh */}
                          <td className={['px-3 py-1.5 text-right font-mono-num font-medium text-[11px]',
                            effective != null && effective < 0 ? 'text-destructive' : isSolar ? 'text-yellow-700 dark:text-yellow-400' : 'text-blue-700 dark:text-blue-400',
                          ].join(' ')}>
                            {effective != null ? fmtNum(effective) : '—'}
                          </td>
                          {/* Repl. toggle */}
                          <td className="px-2 py-1.5 text-center">
                            <button
                              title={isRepl ? 'Replacement — click to unmark' : 'Mark as meter replacement (zeroes Δ)'}
                              aria-label={isRepl ? 'Replacement — click to unmark' : 'Mark as meter replacement (zeroes Δ)'}
                              disabled={isDeleting || isTogglingGrid || isTogglingSolar}
                              onClick={() => isSolar ? toggleSolarReplacement(r) : toggleGridReplacement(r)}
                              className={['inline-flex items-center justify-center w-5 h-5 rounded border transition-colors',
                                'disabled:opacity-40 disabled:cursor-not-allowed',
                                isRepl
                                  ? (isSolar ? 'bg-yellow-500 border-yellow-500' : 'bg-blue-500 border-blue-500') + ' text-white'
                                  : 'border-input bg-background hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/20',
                              ].join(' ')}
                            >
                              {(isTogglingGrid || isTogglingSolar) ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                : isRepl ? <span className="text-[9px] font-bold leading-none">✓</span> : null}
                            </button>
                          </td>
                          {canEditDelete && (
                            <td className="px-2 py-1 text-center">
                              <div className="flex items-center justify-center gap-0.5">
                                <button title="Edit" aria-label="Edit" disabled={!!editRow || isDeleting}
                                  onClick={() => startEdit(r)}
                                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40">
                                  <Pencil className="h-3 w-3" />
                                </button>
                                <button title="Delete" aria-label="Delete" disabled={!!editRow || isDeleting}
                                  onClick={() => setPendingDeleteId(r.id)}
                                  className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-40">
                                  {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    }

                    return (
                      <React.Fragment key={r.id ?? i}>
                        {/* ── Date header row ── */}
                        <tr className={[
                          'border-t',
                          isEditing ? 'bg-teal-50/60 dark:bg-teal-950/20'
                          : isGridRepl ? 'bg-orange-50/40 dark:bg-orange-950/10'
                          : 'bg-muted/20',
                        ].join(' ')}>
                          {canEditDelete && (
                            <td className="px-2 py-1 w-8">
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5 accent-teal-700 cursor-pointer"
                                checked={selectedIds.has(r.id)}
                                onChange={() => toggleSelect(r.id)}
                              />
                            </td>
                          )}
                          <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground font-medium" colSpan={dateCols}>
                            <span className="flex items-center gap-1.5">
                              {dateStr}
                              {isGridRepl && (
                                <span className="text-[9px] font-semibold uppercase tracking-wide text-orange-600 bg-orange-100 dark:bg-orange-900/30 px-1 py-0.5 rounded leading-none">
                                  grid repl.
                                </span>
                              )}
                              {isSolarRepl && (
                                <span className="text-[9px] font-semibold uppercase tracking-wide text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30 px-1 py-0.5 rounded leading-none">
                                  solar repl.
                                </span>
                              )}
                            </span>
                          </td>
                          {/* actions rowspan anchor — spans all sub-rows */}
                          {actionsCell}
                        </tr>

                        {/* ── One sub-row per grid meter ── */}
                        {Array.from({ length: resolvedGridCount }).map((_, mi) => {
                          const mLabel = getHistGridLabel(mi);
                          const mMult  = getHistGridMult(mi);
                          const curr   = gmr?.[String(mi)]     ?? (mi === 0 ? r.meter_reading_kwh     : null);
                          const prev   = prevGmr?.[String(mi)] ?? (mi === 0 ? predecessor?.meter_reading_kwh : null);
                          const rawDelta    = (curr != null && prev != null) ? curr - prev : null;
                          const effective   = isGridRepl ? 0 : rawDelta != null ? rawDelta * mMult : null;
                          return (
                            <tr key={`g${mi}`} className="hover:bg-muted/30">
                              {canEditDelete && <td />}
                              {/* Meter label */}
                              <td className="px-3 py-1 pl-6">
                                <span className="flex items-center gap-1 text-[11px]">
                                  <GridPylonIcon className="h-2.5 w-2.5 text-blue-400 shrink-0" />
                                  <span className="text-muted-foreground truncate">{mLabel}</span>
                                </span>
                              </td>
                              {/* Reading */}
                              <td className="px-3 py-1 text-right font-mono-num text-blue-600 text-[11px]">
                                {curr != null ? fmtNum(curr) : '—'}
                              </td>
                              {/* Δ raw */}
                              <td className="px-3 py-1 text-right font-mono-num text-[11px]">
                                {isGridRepl
                                  ? <span className="text-orange-500 font-medium">0</span>
                                  : rawDelta != null ? fmtNum(rawDelta) : '—'
                                }
                              </td>
                              {/* × multiplier */}
                              <td className="px-2 py-1 text-center font-mono-num text-slate-500 text-[10px]">
                                {mMult !== 1 ? `×${mMult}` : '×1'}
                              </td>
                              {/* Effective kWh */}
                              <td className={[
                                'px-3 py-1 text-right font-mono-num font-medium text-[11px]',
                                effective != null && effective < 0 ? 'text-destructive' : 'text-blue-700 dark:text-blue-400',
                              ].join(' ')}>
                                {effective != null ? fmtNum(effective) : '—'}
                              </td>
                              {/* Grid Repl. toggle — only on first meter; shared flag applies to all */}
                              <td className="px-2 py-1 text-center">
                                {mi === 0 && (
                                  <button
                                    title={isGridRepl ? 'Grid replacement — click to unmark' : 'Mark grid meter replacement (zeroes Δ Grid)'}
                                    aria-label={isGridRepl ? 'Grid replacement — click to unmark' : 'Mark grid meter replacement (zeroes Δ Grid)'}
                                    disabled={isDeleting || isTogglingGrid}
                                    onClick={() => toggleGridReplacement(r)}
                                    className={[
                                      'inline-flex items-center justify-center w-5 h-5 rounded border transition-colors',
                                      'disabled:opacity-40 disabled:cursor-not-allowed',
                                      isGridRepl
                                        ? 'bg-blue-500 border-blue-500 text-white hover:bg-blue-600'
                                        : 'border-input bg-background hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/20',
                                    ].join(' ')}
                                  >
                                    {isTogglingGrid
                                      ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                      : isGridRepl ? <span className="text-[9px] font-bold leading-none">✓</span> : null
                                    }
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}

                        {/* ── Solar sub-row (only when plant has solar data) ── */}
                        {hasSolar && (
                          <tr className="hover:bg-muted/30">
                            {canEditDelete && <td />}
                            {/* Meter label */}
                            <td className="px-3 py-1 pl-6">
                              <span className="flex items-center gap-1 text-[11px]">
                                <span className="text-yellow-500 text-xs leading-none">☀</span>
                                <span className="text-muted-foreground">Solar</span>
                              </span>
                            </td>
                            {/* Reading */}
                            <td className="px-3 py-1 text-right font-mono-num text-yellow-600 text-[11px]">
                              {r.solar_meter_reading != null ? fmtNum(r.solar_meter_reading) : '—'}
                            </td>
                            {/* Δ Solar */}
                            <td className="px-3 py-1 text-right font-mono-num text-[11px]">
                              {isSolarRepl
                                ? <span className="text-orange-500 font-medium">0</span>
                                : (predecessor?.solar_meter_reading != null && r.solar_meter_reading != null)
                                  ? <span className="text-yellow-600">{fmtNum(r.solar_meter_reading - predecessor.solar_meter_reading)}</span>
                                  : r.daily_solar_kwh != null && +r.daily_solar_kwh > 0
                                    ? <span className="text-yellow-600">{fmtNum(+r.daily_solar_kwh)}</span>
                                    : '—'
                              }
                            </td>
                            {/* × — n/a for solar */}
                            <td />
                            {/* Effective — n/a for solar (no multiplier) */}
                            <td />
                            {/* Solar Repl. toggle */}
                            <td className="px-2 py-1 text-center">
                              <button
                                title={isSolarRepl ? 'Solar replacement — click to unmark' : 'Mark solar meter replacement (zeroes Δ Solar)'}
                                aria-label={isSolarRepl ? 'Solar replacement — click to unmark' : 'Mark solar meter replacement (zeroes Δ Solar)'}
                                disabled={isDeleting || isTogglingSolar}
                                onClick={() => toggleSolarReplacement(r)}
                                className={[
                                  'inline-flex items-center justify-center w-5 h-5 rounded border transition-colors',
                                  'disabled:opacity-40 disabled:cursor-not-allowed',
                                  isSolarRepl
                                    ? 'bg-yellow-500 border-yellow-500 text-white hover:bg-yellow-600'
                                    : 'border-input bg-background hover:border-yellow-400 hover:bg-yellow-50 dark:hover:bg-yellow-950/20',
                                ].join(' ')}
                              >
                                {isTogglingSolar
                                  ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                  : isSolarRepl ? <span className="text-[9px] font-bold leading-none">✓</span> : null
                                }
                              </button>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  }

                  // ── Non-power modules: original single-tr rendering ──
                  return (
                    <tr
                      key={r.id ?? i}
                      className={[
                        'border-t',
                        isEditing      ? 'bg-teal-50/60 dark:bg-teal-950/20'
                        : isMeterReplacement ? 'bg-orange-50/40 dark:bg-orange-950/10'
                        : 'hover:bg-muted/40',
                      ].join(' ')}
                    >
                      {canEditDelete && (
                        <td className="px-2 py-1.5 w-8">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 accent-teal-700 cursor-pointer"
                            checked={selectedIds.has(r.id)}
                            onChange={() => toggleSelect(r.id)}
                          />
                        </td>
                      )}
                      <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          {dateStr}
                          {isMeterReplacement && (
                            <span className="text-[9px] font-semibold uppercase tracking-wide text-orange-600 bg-orange-100 dark:bg-orange-900/30 px-1 py-0.5 rounded leading-none">
                              repl.
                            </span>
                          )}
                        </span>
                      </td>

                      {module === 'locator' && <>
                        <td className="px-3 py-1.5 text-right font-mono-num">{fmtNum(r.current_reading)}</td>
                        <td className="px-3 py-1.5 text-right font-mono-num">
                          {isMeterReplacement
                            ? <span className="text-orange-500 font-medium">0</span>
                            : predecessor != null ? fmtNum(r.current_reading - predecessor.current_reading) : '—'
                          }
                        </td>
                        {replCell}
                        <td className="px-3 py-1.5">
                          {r.off_location_flag && <span className="text-amber-600 font-medium">off-loc</span>}
                        </td>
                      </>}

                      {module === 'well' && <>
                        <td className="px-3 py-1.5 text-right font-mono-num">{fmtNum(r.current_reading)}</td>
                        <td className="px-3 py-1.5 text-right font-mono-num">
                          {isMeterReplacement
                            ? <span className="text-orange-500 font-medium">0</span>
                            : predecessor != null ? fmtNum(r.current_reading - predecessor.current_reading) : '—'
                          }
                        </td>
                        {replCell}
                        <td className="px-3 py-1.5 text-right font-mono-num">
                          {r.power_meter_reading != null ? fmtNum(r.power_meter_reading) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono-num">
                          {r.tds_ppm != null ? fmtNum(r.tds_ppm) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono-num">
                          {(r as any).turbidity_ntu != null ? (+((r as any).turbidity_ntu)).toFixed(2) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono-num">
                          {r.pressure_psi != null ? fmtNum(r.pressure_psi) : '—'}
                        </td>
                      </>}

                      {module === 'blending' && <>
                        <td className="px-3 py-1.5 text-right font-mono-num text-muted-foreground">
                          {r.raw_meter_reading != null ? fmtNum(r.raw_meter_reading) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono-num">{fmtNum(r.volume_m3 ?? 0)}</td>
                        {replCell}
                      </>}

                      {canEditDelete && (
                        <td className="px-2 py-1 text-center">
                          <div className="flex items-center justify-center gap-0.5">
                            <button
                              title="Edit"
                              aria-label="Edit"
                              disabled={!!editRow || isDeleting}
                              onClick={() => startEdit(r)}
                              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              title="Delete"
                              aria-label="Delete"
                              disabled={!!editRow || isDeleting}
                              onClick={() => setPendingDeleteId(r.id)}
                              className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-40"
                            >
                              {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <p className="text-[10px] text-muted-foreground">
          {days === 'custom'
            ? `Showing ${appliedFrom} → ${appliedTo}`
            : `Showing up to ${days} days of history`
          } · {rows?.length ?? 0} records
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

        <AlertDialog open={bulkDeletePending} onOpenChange={(o) => !o && setBulkDeletePending(false)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {selectedIds.size} reading(s)?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently remove the selected readings. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={bulkDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
