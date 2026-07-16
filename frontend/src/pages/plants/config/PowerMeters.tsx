import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
// ─── Hybrid Strategy: Backend + Frontend Delta Handling ───────────────────────
// Plants.tsx owns recomputePermeateDeltas — the authoritative DB write for
// permeate_meter_delta.  After each successful UPDATE we also call
// deltaCache.set() so the Dashboard and TrendChart immediately use the
// recomputed value without waiting for a refetch (Tier-1 shortcut path).
// When is_meter_replacement is toggled we call deltaCache.invalidate(trainId)
// to force a Tier-2 raw recompute on the next render.
import { deltaCache } from '@/lib/deltaCache';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusPill } from '@/components/StatusPill';
import { DeleteEntityMenu } from '@/components/DeleteEntityMenu';
import { ChevronLeft, ChevronDown, Plus, MapPin, Gauge, Wrench, Sun, Zap, Trash2, Loader2, Pencil, Upload, FileDown, X, TrendingUp, Download, BarChart2, Calendar, Droplet } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, ComposedChart, Area } from 'recharts';
import { fmtNum } from '@/lib/calculations';
import { toast } from 'sonner';
import { format } from 'date-fns';


import { BASE } from '../shared';

export function MeterNameList({
  count, names, accentColor, defaultPrefix, onSave, onRemoveLast,
}: {
  count: number;
  names: string[];
  accentColor: 'yellow' | 'blue';
  defaultPrefix: string;
  onSave: (names: string[]) => void;
  onRemoveLast: () => void;
}) {
  const isYellow = accentColor === 'yellow';
  const ring   = isYellow ? 'focus-visible:ring-yellow-400' : 'focus-visible:ring-blue-400';
  const border = isYellow ? 'border-yellow-300' : 'border-blue-300';
  const chip   = isYellow
    ? 'bg-yellow-50 border-yellow-200 text-yellow-800 dark:bg-yellow-950/20 dark:border-yellow-800 dark:text-yellow-300'
    : 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950/20 dark:border-blue-800 dark:text-blue-300';

  const [editingIdx, setEditingIdx]           = useState<number>(-1);
  const [editVal, setEditVal]                 = useState('');
  const [confirmDeleteIdx, setConfirmDeleteIdx] = useState<number>(-1);

  const startEdit     = (i: number) => { setConfirmDeleteIdx(-1); setEditingIdx(i); setEditVal(names[i] ?? `${defaultPrefix} ${i + 1}`); };
  const commitEdit    = () => {
    if (editingIdx < 0) return;
    const trimmed = editVal.trim() || `${defaultPrefix} ${editingIdx + 1}`;
    const next = [...names]; next[editingIdx] = trimmed;
    onSave(next); setEditingIdx(-1);
  };
  const cancelEdit    = () => setEditingIdx(-1);
  const askDelete     = (i: number) => { setEditingIdx(-1); setConfirmDeleteIdx(i); };
  const confirmDelete = (i: number) => {
    const next = [...names]; next.splice(i, 1);
    onSave(next); onRemoveLast(); setConfirmDeleteIdx(-1);
  };

  return (
    <div className="flex gap-1.5 flex-wrap mt-1">
      {Array.from({ length: count }).map((_, i) => {
        const name = names[i] ?? `${defaultPrefix} ${i + 1}`;
        if (editingIdx === i) return (
          <div key={i} className={`flex items-center gap-0.5 rounded border ${border} bg-background px-1 py-0.5`}>
            <input autoFocus value={editVal} onChange={e => setEditVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
              className={`h-5 w-24 text-[11px] bg-transparent focus:outline-none focus-visible:ring-1 ${ring} rounded px-0.5`} />
            <button onClick={commitEdit} className="text-[9px] font-semibold text-emerald-700 hover:text-emerald-900 px-0.5">✓</button>
            <button onClick={cancelEdit} className="text-[9px] text-muted-foreground hover:text-foreground px-0.5">✕</button>
          </div>
        );
        if (confirmDeleteIdx === i) return (
          <div key={i} className="flex items-center gap-0.5 rounded border border-destructive/40 bg-destructive/5 px-1.5 py-0.5">
            <span className="text-[10px] text-destructive font-medium">Delete "{name}"?</span>
            <button onClick={() => confirmDelete(i)} className="text-[9px] font-bold text-destructive ml-1 px-0.5">Yes</button>
            <button onClick={() => setConfirmDeleteIdx(-1)} className="text-[9px] text-muted-foreground px-0.5">No</button>
          </div>
        );
        return (
          <div key={i} className={`flex items-center gap-0.5 rounded border ${chip} px-1.5 py-0.5 text-[11px]`}>
            <span>{name}</span>
            <button onClick={() => startEdit(i)} className="ml-0.5 opacity-60 hover:opacity-100" title={`Rename "${name}"`}>
              <Pencil className="h-2.5 w-2.5" />
            </button>
            <button onClick={() => askDelete(i)} className="opacity-60 hover:opacity-100 hover:text-destructive" title={`Remove "${name}"`}>
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── GridMeterListRows ────────────────────────────────────────────────────────
// Table-style rows: Meter Name | Multiplier | actions
// Consumption = (current − previous) × multiplier (per meter).
export function GridMeterListRows({
  count, names, multipliers, onSaveNames, onSaveMultiplier, onRemoveLast,
}: {
  count: number;
  names: string[];
  multipliers: number[];
  onSaveNames: (names: string[]) => void;
  onSaveMultiplier: (idx: number, val: number) => void;
  onRemoveLast: () => void;
}) {
  const [editingIdx, setEditingIdx]             = useState<number>(-1);
  const [editVal, setEditVal]                   = useState('');
  const [confirmDeleteIdx, setConfirmDeleteIdx] = useState<number>(-1);

  // Local string state for each multiplier input so the user can type freely
  // without the controlled value snapping back on every keystroke.
  const [multInputs, setMultInputs] = useState<string[]>(() =>
    Array.from({ length: multipliers.length }, (_, i) => String(multipliers[i] ?? 1))
  );

  // Track which multiplier cell the user is actively typing in.
  // A ref (not state) is used deliberately: the useEffect below reads this
  // value when it fires — a state variable would give a stale value in the
  // closure because focusedMultIdx would not be in the dependency array.
  const focusedMultIdxRef = useRef<number>(-1);

  // Sync display strings whenever the parent multipliers array changes
  // (e.g. savedConfig loads, navigate-back remount, post-save refetch).
  // The ref guarantees we always read the live focused index, never a stale one.
  useEffect(() => {
    setMultInputs(prev => {
      const next = [...prev];
      multipliers.forEach((m, i) => {
        if (i !== focusedMultIdxRef.current) next[i] = String(m > 0 ? m : 1);
      });
      return next;
    });
  }, [multipliers]);

  const commitMultiplier = (i: number, raw: string) => {
    const v = parseFloat(raw);
    if (v > 0) {
      onSaveMultiplier(i, v);
    } else {
      // Invalid/empty — revert displayed value to the last known good value
      setMultInputs(prev => {
        const next = [...prev]; next[i] = String(multipliers[i] ?? 1); return next;
      });
    }
  };

  const startEdit  = (i: number) => { setConfirmDeleteIdx(-1); setEditingIdx(i); setEditVal(names[i] ?? `Grid Meter ${i + 1}`); };
  const commitEdit = () => {
    if (editingIdx < 0) return;
    const trimmed = editVal.trim() || `Grid Meter ${editingIdx + 1}`;
    const next = [...names]; next[editingIdx] = trimmed;
    onSaveNames(next); setEditingIdx(-1);
  };
  const cancelEdit    = () => setEditingIdx(-1);
  const askDelete     = (i: number) => { setEditingIdx(-1); setConfirmDeleteIdx(i); };
  const confirmDelete = (i: number) => {
    const next = [...names]; next.splice(i, 1);
    onSaveNames(next); onRemoveLast(); setConfirmDeleteIdx(-1);
  };

  return (
    <div className="rounded-md border border-input overflow-hidden">
      {/* Table header */}
      <div className="grid grid-cols-[1fr_100px_auto] items-center bg-muted/50 border-b border-input px-2 py-1 gap-2">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Meter Name</span>
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide text-center">
          Multiplier
          <span className="normal-case font-normal ml-0.5 opacity-70">(CT ratio)</span>
        </span>
        <span className="w-10" />
      </div>

      {/* Rows */}
      {Array.from({ length: count }).map((_, i) => {
        const name = names[i] ?? `Grid Meter ${i + 1}`;
        const mult = multipliers[i] ?? 1;

        if (confirmDeleteIdx === i) return (
          <div key={i} className="grid grid-cols-[1fr_100px_auto] items-center gap-2 px-2 py-2 bg-destructive/5 border-b border-input last:border-b-0">
            <span className="text-xs text-destructive font-medium truncate col-span-2">Delete "{name}"?</span>
            <div className="flex items-center gap-1 w-10">
              <button onClick={() => confirmDelete(i)} className="text-[10px] font-bold text-destructive hover:underline">Yes</button>
              <span className="text-muted-foreground/40">/</span>
              <button onClick={() => setConfirmDeleteIdx(-1)} className="text-[10px] text-muted-foreground hover:underline">No</button>
            </div>
          </div>
        );

        if (editingIdx === i) return (
          <div key={i} className="grid grid-cols-[1fr_100px_auto] items-center gap-2 px-2 py-1.5 border-b border-input last:border-b-0 bg-background">
            <input autoFocus value={editVal} onChange={e => setEditVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
              className="text-xs bg-transparent border-b border-blue-400 focus:outline-none w-full" />
            {/* Keep multiplier visible while editing name */}
            <div className="flex items-center justify-center gap-1">
              <span className="text-[11px] text-muted-foreground font-mono">×</span>
              <span className="text-xs font-mono font-semibold text-blue-700 dark:text-blue-300">{mult}</span>
            </div>
            <div className="flex items-center gap-1 w-10">
              <button onClick={commitEdit} className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-900">✓</button>
              <button onClick={cancelEdit} className="text-[11px] text-muted-foreground hover:text-foreground">✕</button>
            </div>
          </div>
        );

        return (
          <div key={i} className="grid grid-cols-[1fr_100px_auto] items-center gap-2 px-2 py-1.5 border-b border-input last:border-b-0 bg-background hover:bg-muted/20 transition-colors">
            {/* Meter name */}
            <span className="text-xs truncate" title={name}>{name}</span>

            {/* Multiplier cell — uses local state so typing is not interrupted */}
            <div className="flex items-center gap-1 justify-center">
              <span className="text-[11px] text-muted-foreground font-mono shrink-0">×</span>
              <input
                type="number" step="any" min="0.001"
                value={multInputs[i] ?? String(mult)}
                onChange={e => {
                  const raw = e.target.value;
                  setMultInputs(prev => { const next = [...prev]; next[i] = raw; return next; });
                }}
                onFocus={() => { focusedMultIdxRef.current = i; }}
                onBlur={e => { focusedMultIdxRef.current = -1; commitMultiplier(i, e.target.value); }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); }
                  if (e.key === 'Escape') {
                    setMultInputs(prev => { const next = [...prev]; next[i] = String(mult); return next; });
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                className="w-[60px] text-xs text-center font-mono font-semibold text-blue-700 dark:text-blue-300 bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                title={`CT multiplier for "${name}". Consumption = (Current − Previous) × ${mult}. Press Enter or click away to save.`}
              />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-0.5 w-10 justify-end">
              <button
                onClick={() => startEdit(i)}
                className="inline-flex items-center justify-center h-5 w-5 rounded-full text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors"
                title={`Rename "${name}"`}
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                onClick={() => askDelete(i)}
                className="inline-flex items-center justify-center h-5 w-5 rounded-full text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                title={`Remove "${name}"`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── MeterNameListRows (full-width row editor matching image 2 design) ────────
export function MeterNameListRows({
  count, names, accentColor, defaultPrefix, onSave, onRemoveLast,
}: {
  count: number;
  names: string[];
  accentColor: 'yellow' | 'blue';
  defaultPrefix: string;
  onSave: (names: string[]) => void;
  onRemoveLast: () => void;
}) {
  const [editingIdx, setEditingIdx]             = useState<number>(-1);
  const [editVal, setEditVal]                   = useState('');
  const [confirmDeleteIdx, setConfirmDeleteIdx] = useState<number>(-1);

  const startEdit  = (i: number) => { setConfirmDeleteIdx(-1); setEditingIdx(i); setEditVal(names[i] ?? `${defaultPrefix} ${i + 1}`); };
  const commitEdit = () => {
    if (editingIdx < 0) return;
    const trimmed = editVal.trim() || `${defaultPrefix} ${editingIdx + 1}`;
    const next = [...names]; next[editingIdx] = trimmed;
    onSave(next); setEditingIdx(-1);
  };
  const cancelEdit    = () => setEditingIdx(-1);
  const askDelete     = (i: number) => { setEditingIdx(-1); setConfirmDeleteIdx(i); };
  const confirmDelete = (i: number) => {
    const next = [...names]; next.splice(i, 1);
    onSave(next); onRemoveLast(); setConfirmDeleteIdx(-1);
  };

  return (
    <div className="space-y-1">
      {Array.from({ length: count }).map((_, i) => {
        const name = names[i] ?? `${defaultPrefix} ${i + 1}`;

        if (editingIdx === i) return (
          <div key={i} className="flex items-center gap-1 rounded border border-input bg-background px-2 py-1.5">
            <input autoFocus value={editVal} onChange={e => setEditVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
              className="flex-1 text-xs bg-transparent focus:outline-none" />
            <button onClick={commitEdit} className="text-[10px] font-semibold text-emerald-700 hover:text-emerald-900 px-1">✓</button>
            <button onClick={cancelEdit} className="text-[10px] text-muted-foreground hover:text-foreground px-1">✕</button>
          </div>
        );

        if (confirmDeleteIdx === i) return (
          <div key={i} className="flex items-center gap-1 rounded border border-destructive/40 bg-destructive/5 px-2 py-1.5">
            <span className="flex-1 text-xs text-destructive font-medium">Delete "{name}"?</span>
            <button onClick={() => confirmDelete(i)} className="text-[10px] font-bold text-destructive px-1">Yes</button>
            <button onClick={() => setConfirmDeleteIdx(-1)} className="text-[10px] text-muted-foreground px-1">No</button>
          </div>
        );

        return (
          <div key={i} className="flex items-center gap-1 rounded border border-input bg-background px-2 py-1.5 text-xs">
            <span className="flex-1 truncate">{name}</span>
            <button
              onClick={() => startEdit(i)}
              className="inline-flex items-center justify-center h-5 w-5 rounded-full text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors"
              title={`Rename "${name}"`}
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              onClick={() => askDelete(i)}
              className="inline-flex items-center justify-center h-5 w-5 rounded-full text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
              title={`Remove "${name}"`}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Power History Chart ──────────────────────────────────────────────────────
// ─── PowerConsumptionEnergyMix ────────────────────────────────────────────────
// Merged card: Power Consumption & Energy Mix.
// • Single stacked bar chart (Solar + Grid) shared by both sections.
// • Stat summary row (Today Solar / Today Grid / Today Total + solar % of mix).
// • Range selector (30d / 90d / 180d / All) and Source filter (Both / Solar / Grid).
// • CSV export.
// Replaces the old separate PowerHistoryChart and the standalone Energy Mix card.
export function PowerConsumptionEnergyMix({
  plantId, hasSolar, hasGrid,
}: {
  plantId: string;
  hasSolar: boolean;
  hasGrid: boolean;
}) {
  const [range, setRange]   = useState<'30' | '90' | '180' | 'all'>('30');
  const [source, setSource] = useState<'both' | 'solar' | 'grid'>('both');

  const { data: rows = [], isLoading } = useQuery<{ date: string; solar: number; grid: number }[]>({
    queryKey: ['power-history', plantId, range],
    queryFn: async () => {
      const days  = range === 'all' ? 9999 : parseInt(range);
      const since = new Date(Date.now() - days * 86400_000).toISOString();

      // ── Step 1: Per-meter multipliers from plant_power_config ──────────────
      // Load the full array so multi-meter plants can apply the correct CT ratio
      // per meter index.  Falls back to multiplier = 1 when the table is absent.
      let multiplier = 1;
      let multiplierArr: number[] = [1];
      try {
        const { data: ppc } = await (supabase.from('plant_power_config' as any) as any)
          .select('grid_meter_multipliers')
          .eq('plant_id', plantId)
          .maybeSingle();
        const mArr = ppc?.grid_meter_multipliers;
        if (Array.isArray(mArr) && mArr.length > 0) {
          multiplierArr = mArr.map((v: any) => +v > 0 ? +v : 1);
          multiplier    = multiplierArr[0];
        }
      } catch { /* table may not exist — keep defaults */ }

      // ── Step 2: Fetch window rows + one row BEFORE the window ───────────────
      // We need the row before `since` to compute the delta for the first in-window
      // reading (otherwise the first bar is always 0 or shows a spike).
      const { data: allRows } = await supabase
        .from('power_readings' as any)
        .select('reading_datetime, meter_reading_kwh, grid_meter_readings, solar_meter_reading, daily_consumption_kwh, daily_grid_kwh, daily_solar_kwh, is_meter_replacement, multiplier')
        .eq('plant_id', plantId)
        .order('reading_datetime', { ascending: true });

      const rows = (allRows ?? []) as any[];

      // ── Step 3: Compute per-day grid kWh ───────────────────────────────────
      // Priority order — highest wins, falls through to next when null/zero:
      //   1. daily_consumption_kwh  — pre-multiplied total written by Operations save
      //   2. daily_grid_kwh         — same value written by trigger / SQL backfill
      //   3. grid_meter_readings JSONB delta × per-meter multiplierArr (config, NOT r.multiplier)
      //   4. meter_reading_kwh delta × multiplierArr[0]  (single-meter legacy fallback)
      // NOTE: r.multiplier (power_readings.multiplier column) is NEVER used here —
      //       it is stuck at 1.0000 for all rows and would produce the wrong value.
      //       multiplierArr comes from plant_power_config.grid_meter_multipliers (live).
      const byDate = new Map<string, { solar: number; grid: number }>();
      const ensure = (d: string) => {
        if (!byDate.has(d)) byDate.set(d, { solar: 0, grid: 0 });
        return byDate.get(d)!;
      };

      let prevGridMeter: number | null = null;
      let prevGridReadings: Record<string, number> | null = null;

      for (const r of rows) {
        // Fix: use format() (local timezone) instead of slice(0,10) (UTC date).
        // In UTC+8, a reading saved at "May 21 00:00 local" is stored as
        // "2026-05-20T16:00:00Z". slice(0,10) returns "2026-05-20", shifting
        // every bar 1 day behind Operations. format() resolves to local date.
        const date = r.reading_datetime ? format(new Date(r.reading_datetime), 'yyyy-MM-dd') : '';
        if (!date) continue;

        const isMeterRepl = !!r.is_meter_replacement;
        const gridCurrent = r.meter_reading_kwh != null ? +r.meter_reading_kwh : null;
        const rGmr = r.grid_meter_readings as Record<string, number> | null | undefined;

        // ── Grid kWh ──
        if (isMeterRepl) {
          // Replacement row: zero this day's contribution, but update the baseline
          // so the very next row correctly computes its delta from the new meter start.
          prevGridMeter    = gridCurrent;
          prevGridReadings = rGmr ?? null;
        } else {
          let gridKwh = 0;

          // ── Priority order (highest = most accurate, matches "Last 7 readings" display) ──
          // 1. Raw JSONB multi-meter delta × per-meter CT multiplier  ← always recomputed, never stale
          // 2. Raw single-meter delta × multiplierArr[0]              ← same, single-meter fallback
          // 3. daily_consumption_kwh                                  ← stored at save time; may be stale
          // 4. daily_grid_kwh                                         ← same staleness risk
          //
          // Rationale: daily_consumption_kwh is computed once at write time using whatever
          // previous reading existed then. If that baseline was wrong (e.g. a meter was
          // recently changed or an earlier row was backfilled), the stored value is
          // permanently inflated/deflated — causing chart spikes that disagree with the
          // "Last 7 readings" panel, which always recomputes live from consecutive rows.
          // By computing from raw readings first we stay consistent with that panel.
          //
          // NOTE: The old `afterGridRepl` guard that skipped raw delta for the row
          // immediately after a replacement has been removed. The replacement row already
          // advances prevGridMeter/prevGridReadings to the new meter baseline, so the
          // next row's (curr − prev) delta is correct and must NOT be skipped — skipping
          // it caused the bar for that day to be empty when stored daily totals were null.
          {
            const pGmr = prevGridReadings;

            if (rGmr && pGmr && Object.keys(rGmr).length > 0) {
              // Priority 1: multi-meter — sum (Δ per JSONB meter key × per-meter CT mult)
              let total = 0;
              for (const k of Object.keys(rGmr)) {
                const mi    = parseInt(k, 10);
                const mMult = multiplierArr[mi] ?? multiplierArr[0] ?? 1;
                if (pGmr[k] != null) total += (rGmr[k] - pGmr[k]) * mMult;
              }
              if (total >= 0) gridKwh = total;
            } else if (prevGridMeter != null && gridCurrent != null) {
              // Priority 2: single-meter legacy — (curr − prev) × multiplierArr[0]
              const delta = gridCurrent - prevGridMeter;
              if (delta >= 0) gridKwh = delta * (multiplierArr[0] ?? 1);
            }
          }

          // Priority 3 & 4: fall back to stored daily totals when raw delta is unavailable or zero.
          if (gridKwh === 0) {
            if (r.daily_consumption_kwh != null && +r.daily_consumption_kwh > 0) {
              gridKwh = +r.daily_consumption_kwh;
            } else if (r.daily_grid_kwh != null && +r.daily_grid_kwh > 0) {
              gridKwh = +r.daily_grid_kwh;
            }
          }

          prevGridMeter    = gridCurrent;
          prevGridReadings = rGmr ?? null;

          // Only accumulate dates that fall within the requested window
          if (r.reading_datetime >= since && gridKwh > 0) {
            ensure(date).grid += gridKwh;
          }
        }

        // ── Solar kWh ──
        // daily_solar_kwh is always stored directly (either direct-entry or delta-computed
        // by Operations at save time). No further delta math needed.
        if (!isMeterRepl && r.reading_datetime >= since) {
          const solarKwh = r.daily_solar_kwh != null ? Math.max(0, +r.daily_solar_kwh) : 0;
          if (solarKwh > 0) ensure(date).solar += solarKwh;
        }
      }

      // Filter to only dates within the window, then sort
      return Array.from(byDate.entries())
        .filter(([date]) => date >= since.slice(0, 10))
        .map(([date, v]) => ({ date, solar: +v.solar.toFixed(2), grid: +v.grid.toFixed(2) }))
        .sort((a, b) => a.date.localeCompare(b.date));
    },
    staleTime: 60_000,
  });

  // ── Chart data — filter by source toggle ───────────────────────────────────
  const chartRows = useMemo(() => rows.map(r => ({
    date: r.date,
    solar: source !== 'grid'  ? r.solar : 0,
    grid:  source !== 'solar' ? r.grid  : 0,
  })), [rows, source]);

  // ── Today's stats (last row) ────────────────────────────────────────────────
  const today     = rows.length ? rows[rows.length - 1] : null;
  const yesterday = rows.length > 1 ? rows[rows.length - 2] : null;

  const todaySolar = today?.solar ?? 0;
  const todayGrid  = today?.grid  ?? 0;
  const todayTotal = +(todaySolar + todayGrid).toFixed(2);
  const solarPct   = todayTotal > 0 ? +((todaySolar / todayTotal) * 100).toFixed(1) : 0;

  const solarDelta = yesterday && yesterday.solar > 0
    ? +(((todaySolar - yesterday.solar) / yesterday.solar) * 100).toFixed(1)
    : null;
  const gridDelta = yesterday && yesterday.grid > 0
    ? +(((todayGrid - yesterday.grid) / yesterday.grid) * 100).toFixed(1)
    : null;

  // ── CSV export ─────────────────────────────────────────────────────────────
  const exportCSV = () => {
    if (!rows.length) { toast.error('No data to export'); return; }
    const blob = new Blob(
      [['date,solar_kwh,grid_kwh,total_kwh', ...rows.map(r => `${r.date},${r.solar},${r.grid},${+(r.solar + r.grid).toFixed(2)}`)].join('\n')],
      { type: 'text/csv' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `power_energy_mix_${plantId}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported');
  };

  // ── Range label for subtitle ────────────────────────────────────────────────
  const rangeLabel = range === 'all' ? 'all time' : `last ${range}d`;

  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-teal-600" />
            <span className="text-sm font-semibold">Power Consumption &amp; Energy Mix</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 pl-6">
            {rangeLabel} · daily totals · Solar vs Grid (kWh)
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Range pills */}
          <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
            {(['30','90','180','all'] as const).map(r => (
              <button key={r} onClick={() => setRange(r)}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                  range === r ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:text-foreground'
                }`}>
                {r === 'all' ? 'All' : `${r}d`}
              </button>
            ))}
          </div>
          {/* Source pills — only shown when plant has both sources */}
          {hasSolar && hasGrid && (
            <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
              {(['both','solar','grid'] as const).map(s => (
                <button key={s} onClick={() => setSource(s)}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium capitalize transition-colors ${
                    source === s ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:text-foreground'
                  }`}>
                  {s === 'both' ? 'Both' : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          )}
          {/* Export */}
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" onClick={exportCSV}>
            <Download className="h-3 w-3" /><span className="hidden sm:inline">Export</span>
          </Button>
        </div>
      </div>

      {/* ── Today stat cards ── */}
      {today && (
        <div className="grid grid-cols-3 gap-2">
          {/* Today Solar */}
          {hasSolar && (
            <div className="rounded-lg border border-yellow-200/70 bg-yellow-50/40 dark:border-yellow-800/30 dark:bg-yellow-950/10 px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <Sun className="h-3 w-3 text-yellow-500" />
                <span className="text-[9px] font-semibold uppercase tracking-wide text-yellow-700 dark:text-yellow-400">Today Solar</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-semibold tabular-nums">{fmtNum(todaySolar)}</span>
                <span className="text-[10px] text-muted-foreground">kWh</span>
              </div>
              {solarDelta !== null && (
                <div className={`text-[10px] mt-0.5 font-medium ${solarDelta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>
                  {solarDelta >= 0 ? '↑' : '↓'} {Math.abs(solarDelta)}% vs yesterday
                </div>
              )}
            </div>
          )}
          {/* Today Grid */}
          {hasGrid && (
            <div className="rounded-lg border border-blue-200/70 bg-blue-50/40 dark:border-blue-800/30 dark:bg-blue-950/10 px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <GridPylonIcon className="h-3 w-3 text-blue-500" />
                <span className="text-[9px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-400">Today Grid</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-semibold tabular-nums">{fmtNum(todayGrid)}</span>
                <span className="text-[10px] text-muted-foreground">kWh</span>
              </div>
              {gridDelta !== null && (
                <div className={`text-[10px] mt-0.5 font-medium ${gridDelta <= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>
                  {gridDelta >= 0 ? '↑' : '↓'} {Math.abs(gridDelta)}% vs yesterday
                </div>
              )}
            </div>
          )}
          {/* Today Total */}
          <div className="rounded-lg border border-teal-200/70 bg-teal-50/40 dark:border-teal-800/30 dark:bg-teal-950/10 px-3 py-2.5">
            <div className="flex items-center gap-1.5 mb-1">
              <Zap className="h-3 w-3 text-teal-600" />
              <span className="text-[9px] font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-400">Today Total</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-lg font-semibold tabular-nums">{fmtNum(todayTotal)}</span>
              <span className="text-[10px] text-muted-foreground">kWh</span>
            </div>
            {hasSolar && (
              <div className="text-[10px] mt-0.5 text-muted-foreground">
                Solar: <span className="font-medium text-yellow-600 dark:text-yellow-400">{solarPct}%</span> of mix
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Chart ── */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48 gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : chartRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-2 text-xs text-muted-foreground">
          <BarChart2 className="h-8 w-8 opacity-30" />
          <p>No power readings in this period</p>
        </div>
      ) : (
        <>
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartRows}
                margin={{ top: 4, right: 4, bottom: 20, left: 0 }}
                barSize={Math.max(3, Math.min(14, 400 / chartRows.length))}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={(v: string) => v.slice(5)}
                  interval="preserveStartEnd"
                  angle={-30}
                  textAnchor="end"
                  height={36}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                  width={42}
                  tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)}
                />
                <Tooltip
                  formatter={(v: any, name: string) => [`${fmtNum(v)} kWh`, name === 'solar' ? '☀ Solar' : '⚡ Grid']}
                  labelFormatter={(label: string) => `Date: ${label}`}
                  labelStyle={{ fontSize: 11 }}
                  contentStyle={{ fontSize: 11, borderRadius: 8 }}
                />
                {hasSolar && source !== 'grid' && (
                  <Bar dataKey="solar" fill="hsl(48, 96%, 53%)" name="solar" radius={[0, 0, 0, 0]} stackId="a" />
                )}
                {hasGrid && source !== 'solar' && (
                  <Bar dataKey="grid" fill="hsl(213, 94%, 68%)" name="grid" radius={[2, 2, 0, 0]} stackId="a" />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
            {hasSolar && source !== 'grid' && (
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-yellow-400" />
                Solar (kWh)
              </div>
            )}
            {hasGrid && source !== 'solar' && (
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-blue-400" />
                Grid (kWh)
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── PowerMeterChangeDialog ───────────────────────────────────────────────────
// Records a physical grid meter replacement for a plant's Power tab.
// On save it:
//   1. Updates grid_meter_multipliers in plant_power_config (new ratio takes effect immediately)
//   2. Inserts a best-effort audit row into power_meter_changes (table may not exist yet)
//   3. Inserts an is_meter_replacement=true power_reading at the change date so the
//      Δ is zeroed at the rollover point — mirrors how Locator / Well "Replace Meter" works.
export function PowerMeterChangeDialog({
  plant, gridMeterCount, gridMeterNames, currentMultipliers, onClose,
}: {
  plant: any;
  gridMeterCount: number;
  gridMeterNames: string[];
  currentMultipliers: number[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [form, setForm] = useState({
    meterIndex: 0,
    changeDate: format(new Date(), 'yyyy-MM-dd'),
    newMultiplier: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  const oldMultiplier = currentMultipliers[form.meterIndex] ?? 1;
  const getMeterName = (i: number) =>
    gridMeterNames[i] ?? (gridMeterCount === 1 ? 'Grid Meter' : `Grid Meter ${i + 1}`);

  const submit = async () => {
    const newMult = parseFloat(form.newMultiplier);
    if (!(newMult > 0)) { toast.error('Enter a valid multiplier (must be > 0)'); return; }
    setSaving(true);

    // 1. Update plant_power_config with new multiplier for this meter index
    try {
      const updatedArr = Array.isArray(currentMultipliers) ? [...currentMultipliers] : [];
      while (updatedArr.length <= form.meterIndex) updatedArr.push(1);
      updatedArr[form.meterIndex] = newMult;
      await (supabase.from('plant_power_config' as any) as any).upsert(
        { plant_id: plant.id, grid_meter_multipliers: updatedArr, updated_at: new Date().toISOString() },
        { onConflict: 'plant_id' }
      );
    } catch { /* table may not exist yet */ }

    // 2. Audit row in power_meter_changes (best-effort — table may not exist)
    try {
      await (supabase.from('power_meter_changes' as any) as any).insert({
        plant_id: plant.id,
        meter_index: form.meterIndex,
        change_date: form.changeDate,
        old_multiplier: oldMultiplier,
        new_multiplier: newMult,
        notes: form.notes || null,
        changed_by: user?.id ?? null,
        created_at: new Date().toISOString(),
      });
    } catch { /* ignore if table missing */ }

    // 3. Insert a power_reading at the change date with is_meter_replacement=true
    // so the Δ is zeroed at the rollover — the same mechanism Locator / Well replacement uses.
    try {
      const { data: latestRow } = await (supabase
        .from('power_readings')
        .select('meter_reading_kwh, grid_meter_readings')
        .eq('plant_id', plant.id)
        .order('reading_datetime', { ascending: false })
        .limit(1) as any).maybeSingle();
      if (latestRow) {
        const [y, m, d] = form.changeDate.split('-').map(Number);
        const changeDt  = new Date(y, m - 1, d, 0, 0, 0).toISOString();
        const gmr = (latestRow.grid_meter_readings as Record<string, number> | null) ?? {};
        await supabase.from('power_readings').insert({
          plant_id: plant.id,
          reading_datetime: changeDt,
          meter_reading_kwh: latestRow.meter_reading_kwh ?? 0,
          grid_meter_readings: gmr,
          is_meter_replacement: true,
          recorded_by: user?.id ?? null,
        } as any);
      }
    } catch { /* non-critical — reading row is a convenience, not required */ }

    setSaving(false);
    qc.invalidateQueries({ queryKey: ['plant-power-config', plant.id] });
    qc.invalidateQueries();
    toast.success(
      `${getMeterName(form.meterIndex)}: meter change recorded · multiplier → ×${newMult}`
    );
    onClose();
  };

  const newMultNum = parseFloat(form.newMultiplier);
  const newMultValid = newMultNum > 0;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Wrench className="h-4 w-4 text-teal-600" /> Change Power Meter
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {/* Meter selector — only shown when there are multiple grid meters */}
          {gridMeterCount > 1 && (
            <div className="space-y-1">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Grid Meter
              </Label>
              <Select
                value={String(form.meterIndex)}
                onValueChange={v => setForm(f => ({ ...f, meterIndex: +v }))}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: gridMeterCount }).map((_, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {getMeterName(i)}
                      <span className="ml-2 text-muted-foreground font-mono text-[10px]">
                        ×{currentMultipliers[i] ?? 1}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Change date + new multiplier — side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Change Date
              </Label>
              <Input
                type="date"
                value={form.changeDate}
                onChange={e => setForm(f => ({ ...f, changeDate: e.target.value }))}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                New Multiplier <span className="normal-case font-normal">(CT ratio)</span>
              </Label>
              <Input
                type="number" step="any" min="0.001"
                placeholder={`was ×${oldMultiplier}`}
                value={form.newMultiplier}
                onChange={e => setForm(f => ({ ...f, newMultiplier: e.target.value }))}
                className="h-9"
              />
              <p className="text-[10px] text-muted-foreground">
                Current: <span className="font-mono font-semibold">×{oldMultiplier}</span>
              </p>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Notes <span className="normal-case font-normal">(optional)</span>
            </Label>
            <Input
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="e.g. CT meter replaced, new ratio 40:1"
              className="h-9"
            />
          </div>

          {/* Effect summary — shown only once user types a valid multiplier */}
          {newMultValid && (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-3 text-[11px] text-amber-800 dark:text-amber-300 space-y-1">
              <p className="font-semibold text-[12px]">What happens on save</p>
              <p>
                • <strong>{getMeterName(form.meterIndex)}</strong> multiplier:
                {' '}<span className="font-mono">×{oldMultiplier}</span>
                {' '}→{' '}<span className="font-mono font-semibold text-teal-700 dark:text-teal-400">×{form.newMultiplier}</span>
              </p>
              <p>
                • A replacement reading is created on <strong>{form.changeDate}</strong> — Δ zeroed at rollover
              </p>
              <p>
                • All readings from <strong>{form.changeDate}</strong> onward use the new multiplier
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving} className="h-9">
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={saving || !newMultValid || !form.changeDate}
            className="h-9 bg-teal-700 text-white hover:bg-teal-800"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Record meter change
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── PowerMetersCard ──────────────────────────────────────────────────────────
// Lives in Plant Detail > Power tab.
// Energy sources are now the single source of truth in PlantMeterConfigCard
// (Trains tab). This card reads from usePlantMeterConfig for hasSolar/hasGrid
// and only manages the power meter names / count (solar meters, grid meters).
// The old standalone saveEnergy() path is preserved for back-compat but the
// canonical save is through the unified meter config.

export const POWER_CONFIG_KEY = (plantId: string) => `power_config_${plantId}`;

export function PowerMetersCard({ plant }: { plant: any }) {
  const qc = useQueryClient();
  const { isAdmin, isManager } = useAuth();
  const canEdit = isAdmin || isManager;

  // ── Energy sources — read from unified meter config (Trains tab) ──
  // These toggles are now the canonical home in PlantMeterConfigCard.
  // The Power tab shows them as read-only with a link back.
  const { config: meterConfig } = usePlantMeterConfig(plant.id);
  const hasSolar = meterConfig.has_solar;
  const hasGrid  = meterConfig.has_grid;

  // ── Meter config (names) — still owned here ──
  const { data: savedConfig, isLoading } = useQuery({
    queryKey: ['plant-power-config', plant.id],
    queryFn: async () => {
      try {
        const { data, error } = await (supabase.from('plant_power_config' as any) as any)
          .select('solar_meter_count, solar_meter_names, grid_meter_count, grid_meter_names, grid_meter_multipliers')
          .eq('plant_id', plant.id)
          .maybeSingle();
        if (!error && data) return data as any;
      } catch { /* table may not exist */ }
      try {
        const raw = localStorage.getItem(POWER_CONFIG_KEY(plant.id));
        if (raw) return JSON.parse(raw);
      } catch { /* ignore */ }
      return null;
    },
  });

  const [changeMeterOpen, setChangeMeterOpen] = useState(false);

  const [solarCount, setSolarCount] = useState(1);
  const [gridCount,  setGridCount]  = useState(1);
  // Pad to MAX_METERS so indices beyond the initial 5 always have a default name
  // rather than falling back to the computed `${defaultPrefix} ${i + 1}` string
  // which gets lost whenever savedConfig refetches.
  const MAX_METERS = 20;
  const [solarNames, setSolarNames] = useState<string[]>(
    Array.from({ length: MAX_METERS }, (_, i) => `Solar Meter ${i + 1}`)
  );
  const [gridNames,  setGridNames]  = useState<string[]>(
    Array.from({ length: MAX_METERS }, (_, i) => `Grid Meter ${i + 1}`)
  );
  const [gridMultipliers, setGridMultipliers] = useState<number[]>(
    Array.from({ length: MAX_METERS }, () => 1)
  );
  const [saving, setSaving] = useState(false);

  // Track whether the user has unsaved local edits.
  // When true, background refetches of savedConfig must NOT overwrite local state —
  // that is the root cause of renames reverting to the default name on window focus.
  const isDirty = useRef(false);

  useEffect(() => {
    // Skip if user has pending unsaved changes — otherwise a React Query
    // background refetch (e.g. on window focus) would silently overwrite them.
    if (!savedConfig || isDirty.current) return;
    if (savedConfig.solar_meter_count != null) setSolarCount(savedConfig.solar_meter_count);
    if (savedConfig.grid_meter_count  != null) setGridCount(savedConfig.grid_meter_count);
    if (Array.isArray(savedConfig.solar_meter_names) && savedConfig.solar_meter_names.length) setSolarNames(savedConfig.solar_meter_names);
    if (Array.isArray(savedConfig.grid_meter_names)  && savedConfig.grid_meter_names.length)  setGridNames(savedConfig.grid_meter_names);
    if (Array.isArray(savedConfig.grid_meter_multipliers) && savedConfig.grid_meter_multipliers.length) {
      setGridMultipliers(prev => {
        const next = [...prev];
        (savedConfig.grid_meter_multipliers as number[]).forEach((m, i) => { next[i] = m > 0 ? m : 1; });
        return next;
      });
    }
  }, [savedConfig]);

  const saveConfig = async () => {
    setSaving(true);
    const payload = {
      plant_id: plant.id,
      solar_meter_count: solarCount,
      solar_meter_names: solarNames,
      grid_meter_count:  gridCount,
      grid_meter_names:  gridNames,
      grid_meter_multipliers: gridMultipliers.slice(0, gridCount),
      updated_at: new Date().toISOString(),
    };
    let savedToDb = false;
    try {
      const { error } = await (supabase.from('plant_power_config' as any) as any)
        .upsert(payload, { onConflict: 'plant_id' });
      if (!error) savedToDb = true;
    } catch { /* table missing */ }
    try { localStorage.setItem(POWER_CONFIG_KEY(plant.id), JSON.stringify(payload)); } catch { /* ignore */ }
    setSaving(false);
    // Clear dirty flag BEFORE invalidating so the subsequent useEffect refetch
    // is allowed to re-sync (it will now carry the names we just saved).
    isDirty.current = false;
    qc.invalidateQueries({ queryKey: ['plant-power-config', plant.id] });
    toast.success(savedToDb ? 'Power meter config saved' : 'Power meter config saved (local)');
  };

  if (isLoading) return (
    <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading power config…
    </div>
  );

  return (
    <div className="space-y-3">

      {/* ── Meter Configuration ── */}
      <Card className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-teal-600" />
            <h3 className="font-semibold text-sm">Power meter config</h3>
          </div>
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide bg-muted px-2 py-0.5 rounded">
            {hasSolar && hasGrid ? 'Solar + Grid' : hasSolar ? 'Solar only' : 'Grid only'}
          </span>
        </div>

        <p className="text-xs text-muted-foreground">
          Configure meters per source. Names appear in <strong>Operations → Power</strong>. Energy sources are configured in <strong>Plant Configuration</strong> above.
        </p>

        {/* Meter panels — stacked on mobile, side-by-side on sm+ */}
        <div className={`grid gap-3 ${hasSolar ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>

          {/* Solar meters panel */}
          {hasSolar && (
            <div className="rounded-lg border border-yellow-300/60 bg-yellow-50/40 dark:border-yellow-800/40 dark:bg-yellow-950/10 p-3 space-y-3">
              <div className="flex items-center gap-2">
                <Sun className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
                <span className="text-sm font-semibold">Solar meters</span>
              </div>
              {/* Count stepper */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Count</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => canEdit && setSolarCount(c => Math.max(1, c - 1))}
                    disabled={!canEdit || solarCount <= 1}
                    className="h-7 w-7 rounded-md border bg-background flex items-center justify-center text-sm font-medium hover:bg-muted disabled:opacity-40"
                  >−</button>
                  <span className="w-6 text-center text-sm font-mono font-semibold">{solarCount}</span>
                  <button
                    onClick={() => canEdit && setSolarCount(c => Math.min(20, c + 1))}
                    disabled={!canEdit || solarCount >= 20}
                    className="h-7 w-7 rounded-md border bg-background flex items-center justify-center text-sm font-medium hover:bg-muted disabled:opacity-40"
                  >+</button>
                </div>
              </div>
              {/* Meter name rows */}
              {canEdit && (
                <div className="space-y-1">
                  <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Meter names</p>
                  <MeterNameListRows count={solarCount} names={solarNames} accentColor="yellow" defaultPrefix="Solar Meter"
                    onSave={names => { isDirty.current = true; setSolarNames(names); }}
                    onRemoveLast={() => setSolarCount(c => Math.max(1, c - 1))} />
                </div>
              )}
            </div>
          )}

          {/* Grid meters panel */}
          <div className="rounded-lg border border-blue-300/60 bg-blue-50/40 dark:border-blue-800/40 dark:bg-blue-950/10 p-3 space-y-3">
            <div className="flex items-center gap-2">
              <GridPylonIcon className="h-3.5 w-3.5 text-blue-500 shrink-0" />
              <span className="text-sm font-semibold">Grid meters</span>
            </div>
            {/* Count stepper */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Count</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => canEdit && setGridCount(c => Math.max(1, c - 1))}
                  disabled={!canEdit || gridCount <= 1}
                  className="h-7 w-7 rounded-md border bg-background flex items-center justify-center text-sm font-medium hover:bg-muted disabled:opacity-40"
                >−</button>
                <span className="w-6 text-center text-sm font-mono font-semibold">{gridCount}</span>
                <button
                  onClick={() => canEdit && setGridCount(c => Math.min(20, c + 1))}
                  disabled={!canEdit || gridCount >= 20}
                  className="h-7 w-7 rounded-md border bg-background flex items-center justify-center text-sm font-medium hover:bg-muted disabled:opacity-40"
                >+</button>
              </div>
            </div>
            {/* Meter name + multiplier rows */}
            {canEdit && (
              <div className="space-y-1">
                <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Meter names &amp; multipliers</p>
                <GridMeterListRows
                  count={gridCount}
                  names={gridNames}
                  multipliers={gridMultipliers}
                  onSaveNames={names => { isDirty.current = true; setGridNames(names); }}
                  onSaveMultiplier={(idx, val) => { isDirty.current = true; setGridMultipliers(prev => { const next = [...prev]; next[idx] = val; return next; }); }}
                  onRemoveLast={() => setGridCount(c => Math.max(1, c - 1))}
                />
              </div>
            )}

            {/* Change Meter — manager/admin only; separate from the name/count config */}
            {canEdit && (
              <div className="pt-1 border-t border-blue-200/60 dark:border-blue-800/30">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setChangeMeterOpen(true)}
                  className="w-full gap-1.5 h-8 text-xs border-blue-300/70 text-blue-700 hover:bg-blue-50 hover:border-blue-400 dark:text-blue-400 dark:hover:bg-blue-950/20"
                >
                  <Wrench className="h-3.5 w-3.5" />
                  Change Meter
                </Button>
              </div>
            )}
          </div>
        </div>

        {canEdit ? (
          <Button onClick={saveConfig} disabled={saving} className="w-full h-10 bg-teal-700 text-white hover:bg-teal-800 text-sm">
            {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Save power meter config
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground text-center">Only managers and admins can edit meter configuration.</p>
        )}
      </Card>

      {/* ── Power Consumption & Energy Mix ── */}
      <Card className="p-4">
        <PowerConsumptionEnergyMix plantId={plant.id} hasSolar={hasSolar} hasGrid={hasGrid} />
      </Card>

      {/* Change Meter dialog */}
      {changeMeterOpen && (
        <PowerMeterChangeDialog
          plant={plant}
          gridMeterCount={gridCount}
          gridMeterNames={gridNames}
          currentMultipliers={gridMultipliers}
          onClose={() => {
            setChangeMeterOpen(false);
            // Reload config so multiplier display stays in sync
            qc.invalidateQueries({ queryKey: ['plant-power-config', plant.id] });
          }}
        />
      )}
    </div>
  );
}

