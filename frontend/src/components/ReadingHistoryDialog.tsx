import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useIsMobile } from '@/hooks/use-mobile';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { friendlyError } from '@/lib/supabaseErrors';
import { useDraft } from '@/hooks/useDraft';
import { CorrectionRequestDialog } from '@/components/CorrectionRequestDialog';
import type { CorrectionTarget } from '@/components/CorrectionRequestDialog';
import { CorrectionReasonField } from '@/components/CorrectionReasonField';
import { resolveReason, isReasonComplete } from '@/lib/correctionReasons';
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
import { ReplaceMeterDialog } from '@/pages/plants/locators/LocatorDialogs';
import { PowerMeterChangeDialog } from '@/pages/plants/config/PowerMeters';
import { canEditEntry, logReadingEdit, diffFields } from '@/pages/ro-trains/helpers';

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
  /** power module only — which grid meter index `value` belongs to (0 = STP,
   *  matching the legacy meter_reading_kwh column). Captured at edit-start
   *  time from meterFilter so saveEdit writes to the right
   *  grid_meter_readings[idx] slot instead of always idx 0. */
  gridIdx?: number;
}

export function ReadingHistoryDialog({ entityName, module, entityId, plantId, assetMeterSerial, multiplier = 1,
  gridMeterCount: gridMeterCountProp = 1, gridMeterNames = [], gridMultipliers = [], meterFilter, defaultInputMode = 'raw', solarInputMode = 'raw', onClose }: {
  entityName: string;
  module: HistoryModule;
  entityId: string;
  plantId?: string;
  /** Current meter serial on the well/locator asset (well.meter_serial / locator.meter_serial).
   *  Passed through to ReplaceMeterDialog as "old serial" when a Repl. checkbox is checked.
   *  Only meaningful for module 'well' | 'locator'. */
  assetMeterSerial?: string | null;
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
  /** From locator.default_input_mode / well.default_input_mode.
   *  'direct' -> the entered value already IS the period's volume (no prior
   *  reading to diff against), so no Δ column is computed or shown — only
   *  meaningful for module 'locator' | 'well'. Defaults to 'raw' (the
   *  existing cumulative-meter behavior) so every other caller is unaffected. */
  defaultInputMode?: 'raw' | 'direct';
  /** From plant.default_solar_input_mode (Plants → Energy Sources → Solar
   *  reading input mode). 'direct' -> the value entered for solar already IS
   *  that period's kWh (e.g. read off an inverter's daily-yield display), not
   *  a cumulative odometer-style reading — so it must never be diffed against
   *  the previous day's value. Only meaningful for module 'power'. Defaults to
   *  'raw' (existing cumulative-meter behavior) so grid-only callers and
   *  plants without solar are unaffected. */
  solarInputMode?: 'raw' | 'direct';
  onClose: () => void;
}) {
  const isDirectMode = (module === 'locator' || module === 'well') && defaultInputMode === 'direct';
  // Plant-level solar mode (Plants → Energy Sources). See prop doc above —
  // this must never be inferred from which column happens to be populated on
  // a given row (that's what let the bug through originally: solar_meter_reading
  // and daily_solar_kwh could both be non-null at once, e.g. after a row was
  // edited through this dialog before this fix), it has to come from the
  // plant's actual configured setting.
  const isSolarDirectMode = module === 'power' && solarInputMode === 'direct';
  // Resolves a row's solar value under Direct kWh mode: prefer daily_solar_kwh
  // (the column direct-mode entries are meant to live in) but fall back to
  // solar_meter_reading for rows that still have the value there (entered
  // before the plant switched to Direct kWh, or edited through this dialog
  // before this fix).
  const solarDirectVal = (row: any): number | null => {
    const v = row?.daily_solar_kwh ?? row?.solar_meter_reading;
    return v != null ? +v : null;
  };
  const qc = useQueryClient();
  // Permission model: same canEditEntry primitive already used by every other
  // reading-entry surface (RO logs, CIP, Dosing, Locator inline edit) — was
  // previously entirely absent here (canEditDelete was hardcoded `true`, see
  // the comment further down where that's now removed), meaning any signed-in
  // user could edit or delete any reading in any module through this dialog
  // regardless of role or who recorded it.
  const { isAdmin, isManager, isDataAnalyst, user, activeOperator, activeOperatorId } = useAuth();
  const hasFullAccess = isAdmin || isManager || isDataAnalyst;
  const [days, setDays] = useState<7 | 14 | 30 | 60 | 'custom'>(30);
  const [customFrom, setCustomFrom] = useState(format(new Date(Date.now() - 30 * 86400000), 'yyyy-MM-dd'));
  const [customTo, setCustomTo]     = useState(format(new Date(), 'yyyy-MM-dd'));
  const [appliedFrom, setAppliedFrom] = useState(customFrom);
  const [appliedTo, setAppliedTo]     = useState(customTo);
  const [editRow, setEditRow] = useState<HistoryEditState | null>(null);
  const [editReason, setEditReason] = useState('');
  const [editCustomReason, setEditCustomReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  // Reading id currently going through the "Replace meter" dialog (well/locator
  // only). Checking the Repl. box — row toggle or inline edit form — opens this
  // instead of flipping is_meter_replacement directly, so the swap actually gets
  // logged (old/new brand, size, serial, installed date) instead of just a flag.
  const [replaceReadingId, setReplaceReadingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [togglingGridId, setTogglingGridId] = useState<string | null>(null);
  // Power reading currently going through PowerMeterChangeDialog (readingId
  // mode) — see toggleGridReplacement below for why checking opens this
  // instead of a bare flag flip + blind multiplier reset.
  const [replacePowerReadingId, setReplacePowerReadingId] = useState<{ id: string; gridIdx: number } | null>(null);
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
        const { data, error } = await supabase
          .from('locator_readings')
          .select('id, current_reading, previous_reading, reading_datetime, off_location_flag, is_meter_replacement, is_meter_rollover, meter_rollover_max, recorded_by, created_at, norm_status')
          .eq('locator_id', entityId)
          .gte('reading_datetime', sinceDate)
          .lt('reading_datetime', untilNextDay)
          .order('reading_datetime', { ascending: false });
        if (!error) return data ?? [];
        // Fallback: base columns only (is_meter_replacement / is_meter_rollover may not
        // exist yet in this environment — avoid the PostgREST schema-cache error taking
        // the whole dialog down to zero rows, matching the well/power/blending
        // branches above).
        const { data: fallback } = await supabase
          .from('locator_readings')
          .select('id, current_reading, previous_reading, reading_datetime, off_location_flag, recorded_by, created_at, norm_status')
          .eq('locator_id', entityId)
          .gte('reading_datetime', sinceDate)
          .lt('reading_datetime', untilNextDay)
          .order('reading_datetime', { ascending: false });
        return (fallback ?? []).map((r: any) => ({ ...r, is_meter_replacement: false, is_meter_rollover: false, meter_rollover_max: null }));
      }
      if (module === 'well') {
        const { data, error } = await supabase
          .from('well_readings')
          .select('id, current_reading, previous_reading, power_meter_reading, tds_ppm, turbidity_ntu, pressure_psi, reading_datetime, is_meter_replacement, is_meter_rollover, meter_rollover_max, recorded_by, created_at, norm_status')
          .eq('well_id', entityId)
          .gte('reading_datetime', sinceDate)
          .lt('reading_datetime', untilNextDay)
          .order('reading_datetime', { ascending: false });
        if (!error) return data ?? [];
        // Fallback: base columns only (optional migration columns tds_ppm / pressure_psi /
        // is_meter_replacement / is_meter_rollover may not exist yet — avoid the
        // PostgREST schema-cache error)
        const { data: fallback } = await supabase
          .from('well_readings')
          .select('id, current_reading, previous_reading, power_meter_reading, reading_datetime, recorded_by, created_at, norm_status')
          .eq('well_id', entityId)
          .gte('reading_datetime', sinceDate)
          .lt('reading_datetime', untilNextDay)
          .order('reading_datetime', { ascending: false });
        return (fallback ?? []).map((r: any) => ({ ...r, is_meter_rollover: false, meter_rollover_max: null }));
      }
      if (module === 'power') {
        const { data, error } = await supabase
          .from('power_readings')
          .select('id, meter_reading_kwh, grid_meter_readings, daily_consumption_kwh, daily_solar_kwh, daily_grid_kwh, solar_meter_reading, reading_datetime, is_meter_replacement, recorded_by, created_at')
          .eq('plant_id', entityId)
          .gte('reading_datetime', sinceDate)
          .lt('reading_datetime', untilNextDay)
          .order('reading_datetime', { ascending: false });
        if (!error) return data ?? [];
        // Fallback: base columns only (optional migration columns missing)
        const { data: fallback } = await supabase
          .from('power_readings')
          .select('id, meter_reading_kwh, daily_consumption_kwh, reading_datetime, is_meter_replacement, recorded_by, created_at')
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
    if (!canEditEntry(r, hasFullAccess, activeOperatorId)) {
      toast.error('You can only edit your own entries, within 8 hours of submitting them.');
      return;
    }
    setEditReason('');
    setEditCustomReason('');
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
      // Which grid meter is r.meter_reading_kwh even for? Before this fix it
      // wasn't — the edit form always read/wrote index 0 (STP) regardless of
      // which meter's history dialog was actually open, so editing e.g. Grid
      // Meter 3 Main silently overwrote Grid Meter 1 STP instead. Derive the
      // real index from meterFilter, same as the row display just above does.
      const gmrForEdit = r.grid_meter_readings as Record<string, number> | null | undefined;
      const isSolarEdit = meterFilter?.type === 'solar';
      const gridIdxForEdit = meterFilter && !isSolarEdit ? (meterFilter as { type: 'grid'; idx: number }).idx : 0;
      const gridValueForEdit = gmrForEdit?.[String(gridIdxForEdit)] ?? (gridIdxForEdit === 0 ? r.meter_reading_kwh : null);
      const solarValueForEdit = isSolarDirectMode ? solarDirectVal(r) : r.solar_meter_reading;
      setEditRow({ id: r.id, datetime: dtStr, value: String(gridValueForEdit ?? ''), value2: solarValueForEdit != null ? String(solarValueForEdit) : '', value3: r.daily_grid_kwh != null ? String(r.daily_grid_kwh) : '', gridIdx: gridIdxForEdit, isMeterReplacement: !!r.is_meter_replacement });
    } else if (module === 'blending') {
      const eventDt = r.event_date ?? r.noted_at ?? '';
      const blendDtStr = eventDt ? format(new Date(eventDt), "yyyy-MM-dd'T'HH:mm") : format(new Date(), "yyyy-MM-dd'T'HH:mm");
      setEditRow({ id: r.id, datetime: blendDtStr, value: String(r.raw_meter_reading ?? ''), isMeterReplacement: !!r.is_meter_replacement });
    }
  };

  // Re-walk the full previous_reading chain for this locator, in chronological
  // order, and persist any link that's drifted from what's actually stored.
  //
  // Root cause this guards against: previous_reading is written once at insert
  // time and nothing in this dialog's edit/delete/toggle handlers ever kept it
  // in sync afterwards — editing an earlier reading's value, deleting a
  // reading, or clearing a meter-replacement flag all change who a downstream
  // row's real predecessor is, but the downstream row's stored previous_reading
  // was never told. Because locator_readings.daily_volume is a GENERATED
  // ALWAYS AS (current_reading - previous_reading) column, a stale
  // previous_reading silently produces a wrong daily_volume with no error from
  // Postgres — nothing here or in the DB flags it. That wrong daily_volume then
  // feeds straight into fn_sweep_derived_meters' residual calc for any derived
  // locator sharing this locator as a sibling/mother, corrupting the derived
  // value even though the sweep function itself is correct.
  //
  // The Admin/Data-Analyst-only "Data Corrections" workflow already repairs
  // this via the fn_cascade_reading_correction RPC when it's used — but that
  // RPC is role-gated and this dialog's inline edit/delete (now gated by
  // canEditEntry per row, same as everywhere else — previously unconditional)
  // never calls it. This mirrors the same forward
  // walk as a plain client-side resync instead, so it works under whatever
  // role/RLS already permits editing a single row through this dialog.
  const resyncLocatorChain = async (locatorId: string) => {
    const { data: all, error } = await supabase
      .from('locator_readings')
      .select('id, current_reading, previous_reading, reading_datetime')
      .eq('locator_id', locatorId)
      .order('reading_datetime', { ascending: true });
    if (error || !all) return;

    let last: number | null = null;
    const updates: { id: string; previous_reading: number | null }[] = [];
    for (const row of all as any[]) {
      const newPrev = last;
      if (row.previous_reading !== newPrev) {
        updates.push({ id: row.id, previous_reading: newPrev });
      }
      last = +row.current_reading;
    }
    if (updates.length) {
      // daily_volume is intentionally omitted — GENERATED ALWAYS AS recomputes
      // it automatically once previous_reading is corrected.
      await Promise.all(updates.map(u => supabase
        .from('locator_readings')
        .update({ previous_reading: u.previous_reading } as any)
        .eq('id', u.id)));
    }
  };

  // One-click toggle for shared (non-power) meter replacement.
  // For well/locator, CHECKING opens ReplaceMeterDialog so the swap gets
  // logged (old/new brand, size, serial, installed date) instead of just
  // flipping a flag with no record of what actually happened. UNCHECKING
  // still clears the flag directly — there's nothing to "undo" a replacement
  // record for, it's just correcting a mis-tap.
  const toggleMeterReplacement = async (r: any) => {
    const next = !r.is_meter_replacement;
    if (next && (module === 'well' || module === 'locator')) {
      setReplaceReadingId(r.id);
      return;
    }
    setTogglingId(r.id);
    let error: any = null;
    if (module === 'well') {
      ({ error } = await (supabase.from('well_readings') as any).update({ is_meter_replacement: next }).eq('id', r.id));
      // is_meter_replacement may not exist yet (pending migration) — silently skip toggle
      if (error?.message?.includes('does not exist')) error = null;
    } else if (module === 'locator') {
      ({ error } = await (supabase.from('locator_readings') as any).update({ is_meter_replacement: next }).eq('id', r.id));
      if (!error) await resyncLocatorChain(entityId);
    } else if (module === 'blending') {
      ({ error } = await (supabase.from('blending_events' as any) as any).update({ is_meter_replacement: next }).eq('id', r.id));
      // Column may not exist yet — silently skip (graceful degradation)
      if (error?.message?.includes('does not exist') || error?.message?.includes('is_meter_replacement')) error = null;
    }
    setTogglingId(null);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success(next ? 'Marked as meter replacement — Δ zeroed' : 'Meter replacement flag removed');
    qc.invalidateQueries({ queryKey });
  };

  // Power-specific: toggle grid meter replacement. Checking opens
  // PowerMeterChangeDialog so the swap gets logged (old meter's final reading,
  // new meter's initial reading, date changed — all required) against
  // power_meter_changes, instead of just flipping a flag and blindly resetting
  // the CT multiplier to 1. Mirrors how well/locator/product's Repl. checkbox
  // opens ReplaceMeterDialog. Unchecking still clears the flag directly.
  const toggleGridReplacement = async (r: any, gridIdx: number = 0) => {
    // Use the same fallback as the display: is_grid_replacement ?? is_meter_replacement.
    // Without this, when is_grid_replacement is null the toggle always evaluates
    // !null → true and can never be unchecked.
    const currentRepl = !!(r.is_grid_replacement ?? r.is_meter_replacement);
    const next = !currentRepl;
    if (next) {
      setReplacePowerReadingId({ id: r.id, gridIdx });
      return;
    }
    setTogglingGridId(r.id);
    const { error } = await (supabase.from('power_readings') as any)
      .update({ is_grid_replacement: next }).eq('id', r.id);
    setTogglingGridId(null);
    if (error) {
      // Column may not exist yet — fall back to shared flag
      const { error: e2 } = await (supabase.from('power_readings') as any)
        .update({ is_meter_replacement: next }).eq('id', r.id);
      if (e2) { toast.error(friendlyError(e2)); return; }
    }
    toast.success('Grid replacement flag removed');
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
    const row = rows?.find((r: any) => r.id === id);
    if (!row || !canEditEntry(row, hasFullAccess, activeOperatorId)) return;
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (!rows?.length) return;
    const editableIds = rows
      .filter((r: any) => canEditEntry(r, hasFullAccess, activeOperatorId))
      .map((r: any) => r.id);
    setSelectedIds(prev =>
      prev.size === editableIds.length ? new Set() : new Set(editableIds)
    );
  };

  // Bulk delete
  // Maps the dialog's module prop to the table_name reading_edit_audit_log
  // actually accepts — see 20260806_reading_audit_log_add_power_blending_well.sql.
  const auditTableName = (
    m: HistoryModule,
  ): 'locator_readings' | 'power_readings' | 'blending_events' | 'well_readings' =>
    m === 'locator' ? 'locator_readings'
    : m === 'power' ? 'power_readings'
    : m === 'blending' ? 'blending_events'
    : 'well_readings';

  const actorLabel = () =>
    `${activeOperator?.first_name ?? ''} ${activeOperator?.last_name ?? ''}`.trim()
    || activeOperator?.username || null;

  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const idsRequested = [...selectedIds];
    // Defense in depth: the checkboxes that populate selectedIds already only
    // let you select rows canEditEntry allows, but re-check here too rather
    // than trust client-side selection state alone for something destructive.
    const deletable = new Set(
      (rows ?? [])
        .filter((r: any) => canEditEntry(r, hasFullAccess, activeOperatorId))
        .map((r: any) => r.id),
    );
    const ids = idsRequested.filter(id => deletable.has(id));
    if (ids.length === 0) {
      toast.error('None of the selected rows are yours to delete, or they\u2019re past the 8-hour edit window.');
      return;
    }
    setBulkDeletePending(false);
    setBulkDeleting(true);
    let error: any = null;
    if (module === 'well')
      ({ error } = await supabase.from('well_readings').delete().in('id', ids));
    else if (module === 'locator') {
      ({ error } = await supabase.from('locator_readings').delete().in('id', ids));
      if (!error) await resyncLocatorChain(entityId);
    }
    else if (module === 'power')
      ({ error } = await supabase.from('power_readings').delete().in('id', ids));
    else if (module === 'blending') {
      const { error: _be, count: _bc } = await (supabase.from('blending_events' as any) as any)
        .delete({ count: 'exact' }).in('id', ids);
      error = _be ?? (_bc === 0 ? new Error('Bulk delete blocked — check RLS policy on blending_events') : null);
    }
    setBulkDeleting(false);
    if (error) { toast.error(friendlyError(error)); return; }
    const label = actorLabel();
    for (const id of ids) {
      await logReadingEdit({
        table_name: auditTableName(module),
        record_id: id,
        plant_id: plantId ?? null,
        action: 'delete',
        actor_user_id: user?.id ?? null,
        actor_label: label,
      });
    }
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
    let error: any = null;
    if (module === 'well') ({ error } = await supabase.from('well_readings').delete().eq('id', id));
    else if (module === 'locator') {
      ({ error } = await supabase.from('locator_readings').delete().eq('id', id));
      if (!error) await resyncLocatorChain(entityId);
    }
    else if (module === 'power') ({ error } = await supabase.from('power_readings').delete().eq('id', id));
    else if (module === 'blending') {
      const { error: _be, count: _bc } = await (supabase.from('blending_events' as any) as any)
        .delete({ count: 'exact' }).eq('id', id);
      error = _be ?? (_bc === 0 ? new Error('Delete blocked — run the missing RLS policy SQL (see console)') : null);
      if (_bc === 0 && !_be) console.error('blending_events DELETE returned 0 rows. Add policy: CREATE POLICY "auth_delete_blending_events" ON blending_events FOR DELETE USING (auth.uid() IS NOT NULL);');
    }
    setDeletingId(null);
    if (error) { toast.error(friendlyError(error)); return; }
    await logReadingEdit({
      table_name: auditTableName(module),
      record_id: id,
      plant_id: plantId ?? null,
      action: 'delete',
      actor_user_id: user?.id ?? null,
      actor_label: actorLabel(),
    });
    toast.success('Reading deleted');
    setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    qc.invalidateQueries({ queryKey });
    if (module === 'power') qc.invalidateQueries({ queryKey: ['op-power', entityId] });
    // op-loc-recent / op-well-recent are now invalidated inside
    // invalidateLocatorDash / invalidateWellDash themselves — see shared.tsx.
    if (module === 'locator') invalidateLocatorDash(qc);
    else if (module === 'well') invalidateWellDash(qc);
    else if (module === 'power') invalidatePowerDash(qc);
  };

  const saveEdit = async () => {
    if (!editRow) return;
    const originalRow = rows?.find((r: any) => r.id === editRow.id);
    if (!originalRow || !canEditEntry(originalRow, hasFullAccess, activeOperatorId)) {
      toast.error(
        originalRow?.norm_status === 'pending_review'
          ? 'This reading is flagged and awaiting review in Data Corrections — it can’t be edited until a reviewer approves or rejects it.'
          : 'You can only edit your own entries, within 8 hours of submitting them.',
      );
      setEditRow(null);
      return;
    }
    if (!editReason) { toast.error('Select a reason for this edit'); return; }
    if (!isReasonComplete(editReason, editCustomReason)) { toast.error('Describe the reason for this edit'); return; }
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
      if (!error) await resyncLocatorChain(entityId);
    } else if (module === 'power') {
      // Which grid meter this edit actually belongs to. Captured in startEdit
      // from meterFilter — 0 = STP, the meter the legacy meter_reading_kwh /
      // daily_consumption_kwh / daily_grid_kwh columns represent. Editing any
      // other meter (Pumphouse, Main, ...) must NOT touch those legacy
      // columns — they'd silently overwrite meter 0's data with this meter's
      // value, which is exactly the bug being fixed here (editing Grid Meter
      // 3 Main was reflecting onto Grid Meter 1 STP).
      const gridIdx = editRow.gridIdx ?? 0;
      // meterFilter?.type === 'solar' means this dialog/edit is scoped to the
      // Solar meter, not a grid meter — gridIdx above is just the 0-fallback
      // startEdit uses when there's no real grid meter selection (see
      // gridIdxForEdit above), NOT an actual "editing grid meter STP" signal.
      // Every grid-meter side effect below must be skipped in that case, or
      // the blank Grid Reading field gets coerced to 0 and overwrites
      // meter_reading_kwh / grid_meter_readings['0'] with a fake zero reading.
      const isSolarEditCtx = meterFilter?.type === 'solar';

      // Fix #3 — daily_consumption_kwh was never recalculated on edit, so Dashboard
      // totals would drift after any history correction.  Re-derive it the same way
      // the initial insert does: find the predecessor row, compute Δ meter reading,
      // then apply the CT multiplier so PV ratios stay correct. Only meaningful for
      // meter 0, the one those legacy columns track.
      const editedDt = new Date(dtIso).toISOString();
      const editedDate = editedDt.slice(0, 10);
      let recomputedConsumption: number | null = null;
      if (gridIdx === 0 && !isSolarEditCtx) {
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
      }
      const powerUpdatePayload: Record<string, any> = isSolarDirectMode
        ? {
            // Direct daily kWh: store only daily_solar_kwh, do NOT leave a
            // value behind in solar_meter_reading — mirrors PowerSection.tsx's
            // main entry form so edits made through this dialog don't revert
            // the row to "raw meter" storage, which is what produced the
            // negative/erratic Δ values in the Solar history table.
            daily_solar_kwh: editRow.value2 ? +editRow.value2 : null,
            solar_meter_reading: null,
            reading_datetime: dtIso,
            is_meter_replacement: !!editRow.isMeterReplacement,
          }
        : {
            solar_meter_reading: editRow.value2 ? +editRow.value2 : null,
            reading_datetime: dtIso,
            is_meter_replacement: !!editRow.isMeterReplacement,
          };
      if (gridIdx === 0 && !isSolarEditCtx) {
        powerUpdatePayload.meter_reading_kwh = +editRow.value;
      }
      // Keep grid_meter_readings in sync with the meter actually being edited.
      // Fetch the existing JSONB so we don't overwrite the other meters' slots.
      // Skipped entirely for solar edits — there's no grid meter selection to
      // sync, and writing gridIdx's 0-fallback here would fabricate a
      // grid_meter_readings['0'] entry (coercing the blank Grid Reading field
      // to 0) that doesn't correspond to any meter the user actually edited.
      if (!isSolarEditCtx) {
        try {
          const { data: existingPR } = await (supabase.from('power_readings') as any)
            .select('grid_meter_readings').eq('id', editRow.id).maybeSingle();
          const existingGmr = (existingPR?.grid_meter_readings as Record<string, number> | null) ?? {};
          powerUpdatePayload.grid_meter_readings = { ...existingGmr, [String(gridIdx)]: +editRow.value };
        } catch { /* non-critical: grid_meter_readings column may not exist yet */ }
      }
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
        raw_meter_reading: +editRow.value,
        event_date: editRow.datetime.slice(0, 10),
        reading_datetime: new Date(editRow.datetime).toISOString(),
        is_meter_replacement: !!editRow.isMeterReplacement,
        // previous_reading intentionally omitted — trg_blending_set_reading
        // (20260729_blending_previous_reading_trigger.sql) only auto-resolves
        // it on INSERT, so it carries forward unchanged on UPDATE and
        // volume_m3 is recomputed from it plus the corrected raw_meter_reading.
      };
      const { error: _ue, count: _uc } = await (supabase.from('blending_events' as any) as any)
        .update(blendPayload, { count: 'exact' })
        .eq('id', editRow.id);
      error = _ue ?? (_uc === 0 ? new Error('Update blocked — run the missing RLS policy SQL (see console)') : null);
      if (_uc === 0 && !_ue) console.error('blending_events UPDATE returned 0 rows. Add policy: CREATE POLICY "auth_update_blending_events" ON blending_events FOR UPDATE USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);');
    }
    setSaving(false);
    if (error) { toast.error(friendlyError(error)); return; }
    await logReadingEdit({
      table_name: auditTableName(module),
      record_id: editRow.id,
      plant_id: plantId ?? null,
      action: 'update',
      actor_user_id: user?.id ?? null,
      actor_label: actorLabel(),
      changes: diffFields(
        {
          current_reading: originalRow.current_reading,
          reading_datetime: originalRow.reading_datetime,
          is_meter_replacement: !!originalRow.is_meter_replacement,
        },
        {
          current_reading: +editRow.value,
          reading_datetime: dtIso,
          is_meter_replacement: !!editRow.isMeterReplacement,
        },
      ),
      reason: resolveReason(editReason, editCustomReason),
    });
    toast.success('Reading updated');
    setEditRow(null);
    setEditReason('');
    setEditCustomReason('');
    qc.invalidateQueries({ queryKey });
    // Also invalidate the parent form queries so "Last 7 readings" refreshes.
    // op-loc-recent / op-well-recent are now invalidated inside
    // invalidateLocatorDash / invalidateWellDash themselves — see shared.tsx.
    if (module === 'power') qc.invalidateQueries({ queryKey: ['op-power', entityId] });
    if (module === 'locator') invalidateLocatorDash(qc);
    else if (module === 'well') invalidateWellDash(qc);
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
  // Column exists at all if the current user can edit/delete at least one of
  // the currently-loaded rows — see rowEditable (computed per-row inside the
  // rows.map below) for what actually gates each row's buttons/checkbox.
  const anyEditable = !!rows?.some((r: any) => canEditEntry(r, hasFullAccess, activeOperatorId));

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
                  days === d ? 'bg-primary text-white shadow-sm' : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
            <button
              onClick={() => { setDays('custom'); setEditRow(null); }}
              className={[
                'px-3 py-1 text-xs font-medium rounded-md transition-all',
                days === 'custom' ? 'bg-primary text-white shadow-sm' : 'text-muted-foreground hover:text-foreground',
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
              <Button size="sm" className="h-7 px-3 text-xs bg-primary text-white hover:bg-primary/90"
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
                <Label htmlFor="readinghistorydialog-date-amp-time" className="text-2xs">Date &amp; Time</Label>
                <Input type="datetime-local" value={editRow.datetime}
                  onChange={e => setEditRow({ ...editRow, datetime: e.target.value })}
                  className="h-8 text-xs" id="readinghistorydialog-date-amp-time"/>
              </div>
              {!(module === 'power' && meterFilter?.type === 'solar') && (
                <div>
                  <Label htmlFor="readinghistorydialog-reading-kwh" className="text-2xs">
                    {module === 'well' ? (isDirectMode ? 'Volume (m³)' : 'Water (unitless)') : module === 'locator' ? (isDirectMode ? 'Volume (m³)' : 'Reading') : module === 'blending' ? 'Reading (cumulative)' : `${meterFilter?.type === 'grid' ? getHistGridLabel(meterFilter.idx) : 'Grid'} Reading (kWh)`}
                  </Label>
                  <Input type="number" step="any" value={editRow.value}
                    onChange={e => setEditRow({ ...editRow, value: e.target.value })}
                    className="h-8 text-xs" id="readinghistorydialog-reading-kwh"/>
                </div>
              )}
              {module === 'well' && (
                <div>
                  <Label htmlFor="readinghistorydialog-power-meter-kwh" className="text-2xs">Power Meter (kWh)</Label>
                  <Input type="number" step="any" value={editRow.value2 ?? ''}
                    onChange={e => setEditRow({ ...editRow, value2: e.target.value })}
                    className="h-8 text-xs" placeholder="optional" id="readinghistorydialog-power-meter-kwh"/>
                </div>
              )}
              {module === 'well' && (
                <div>
                  <Label htmlFor="readinghistorydialog-tds-ppm" className="text-2xs">TDS (ppm)</Label>
                  <Input type="number" step="any" value={editRow.value4 ?? ''}
                    onChange={e => setEditRow({ ...editRow, value4: e.target.value })}
                    className="h-8 text-xs" placeholder="optional" id="readinghistorydialog-tds-ppm"/>
                </div>
              )}
              {module === 'well' && (
                <div>
                  <Label htmlFor="readinghistorydialog-ntu" className="text-2xs">NTU</Label>
                  <Input type="number" step="any" value={editRow.value6 ?? ''}
                    onChange={e => setEditRow({ ...editRow, value6: e.target.value })}
                    className="h-8 text-xs" placeholder="optional" id="readinghistorydialog-ntu"/>
                </div>
              )}
              {module === 'well' && (
                <div>
                  <Label htmlFor="readinghistorydialog-pressure-psi" className="text-2xs">Pressure (psi)</Label>
                  <Input type="number" step="any" value={editRow.value5 ?? ''}
                    onChange={e => setEditRow({ ...editRow, value5: e.target.value })}
                    className="h-8 text-xs" placeholder="optional" id="readinghistorydialog-pressure-psi"/>
                </div>
              )}
              {module === 'power' && meterFilter?.type === 'solar' && (
                <div>
                  <Label htmlFor="readinghistorydialog-field" className="text-2xs">{isSolarDirectMode ? 'Solar Generation (kWh, direct)' : 'Solar Meter Reading (kWh)'}</Label>
                  <Input type="number" step="any" value={editRow.value2 ?? ''}
                    onChange={e => setEditRow({ ...editRow, value2: e.target.value })}
                    className="h-8 text-xs" id="readinghistorydialog-field"/>
                </div>
              )}
            </div>
            {module !== 'power' && (
              // Power excluded here deliberately, not by omission: a power reading
              // can hold several grid meters' values in one row (grid_meter_readings
              // JSONB), so a single scalar "this row = replacement" checkbox would be
              // ambiguous about which meter it means. Power's equivalent is the
              // per-meter Repl. toggle in the table above (toggleGridReplacement),
              // which now opens the same required PowerMeterChangeDialog.
              <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
                <input
                  type="checkbox"
                  checked={!!editRow.isMeterReplacement}
                  onChange={e => {
                    if (e.target.checked && (module === 'well' || module === 'locator')) {
                      setReplaceReadingId(editRow.id);
                      return;
                    }
                    setEditRow({ ...editRow, isMeterReplacement: e.target.checked });
                  }}
                  className="h-3.5 w-3.5 accent-kpi-solar"
                />
                <span className="text-2xs text-muted-foreground">Meter replacement / PMS (zeroes Δ)</span>
              </label>
            )}
            <CorrectionReasonField
              reason={editReason} onReasonChange={setEditReason}
              customReason={editCustomReason} onCustomReasonChange={setEditCustomReason}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={saveEdit}
                disabled={saving || (module === 'power' && meterFilter?.type === 'solar' ? !editRow.value2 : !editRow.value) || !isReasonComplete(editReason, editCustomReason)}
                className="bg-primary text-white hover:bg-primary/90 h-7 text-xs px-3">
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save changes'}
              </Button>
              <Button size="sm" variant="outline"
                onClick={() => { setEditRow(null); setEditReason(''); setEditCustomReason(''); }}
                disabled={saving} className="h-7 text-xs px-3">
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Bulk delete toolbar — shown when rows are selected */}
        {anyEditable && selectedIds.size > 0 && (
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
            <table className="w-full text-left">
              <thead className="bg-muted sticky top-0">
                <tr>
                  {anyEditable && (
                    <th className="px-2 py-2 w-8">
                      <input type="checkbox"
                        className="h-3.5 w-3.5 accent-primary cursor-pointer"
                        checked={!!rows?.length && selectedIds.size > 0 &&
                          selectedIds.size === rows.filter((r: any) => canEditEntry(r, hasFullAccess, activeOperatorId)).length}
                        onChange={toggleSelectAll}
                        title="Select all"
                      />
                    </th>
                  )}
                  <th className="px-3 py-2 font-medium">Date & Time</th>
                  {module === 'locator' && (isDirectMode ? <>
                    <th className="px-3 py-2 font-medium text-right">Volume (m³)</th>
                    <th className="px-2 py-2 font-medium text-center">Repl.</th>
                    <th className="px-3 py-2 font-medium">Flags</th>
                  </> : <>
                    <th className="px-3 py-2 font-medium text-right">Reading</th>
                    <th className="px-3 py-2 font-medium text-right">Δ</th>
                    <th className="px-2 py-2 font-medium text-center">Repl.</th>
                    <th className="px-3 py-2 font-medium">Flags</th>
                  </>)}
                  {module === 'well' && (isDirectMode ? <>
                    <th className="px-3 py-2 font-medium text-right">Volume (m³)</th>
                    <th className="px-2 py-2 font-medium text-center">Repl.</th>
                    <th className="px-3 py-2 font-medium text-right">Power (kWh)</th>
                    <th className="px-3 py-2 font-medium text-right">TDS (ppm)</th>
                    <th className="px-3 py-2 font-medium text-right">NTU</th>
                    <th className="px-3 py-2 font-medium text-right">Pressure (psi)</th>
                  </> : <>
                    <th className="px-3 py-2 font-medium text-right">Water</th>
                    <th className="px-3 py-2 font-medium text-right">Δ</th>
                    <th className="px-2 py-2 font-medium text-center">Repl.</th>
                    <th className="px-3 py-2 font-medium text-right">Power (kWh)</th>
                    <th className="px-3 py-2 font-medium text-right">TDS (ppm)</th>
                    <th className="px-3 py-2 font-medium text-right">NTU</th>
                    <th className="px-3 py-2 font-medium text-right">Pressure (psi)</th>
                  </>)}
                  {module === 'blending' && <>
                    <th className="px-3 py-2 font-medium text-right">Reading</th>
                    <th className="px-3 py-2 font-medium text-right">Volume (m³)</th>
                    <th className="px-2 py-2 font-medium text-center">Repl.</th>
                  </>}
                  {module === 'power' && <>
                    <th className="px-3 py-2 font-medium">Meter</th>
                    <th className="px-3 py-2 font-medium text-right">Reading</th>
                    <th className="px-3 py-2 font-medium text-right">Δ (kWh)</th>
                    <th className="px-2 py-2 font-medium text-center text-muted-foreground">×</th>
                    <th className="px-3 py-2 font-medium text-right text-kpi-grid">Power (kWh)</th>
                    <th className="px-2 py-2 font-medium text-center">Repl.</th>
                  </>}
                  {anyEditable && <th className="px-2 py-2 font-medium text-center w-16">Actions</th>}
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
                  const rowEditable = canEditEntry(r, hasFullAccess, activeOperatorId);
                  // rows sorted descending → rows[i+1] is the immediately preceding reading in time
                  const predecessor: any = rows[i + 1] ?? null;
                  // Rollover-aware Δ for well/locator 'raw' (cumulative-meter) mode.
                  // Uses the row's OWN stored previous_reading — kept correct by
                  // fn_cascade_reading_correction / the DB trigger — instead of
                  // predecessor.current_reading, which is only whatever happens to be
                  // adjacent in the currently-fetched/filtered rows array (wrong near
                  // the edge of a custom date range, or after a row is deleted).
                  // calc.dailyVolume applies (meter_rollover_max - previous) + current
                  // when is_meter_rollover is set, and floors at 0 otherwise — the same
                  // formula the DB and the entry form already use, so this stops
                  // producing the large negative "naive subtraction on rollover" delta.
                  const rawDelta = r.previous_reading != null
                    ? calc.dailyVolume(+r.current_reading, +r.previous_reading,
                        !!r.is_meter_rollover, r.meter_rollover_max != null ? +r.meter_rollover_max : null)
                    : null;

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

                  // ── Power module: card-style rows (date header + one sub-row per meter) ──
                  if (module === 'power') {
                    const gmr     = r.grid_meter_readings     as Record<string, number> | null | undefined;
                    const prevGmr = predecessor?.grid_meter_readings as Record<string, number> | null | undefined;
                    const hasSolar = r.solar_meter_reading != null || (r.daily_solar_kwh != null && +r.daily_solar_kwh > 0);
                    // The value to show for this row's solar reading, honoring the
                    // plant's configured mode rather than inferring it from which
                    // column happens to be populated (see solarDirectVal doc above).
                    const solarDisplayVal = isSolarDirectMode ? solarDirectVal(r) : r.solar_meter_reading;
                    // colspan for the date cell: Date + all 6 data columns
                    const dateCols = 7;
                    const actionsCell = anyEditable ? (
                      <td className="px-2 py-1 text-center align-top" rowSpan={resolvedGridCount + (hasSolar ? 1 : 0) + 1}>
                        {rowEditable && (
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
                        )}
                      </td>
                    ) : null;

                    // ── meterFilter: flat single-row-per-record rendering ────────────────
                    if (meterFilter) {
                      const isSolar     = meterFilter.type === 'solar';
                      const solarDirect = isSolar && isSolarDirectMode;
                      const gridIdx = !isSolar ? (meterFilter as { type: 'grid'; idx: number }).idx : 0;
                      const mMult   = isSolar ? 1 : getHistGridMult(gridIdx);
                      const curr    = isSolar
                        ? (solarDirect ? solarDirectVal(r) : r.solar_meter_reading)
                        : (gmr?.[String(gridIdx)] ?? (gridIdx === 0 ? r.meter_reading_kwh : null));
                      const prevVal = isSolar
                        ? predecessor?.solar_meter_reading
                        : (prevGmr?.[String(gridIdx)] ?? (gridIdx === 0 ? predecessor?.meter_reading_kwh : null));
                      // Direct kWh: never diff two readings — each one already IS
                      // that period's kWh, not a cumulative odometer value. Diffing
                      // two independent days' totals is what produced negative/
                      // erratic "Δ" values before this fix.
                      const rawDelta   = solarDirect ? null : (curr != null && prevVal != null ? curr - prevVal : null);
                      const isRepl     = isSolar ? isSolarRepl : isGridRepl;
                      const effective  = isRepl ? 0 : solarDirect ? curr : (rawDelta != null ? rawDelta * mMult : null);
                      return (
                        <tr key={r.id ?? i}
                          className={[
                            'border-t',
                            isEditing  ? 'bg-primary-soft/60'
                            : isRepl   ? 'bg-warn-soft/40'
                            : 'hover:bg-muted/40',
                          ].join(' ')}
                        >
                          {anyEditable && (
                            <td className="px-2 py-1.5 w-8">
                              {rowEditable && (
                                <input type="checkbox" className="h-3.5 w-3.5 accent-primary cursor-pointer"
                                  checked={selectedIds.has(r.id)} onChange={() => toggleSelect(r.id)} />
                              )}
                            </td>
                          )}
                          <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                            <span className="flex items-center gap-1.5">
                              {dateStr}
                              {isRepl && (
                                <span className={`text-3xs font-semibold uppercase tracking-wide px-1 py-0.5 rounded leading-none ${isSolar ? 'text-kpi-solar bg-kpi-solar/15' : 'text-kpi-grid bg-kpi-grid/15'}`}>
                                  repl.
                                </span>
                              )}
                            </span>
                          </td>
                          {/* Meter column placeholder (hidden in filtered view) */}
                          <td />
                          {/* Reading */}
                          <td className="px-3 py-1.5 text-right font-mono-num text-2xs">
                            <span className={isSolar ? 'text-kpi-solar' : 'text-kpi-grid'}>
                              {curr != null ? fmtNum(curr) : '—'}
                            </span>
                          </td>
                          {/* Δ raw */}
                          <td className="px-3 py-1.5 text-right font-mono-num text-2xs">
                            {isRepl
                              ? <span className={isSolar ? 'text-kpi-solar font-medium' : 'text-kpi-grid font-medium'}>0</span>
                              : solarDirect
                                ? <span className="text-muted-foreground" title="Direct kWh input — no delta to compute">n/a</span>
                                : rawDelta != null ? fmtNum(rawDelta) : '—'
                            }
                          </td>
                          {/* × multiplier */}
                          <td className="px-2 py-1.5 text-center font-mono-num text-muted-foreground text-2xs">
                            {mMult !== 1 ? `×${mMult}` : '×1'}
                          </td>
                          {/* Effective kWh */}
                          <td className={['px-3 py-1.5 text-right font-mono-num font-medium text-2xs',
                            effective != null && effective < 0 ? 'text-destructive' : isSolar ? 'text-kpi-solar' : 'text-kpi-grid',
                          ].join(' ')}>
                            {effective != null ? fmtNum(effective) : '—'}
                          </td>
                          {/* Repl. toggle */}
                          <td className="px-2 py-1.5 text-center">
                            <button
                              title={isRepl ? 'Replacement — click to unmark' : 'Mark as meter replacement (zeroes Δ)'}
                              aria-label={isRepl ? 'Replacement — click to unmark' : 'Mark as meter replacement (zeroes Δ)'}
                              disabled={isDeleting || isTogglingGrid || isTogglingSolar}
                              onClick={() => isSolar ? toggleSolarReplacement(r) : toggleGridReplacement(r, gridIdx)}
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
                            <td className="px-2 py-1 text-center">
                              {rowEditable && (
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
                              )}
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
                          isEditing ? 'bg-primary-soft/60'
                          : isGridRepl ? 'bg-warn-soft/40'
                          : 'bg-muted/20',
                        ].join(' ')}>
                          {anyEditable && (
                            <td className="px-2 py-1 w-8">
                              {rowEditable && (
                                <input
                                  type="checkbox"
                                  className="h-3.5 w-3.5 accent-primary cursor-pointer"
                                  checked={selectedIds.has(r.id)}
                                  onChange={() => toggleSelect(r.id)}
                                />
                              )}
                            </td>
                          )}
                          <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground font-medium" colSpan={dateCols}>
                            <span className="flex items-center gap-1.5">
                              {dateStr}
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
                              {anyEditable && <td />}
                              {/* Meter label */}
                              <td className="px-3 py-1 pl-6">
                                <span className="flex items-center gap-1 text-2xs">
                                  <GridPylonIcon className="h-2.5 w-2.5 text-kpi-grid shrink-0" />
                                  <span className="text-muted-foreground truncate">{mLabel}</span>
                                </span>
                              </td>
                              {/* Reading */}
                              <td className="px-3 py-1 text-right font-mono-num text-kpi-grid text-2xs">
                                {curr != null ? fmtNum(curr) : '—'}
                              </td>
                              {/* Δ raw */}
                              <td className="px-3 py-1 text-right font-mono-num text-2xs">
                                {isGridRepl
                                  ? <span className="text-kpi-grid font-medium">0</span>
                                  : rawDelta != null ? fmtNum(rawDelta) : '—'
                                }
                              </td>
                              {/* × multiplier */}
                              <td className="px-2 py-1 text-center font-mono-num text-muted-foreground text-2xs">
                                {mMult !== 1 ? `×${mMult}` : '×1'}
                              </td>
                              {/* Effective kWh */}
                              <td className={[
                                'px-3 py-1 text-right font-mono-num font-medium text-2xs',
                                effective != null && effective < 0 ? 'text-destructive' : 'text-kpi-grid',
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
                                        ? 'bg-kpi-grid border-kpi-grid text-white hover:bg-kpi-grid/90'
                                        : 'border-input bg-background hover:border-kpi-grid/40 hover:bg-kpi-grid/10',
                                    ].join(' ')}
                                  >
                                    {isTogglingGrid
                                      ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                      : isGridRepl ? <span className="text-3xs font-bold leading-none">✓</span> : null
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
                            {anyEditable && <td />}
                            {/* Meter label */}
                            <td className="px-3 py-1 pl-6">
                              <span className="flex items-center gap-1 text-2xs">
                                <span className="text-kpi-solar text-xs leading-none">☀</span>
                                <span className="text-muted-foreground">Solar</span>
                              </span>
                            </td>
                            {/* Reading */}
                            <td className="px-3 py-1 text-right font-mono-num text-kpi-solar text-2xs">
                              {solarDisplayVal != null ? fmtNum(solarDisplayVal) : '—'}
                            </td>
                            {/* Δ Solar */}
                            <td className="px-3 py-1 text-right font-mono-num text-2xs">
                              {isSolarRepl
                                ? <span className="text-kpi-solar font-medium">0</span>
                                : isSolarDirectMode
                                  // Direct kWh: never diff two readings — this IS the
                                  // day's kWh already, not a cumulative meter value.
                                  ? (solarDisplayVal != null
                                      ? <span className="text-kpi-solar">{fmtNum(solarDisplayVal)}</span>
                                      : '—')
                                  : (predecessor?.solar_meter_reading != null && r.solar_meter_reading != null)
                                    ? <span className="text-kpi-solar">{fmtNum(r.solar_meter_reading - predecessor.solar_meter_reading)}</span>
                                    : r.daily_solar_kwh != null && +r.daily_solar_kwh > 0
                                      ? <span className="text-kpi-solar">{fmtNum(+r.daily_solar_kwh)}</span>
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
                                    ? 'bg-kpi-solar border-kpi-solar text-white hover:bg-kpi-solar/90'
                                    : 'border-input bg-background hover:border-kpi-solar/40 hover:bg-kpi-solar/10',
                                ].join(' ')}
                              >
                                {isTogglingSolar
                                  ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                  : isSolarRepl ? <span className="text-3xs font-bold leading-none">✓</span> : null
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
                        isEditing      ? 'bg-primary-soft/60'
                        : isMeterReplacement ? 'bg-warn-soft/40'
                        : 'hover:bg-muted/40',
                      ].join(' ')}
                    >
                      {anyEditable && (
                        <td className="px-2 py-1.5 w-8">
                          {rowEditable && (
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 accent-primary cursor-pointer"
                              checked={selectedIds.has(r.id)}
                              onChange={() => toggleSelect(r.id)}
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
                        <td className="px-3 py-1.5 text-right font-mono-num">{fmtNum(r.current_reading)}</td>
                        {replCell}
                        <td className="px-3 py-1.5">
                          {r.off_location_flag && <span className="text-warn font-medium">off-loc</span>}
                        </td>
                      </> : <>
                        <td className="px-3 py-1.5 text-right font-mono-num">{fmtNum(r.current_reading)}</td>
                        <td className="px-3 py-1.5 text-right font-mono-num">
                          {isMeterReplacement
                            ? <span className="text-kpi-solar font-medium">0</span>
                            : rawDelta != null ? fmtNum(rawDelta) : '—'
                          }
                        </td>
                        {replCell}
                        <td className="px-3 py-1.5">
                          {r.off_location_flag && <span className="text-warn font-medium">off-loc</span>}
                        </td>
                      </>)}

                      {module === 'well' && (isDirectMode ? <>
                        <td className="px-3 py-1.5 text-right font-mono-num">{fmtNum(r.current_reading)}</td>
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
                      </> : <>
                        <td className="px-3 py-1.5 text-right font-mono-num">{fmtNum(r.current_reading)}</td>
                        <td className="px-3 py-1.5 text-right font-mono-num">
                          {isMeterReplacement
                            ? <span className="text-kpi-solar font-medium">0</span>
                            : rawDelta != null ? fmtNum(rawDelta) : '—'
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
                      </>)}

                      {module === 'blending' && <>
                        <td className="px-3 py-1.5 text-right font-mono-num text-muted-foreground">
                          {r.raw_meter_reading != null ? fmtNum(r.raw_meter_reading) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono-num">{fmtNum(r.volume_m3 ?? 0)}</td>
                        {replCell}
                      </>}

                      {anyEditable && (
                        <td className="px-2 py-1 text-center">
                          {rowEditable && (
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

        {replaceReadingId && (module === 'well' || module === 'locator') && (
          <ReplaceMeterDialog
            kind={module}
            assetId={entityId}
            plantId={plantId ?? ''}
            oldSerial={assetMeterSerial ?? null}
            readingId={replaceReadingId}
            onSuccess={() => {
              // Prevent a subsequent "Save changes" from clobbering the flag
              // ReplaceMeterDialog just set back to false with stale local state.
              setEditRow(prev => (prev && prev.id === replaceReadingId ? { ...prev, isMeterReplacement: true } : prev));
              qc.invalidateQueries({ queryKey });
            }}
            onClose={() => setReplaceReadingId(null)}
          />
        )}

        {replacePowerReadingId && module === 'power' && plantId && (
          <PowerMeterChangeDialog
            plant={{ id: plantId }}
            gridMeterCount={resolvedGridCount}
            gridMeterNames={gridMeterNames}
            currentMultipliers={gridMultipliers}
            readingId={replacePowerReadingId.id}
            initialMeterIndex={replacePowerReadingId.gridIdx}
            onSuccess={() => qc.invalidateQueries({ queryKey })}
            onClose={() => setReplacePowerReadingId(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
