import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useIsMobile } from '@/hooks/use-mobile';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
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

// High-voltage transmission tower icon — matches Plants.tsx grid icon exactly.

import { OdometerRollerInput, MobileCarousel } from '@/components/OdometerRollerInput';
import {
  parseCSVText, triggerTemplateDownload, normalizeDatetime,
  clearDupDecisions, clearBulkDupDecision, ImportReadingsDialog,
} from '@/components/ReadingImportDialog';
import { ReadingHistoryDialog } from '@/components/ReadingHistoryDialog';
import {
  GridPylonIcon, BASE, WELL_MAX_READINGS_PER_DAY, READING_COOLDOWN_MINUTES, SPIKE_MULTIPLIER,
  formatCooldown, invalidateLocatorDash, invalidateWellDash, invalidateDashboard,
  invalidateProductMeterDash, invalidatePowerDash, invalidateRODash, invalidateChemDash,
} from '../shared';
import { fmtSaveToast } from '@/lib/format';

const POWER_SCHEMA = 'plant_name*, meter_reading_kwh*, reading_datetime* (YYYY-MM-DDTHH:mm), solar_meter_reading (optional), solar_input_mode (raw|direct, optional), daily_solar_kwh (optional), daily_grid_kwh (optional)';
const POWER_TEMPLATE_ROW = {
  plant_name: 'Plant A',
  meter_reading_kwh: '12345.6',
  reading_datetime: '2024-06-15T08:30',
  solar_meter_reading: '',
  solar_input_mode: '',
  daily_solar_kwh: '',
  daily_grid_kwh: '',
};

export function validatePowerRow(r: Record<string, string>, i: number): string[] {
  const e: string[] = [];
  if (!r.plant_name?.trim()) e.push(`Row ${i}: plant_name is required`);
  if (!r.meter_reading_kwh?.trim() || isNaN(Number(r.meter_reading_kwh)))
    e.push(`Row ${i}: meter_reading_kwh is required and must be a number`);
  if (!r.reading_datetime?.trim() || isNaN(Date.parse(normalizeDatetime(r.reading_datetime))))
    e.push(`Row ${i}: reading_datetime is required and must be a valid datetime`);
  if (r.solar_meter_reading && isNaN(Number(r.solar_meter_reading)))
    e.push(`Row ${i}: solar_meter_reading must be a number`);
  if (r.solar_input_mode && !['raw', 'direct'].includes(r.solar_input_mode.trim().toLowerCase()))
    e.push(`Row ${i}: solar_input_mode must be "raw" or "direct"`);
  if (r.daily_solar_kwh && isNaN(Number(r.daily_solar_kwh)))
    e.push(`Row ${i}: daily_solar_kwh must be a number`);
  if (r.daily_grid_kwh && isNaN(Number(r.daily_grid_kwh)))
    e.push(`Row ${i}: daily_grid_kwh must be a number`);
  return e;
}

async function insertPowerReadings(
  rows: Record<string, string>[],
  plantId: string,
  userId: string | null,
): Promise<{ count: number; errors: string[] }> {
  // ── 1. Load all plants ────────────────────────────────────────────────────
  const { data: allPlants } = await supabase.from('plants' as any).select('id, name');
  const plantNameToId: Record<string, string> = {};
  const plantIdToName: Record<string, string> = {};
  (allPlants ?? []).forEach((p: any) => {
    plantNameToId[p.name.trim().toLowerCase()] = p.id;
    plantIdToName[p.id] = p.name.trim();
  });

  // ── 2. Pre-load plant_power_config for all plants (grid meter names + multipliers) ──
  // This allows resolving "SRP Grid Meter 1 STP" → plantId for SRP, meterIndex 0.
  // Without this, multi-meter CSV rows all fall back to plantId, overwrite each other,
  // and never write grid_meter_readings, so the history dialog shows no change.
  type PlantPowerCfg = { names: string[]; multipliers: number[] };
  const powerCfgByPlant: Record<string, PlantPowerCfg> = {};
  try {
    const { data: allCfgs } = await (supabase.from('plant_power_config' as any) as any)
      .select('plant_id, grid_meter_names, grid_meter_multipliers');
    (allCfgs ?? []).forEach((c: any) => {
      powerCfgByPlant[c.plant_id] = {
        names:       Array.isArray(c.grid_meter_names)        ? c.grid_meter_names.map(String)  : [],
        multipliers: Array.isArray(c.grid_meter_multipliers)  ? c.grid_meter_multipliers.map(Number) : [],
      };
    });
  } catch { /* table may not exist; single-meter path still works */ }

  const getPerMeterMult = (pid: string, mi: number): number => {
    const cfg = powerCfgByPlant[pid];
    const m = cfg?.multipliers?.[mi];
    return m && m > 0 ? m : 1;
  };

  // ── 3. Resolve each CSV row to { resolvedPlantId, meterIndex } ──────────────
  // Priority:
  //   a) Exact match against plant name → meter 0  (single-meter / legacy path)
  //   b) "${plantName} ${meterName}" composite → the matching plant + meter index
  //   c) Fallback to the UI-selected plantId, meter 0
  type ResolvedRow = { r: Record<string, string>; pid: string; mi: number };
  const resolvedRows: ResolvedRow[] = rows.map(r => {
    const csvName = r.plant_name?.trim() ?? '';
    const csvLower = csvName.toLowerCase();

    // (a) Exact plant name match
    if (plantNameToId[csvLower]) return { r, pid: plantNameToId[csvLower], mi: 0 };

    // (b) Composite "${plantName} ${meterLabel}" match
    for (const [pNameLower, pId] of Object.entries(plantNameToId)) {
      const cfg = powerCfgByPlant[pId];
      if (!cfg?.names?.length) continue;
      for (let idx = 0; idx < cfg.names.length; idx++) {
        if (`${pNameLower} ${cfg.names[idx].toLowerCase()}` === csvLower) {
          return { r, pid: pId, mi: idx };
        }
      }
    }

    // (c) Fallback
    return { r, pid: plantId, mi: 0 };
  });

  // ── 4. Group rows by plantId + calendar-date ─────────────────────────────
  // Rows for the same plant on the same day belong in ONE power_readings row,
  // with each meter's value stored under its index in grid_meter_readings JSONB.
  // Without grouping, the three CSV rows for SRP on 2026-05-01 would hit the
  // same duplicate-decision key and overwrite each other, losing meters 0 and 1.
  type DayGroup = {
    pid: string;
    dt: string;       // ISO UTC string for the DB
    dtDate: string;   // YYYY-MM-DD UTC (dup-check window key)
    meters: Map<number, number>;
    solar?: number;
    dailySolar?: number;
    dailyGrid?: number;
    solarMode?: string;
  };
  const groups = new Map<string, DayGroup>();
  for (const { r, pid, mi } of resolvedRows) {
    const dt = new Date(normalizeDatetime(r.reading_datetime)).toISOString();
    const dtDate = dt.slice(0, 10);
    const key = `${pid}|${dtDate}`;
    if (!groups.has(key)) groups.set(key, { pid, dt, dtDate, meters: new Map() });
    const g = groups.get(key)!;
    g.meters.set(mi, +r.meter_reading_kwh);
    // Solar / grid totals come from whichever row supplies them (typically meter-0)
    if (g.solar     == null && r.solar_meter_reading?.trim()) g.solar     = +r.solar_meter_reading;
    if (g.dailySolar == null && r.daily_solar_kwh?.trim())    g.dailySolar = +r.daily_solar_kwh;
    if (g.dailyGrid  == null && r.daily_grid_kwh?.trim())     g.dailyGrid  = +r.daily_grid_kwh;
    if (!g.solarMode          && r.solar_input_mode?.trim())  g.solarMode  = r.solar_input_mode.trim().toLowerCase();
  }

  // ── 5. Insert or overwrite one DB row per group ──────────────────────────
  let count = 0;
  const errors: string[] = [];

  for (const [key, g] of groups) {
    const { pid: gPid, dt, dtDate, meters } = g;
    const dayStart = `${dtDate}T00:00:00.000Z`;
    const dayEnd   = `${dtDate}T23:59:59.999Z`;

    // Build grid_meter_readings JSONB from all meters in this group
    const gmrObj: Record<string, number> = {};
    for (const [mi, val] of meters) gmrObj[String(mi)] = val;

    const meter0Val = meters.get(0) ?? 0;

    const payload: Record<string, any> = {
      plant_id:          gPid,
      meter_reading_kwh: meter0Val,         // backward compat / meter-0 cumulative
      grid_meter_readings: gmrObj,           // full per-meter JSONB — the key fix
      reading_datetime:  dt,
      recorded_by:       userId,
    };

    // Solar
    const explicitDirect = g.solarMode === 'direct';
    const impliedDirect  = !g.solarMode && g.dailySolar != null;
    const solarMode = (explicitDirect || impliedDirect) ? 'direct' : 'raw';
    if (solarMode === 'direct') {
      const kw = g.dailySolar ?? g.solar;
      if (kw != null) payload.daily_solar_kwh = kw;
    } else {
      if (g.solar      != null) payload.solar_meter_reading = g.solar;
      if (g.dailySolar != null) payload.daily_solar_kwh     = g.dailySolar;
    }
    if (g.dailyGrid != null) payload.daily_grid_kwh = g.dailyGrid;

    // daily_consumption_kwh: sum Δ × per-meter multiplier across all meters in group
    try {
      const { data: prevRows } = await supabase
        .from('power_readings')
        .select('meter_reading_kwh, grid_meter_readings')
        .eq('plant_id', gPid)
        .lt('reading_datetime', dayStart)
        .order('reading_datetime', { ascending: false })
        .limit(1);
      if (prevRows && prevRows.length > 0) {
        const prev = prevRows[0] as any;
        const prevGmr = prev.grid_meter_readings as Record<string, number> | null | undefined;
        let total = 0;
        let allPresent = true;
        for (const [mi, currVal] of meters) {
          const prevVal = prevGmr?.[String(mi)] ?? (mi === 0 ? prev.meter_reading_kwh : null);
          if (prevVal == null) { allPresent = false; continue; }
          const delta = currVal - prevVal;
          if (delta >= 0) total += delta * getPerMeterMult(gPid, mi);
        }
        if (allPresent || meters.size === 1) {
          if (total >= 0) payload.daily_consumption_kwh = total;
        }
      }
    } catch { /* non-critical */ }

    // Duplicate check — one row per plant per calendar day
    const { data: existing } = await supabase.from('power_readings')
      .select('id').eq('plant_id', gPid)
      .gte('reading_datetime', dayStart)
      .lte('reading_datetime', dayEnd).limit(1);

    const doInsert = async () => {
      const { error } = await supabase.from('power_readings').insert(payload);
      if (error) {
        if (error.message.includes('daily_solar_kwh') || error.message.includes('daily_grid_kwh') ||
            error.message.includes('solar_meter_reading') || error.message.includes('grid_meter_readings')) {
          const { daily_solar_kwh: _s, daily_grid_kwh: _g, solar_meter_reading: _sm, grid_meter_readings: _gmr, ...fb } = payload as any;
          const { error: e2 } = await supabase.from('power_readings').insert(fb);
          if (e2) errors.push(e2.message); else count++;
        } else { errors.push(error.message); }
      } else { count++; }
    };

    if (existing && existing.length > 0) {
      const plantLabel = plantIdToName[gPid] ?? gPid;
      const decision = await resolveImportDuplicate(key, `${plantLabel} @ ${dtDate}`, true);
      if (decision === 'skip') continue;
      // Merge: keep existing meter readings for indices NOT present in this CSV import,
      // so uploading a partial CSV (e.g. only meter-0) doesn't zero out meters 1 and 2.
      let mergedGmr = gmrObj;
      try {
        const { data: existRow } = await supabase.from('power_readings')
          .select('grid_meter_readings').eq('id', existing[0].id).maybeSingle();
        const existGmr = (existRow?.grid_meter_readings as Record<string, number> | null) ?? {};
        mergedGmr = { ...existGmr, ...gmrObj }; // CSV values win; existing secondary meters preserved
      } catch { /* use gmrObj as-is */ }
      payload.grid_meter_readings = mergedGmr;

      const { error } = await supabase.from('power_readings').update(payload).eq('id', existing[0].id);
      if (error) {
        if (error.message.includes('daily_solar_kwh') || error.message.includes('daily_grid_kwh') ||
            error.message.includes('solar_meter_reading') || error.message.includes('grid_meter_readings')) {
          const { daily_solar_kwh: _s, daily_grid_kwh: _g, solar_meter_reading: _sm, grid_meter_readings: _gmr, ...fb } = payload as any;
          const { error: e2 } = await supabase.from('power_readings').update(fb).eq('id', existing[0].id);
          if (e2) errors.push(e2.message); else count++;
        } else { errors.push(error.message); }
      } else { count++; }
    } else {
      await doInsert();
    }
  }
  return { count, errors };
}

export function PowerForm() {
  const qc = useQueryClient();
  const { user, isAdmin, isManager, isDataAnalyst } = useAuth();
  const { data: plants } = usePlants();
  const [plantId, setPlantId]         = useState('');
  // When showSolar: `reading` = grid meter reading, `solarReading` = solar meter reading
  // When !showSolar: `reading` = combined meter reading
  const [reading, setReading]         = useState('');
  const [solarReading, setSolarReading] = useState('');
  const [dt, setDt]                   = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [powerHistoryOpen, setPowerHistoryOpen] = useState<{ type: 'solar'; idx: number } | { type: 'grid'; idx: number } | null>(null);
  const [importOpen, setImportOpen]   = useState(false);
  // Multiplier: auto-populated from latest saved electric bill; editable by admin only when no bill exists
  const [multiplierInput, setMultiplierInput] = useState('');
  // Per-meter reading inputs: indexed arrays (index 0 = meter 1, etc.)
  const [gridMeterReadings, setGridMeterReadings]   = useState<string[]>(['', '', '', '', '']);
  const [solarMeterReadings, setSolarMeterReadings] = useState<string[]>(['', '', '', '', '']);

  const setGridMeterReading = (idx: number, val: string) =>
    setGridMeterReadings(prev => { const next = [...prev]; next[idx] = val; return next; });
  const setSolarMeterReading = (idx: number, val: string) =>
    setSolarMeterReadings(prev => { const next = [...prev]; next[idx] = val; return next; });
  // 'raw'    = user enters cumulative kWh meter reading; Δ auto-computed from prev
  // 'direct' = user enters daily kWh directly; stored straight as daily_solar_kwh
  const [solarInputMode, setSolarInputMode] = useState<'raw' | 'direct'>('raw');
  const isMobile = useIsMobile();

  const plant     = useMemo(() => plants?.find((p) => p.id === plantId), [plants, plantId]);
  const showSolar = !!plant?.has_solar;
  const showGrid  = plant?.has_grid !== false;

  // Load meter config from plant_power_config (set in Plant → Power tab)
  const { data: powerConfig, isLoading: configLoading } = useQuery({
    queryKey: ['plant-power-config', plantId],
    queryFn: async () => {
      if (!plantId) return null;
      try {
        const { data, error } = await (supabase.from('plant_power_config' as any) as any)
          .select('solar_meter_count, solar_meter_names, grid_meter_count, grid_meter_names, grid_meter_multipliers')
          .eq('plant_id', plantId).maybeSingle();
        if (!error && data) return data as any;
      } catch { /* table may not exist */ }
      try {
        const raw = localStorage.getItem(`power_config_${plantId}`);
        if (raw) return JSON.parse(raw);
      } catch { /* ignore */ }
      return null;
    },
    enabled: !!plantId,
  });

  // Load plant meter config to get default_solar_input_mode (set in Plants → Energy Sources)
  const { data: meterConfig } = useQuery({
    queryKey: ['plant-meter-config', plantId],
    queryFn: async () => {
      if (!plantId) return null;
      try {
        const { data, error } = await (supabase.from('plant_meter_config' as any) as any)
          .select('config').eq('plant_id', plantId).maybeSingle();
        if (!error && data?.config) return data.config as any;
      } catch { /* table may not exist */ }
      try {
        const raw = localStorage.getItem(`plant_meter_config_${plantId}`);
        if (raw) return JSON.parse(raw);
      } catch { /* ignore */ }
      return null;
    },
    enabled: !!plantId,
  });

  // When plant changes, sync solarInputMode to the plant's configured default
  useEffect(() => {
    const mode = meterConfig?.default_solar_input_mode;
    if (mode === 'direct' || mode === 'raw') setSolarInputMode(mode);
    else setSolarInputMode('raw');
  }, [plantId, meterConfig?.default_solar_input_mode]);

  const solarMeterCount = (powerConfig?.solar_meter_count as number) ?? 1;
  const gridMeterCount  = (powerConfig?.grid_meter_count  as number) ?? 1;
  const solarMeterNames: string[] = powerConfig?.solar_meter_names ?? [];
  const gridMeterNames:  string[] = powerConfig?.grid_meter_names  ?? [];

  const getSolarLabel = (idx: number) => solarMeterNames[idx] ?? (solarMeterCount === 1 ? 'Solar Power Reading' : `Solar Meter ${idx + 1}`);
  const getGridLabel  = (idx: number) => gridMeterNames[idx]  ?? (gridMeterCount  === 1 ? 'Grid Power Reading'  : `Grid Meter ${idx + 1}`);

  // Flat list of all meters for MobileCarousel: grid first, then solar
  const powerMeterItems = useMemo<Array<{ type: 'grid' | 'solar'; idx: number }>>(() => {
    const items: Array<{ type: 'grid' | 'solar'; idx: number }> = [];
    for (let i = 0; i < gridMeterCount; i++) items.push({ type: 'grid', idx: i });
    if (showSolar) for (let i = 0; i < solarMeterCount; i++) items.push({ type: 'solar', idx: i });
    return items;
  }, [gridMeterCount, solarMeterCount, showSolar]);

  // Derive CT multiplier from plant_power_config (Plants → Power tab).
  // This is the single source of truth — billing multiplier is for cost accounting only.
  const configMultiplierArr = powerConfig?.grid_meter_multipliers;

  // Per-meter helper: returns the configured multiplier for a given grid meter index,
  // falling back to 1 when the array is absent or the entry is missing/zero.
  const getGridMeterMult = (idx: number): number =>
    Array.isArray(configMultiplierArr) && +configMultiplierArr[idx] > 0
      ? +configMultiplierArr[idx]
      : 1;

  // configMultiplier (meter-0) kept for backward-compat with save helpers and
  // legacy single-meter paths that still reference effectiveMultiplier.
  const configMultiplier: number | null =
    Array.isArray(configMultiplierArr) && configMultiplierArr.length > 0 && +configMultiplierArr[0] > 0
      ? +configMultiplierArr[0]
      : null;
  // canEditMultiplier: Managers, Data Analysts and Admins can update CT multiplier in config
  const canEditMultiplier = (isAdmin || isManager || isDataAnalyst) && !!plantId && !configLoading;
  // Effective multiplier (meter-0): config value takes priority, else user's local input, else 1.
  // Used as fallback for single-meter plants and legacy display paths.
  const effectiveMultiplier = configMultiplier ?? (+multiplierInput || 1);

  // Save multiplier edit back to plant_power_config so all pages stay in sync
  const saveMultiplierToConfig = async (val: number) => {
    if (!plantId || !(isAdmin || isManager || isDataAnalyst)) return;
    try {
      const existingArr = Array.isArray(configMultiplierArr) ? [...configMultiplierArr] : [];
      existingArr[0] = val;
      await (supabase.from('plant_power_config' as any) as any)
        .upsert(
          { plant_id: plantId, grid_meter_multipliers: existingArr, updated_at: new Date().toISOString() },
          { onConflict: 'plant_id' }
        );
      qc.invalidateQueries({ queryKey: ['plant-power-config', plantId] });
    } catch { /* non-critical */ }
  };

  // Auto-reset manual input when plant changes.
  // useCallback gives a stable reference so PlantSelector's useEffect does NOT
  // re-fire on every render. An inline arrow here would be a new reference each
  // render → picker calls onChange(selectedPlantId) every cycle → error #300.
  const handlePlantChange = useCallback((v: string) => {
    setPlantId(v);
    setEditingId(null);
    setMultiplierInput('');
    // Clear all meter inputs — the pre-fill useEffects will re-populate from
    // the new plant's prevRow once the history query settles.
    setReading('');
    setSolarReading('');
    setGridMeterReadings(['', '', '', '', '']);
    setSolarMeterReadings(['', '', '', '', '']);
  }, []);

  const { data: history } = useQuery({
    queryKey: ['op-power', plantId],
    queryFn: async () => {
      if (!plantId) return [];
      // First try with all optional columns
      const { data, error } = await supabase
        .from('power_readings')
        .select('id,plant_id,reading_datetime,meter_reading_kwh,grid_meter_readings,daily_consumption_kwh,daily_solar_kwh,daily_grid_kwh,solar_meter_reading,is_meter_replacement,recorded_by')
        .eq('plant_id', plantId)
        .order('reading_datetime', { ascending: false })
        .limit(8);
      if (!error && data) return data;
      // Optional columns not yet in DB — retry with base columns only
      const { data: fallback, error: fallbackErr } = await supabase
        .from('power_readings')
        .select('id,plant_id,reading_datetime,meter_reading_kwh,daily_consumption_kwh,is_meter_replacement,recorded_by')
        .eq('plant_id', plantId)
        .order('reading_datetime', { ascending: false })
        .limit(8);
      if (!fallbackErr && fallback) return fallback;
      // Last resort: absolute minimum columns
      const { data: minimal } = await supabase
        .from('power_readings')
        .select('id,plant_id,reading_datetime,meter_reading_kwh')
        .eq('plant_id', plantId)
        .order('reading_datetime', { ascending: false })
        .limit(8);
      return minimal ?? [];
    },
    enabled: !!plantId,
    staleTime: 0,
  });

  // The most recent prior reading (skip the one being edited)
  const prevRow    = history?.find((r: any) => r.id !== editingId) ?? null;
  // Combined/grid meter: previous meter_reading_kwh
  const prevGrid   = prevRow?.meter_reading_kwh ?? null;
  // Solar meter: previous solar_meter_reading (if tracked)
  const prevSolar  = prevRow?.solar_meter_reading ?? null;

  // ── Pre-fill grid meter inputs from the most recent previous reading ──────
  // Fires when prevRow identity changes (new row became "latest" after a save
  // or plant change). Uses prevRow?.id as dep to avoid infinite loops — the
  // effect only re-runs when the actual record changes, not on every render.
  useEffect(() => {
    if (!prevRow) return;
    const gmrPrev = (prevRow as any)?.grid_meter_readings as Record<string, number> | null | undefined;
    setGridMeterReadings(curr =>
      curr.map((val, idx) => {
        if (val !== '') return val; // user has already typed something — don't overwrite
        const prevVal = gmrPrev?.[String(idx)] ?? (idx === 0 ? prevGrid : null);
        return prevVal != null ? prevVal.toFixed(2) : val;
      }),
    );
    // Keep the meter-0 alias in sync
    setReading(r => {
      if (r !== '') return r;
      return prevGrid != null ? prevGrid.toFixed(2) : r;
    });
  }, [prevRow?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pre-fill solar meter inputs (raw mode only) ────────────────────────────
  useEffect(() => {
    if (!prevRow || solarInputMode !== 'raw') return;
    setSolarMeterReadings(curr =>
      curr.map((val, idx) => {
        if (val !== '') return val;
        if (idx === 0 && prevSolar != null) return prevSolar.toFixed(2);
        return val;
      }),
    );
    setSolarReading(r => {
      if (r !== '') return r;
      return prevSolar != null ? prevSolar.toFixed(2) : r;
    });
  }, [prevRow?.id, solarInputMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Delta calculations from meter readings
  const deltaGrid  = prevGrid != null && reading       ? +reading       - prevGrid  : null;
  // Raw mode: delta = current - prev cumulative reading
  // Direct mode: the entered value IS the daily kWh — no subtraction, no prevSolar needed
  const deltaSolar = solarInputMode === 'direct'
    ? (solarReading ? +solarReading : null)
    : (prevSolar != null && solarReading ? +solarReading  - prevSolar : null);
  // For combined (no solar): just use the main meter delta
  const daily      = showSolar ? deltaGrid : (prevGrid != null && reading ? +reading - prevGrid : null);
  // Effective daily kWh = Δ reading × multiplier
  const dailyEffective = daily != null ? daily * effectiveMultiplier : null;

  // Per-meter saving state
  const [savingMeter, setSavingMeter] = useState<string | null>(null);

  // Save a single meter reading independently
  const submitMeter = async (kind: 'solar' | 'grid', idx: number) => {
    if (!plantId) return;
    // Guard: block grid saves when the CT-multiplier config is unavailable.
    //
    // Two failure modes are handled here:
    //   1. configLoading === true  → query is still in-flight; effectiveMultiplier
    //      would use the local-input fallback (or 1) instead of the DB value.
    //   2. configLoading === false but configMultiplierArr is null / empty → the
    //      query settled without a usable multiplier (no plant_power_config row, or
    //      grid_meter_multipliers is null/[]). effectiveMultiplier falls back to
    //      (+multiplierInput || 1) which stores the raw delta instead of (delta × CT).
    //
    // Previously only case 1 was caught, so readings saved when the config had no
    // row would silently store the raw meter delta as daily_grid_kwh, causing the
    // Dashboard chart to display the unscaled value (e.g. 11 kWh) while the history
    // table (which recomputes rawDelta × configMult on-the-fly) showed the correct
    // scaled value (e.g. 12,720 kWh). Now both cases are blocked explicitly.
    if (kind === 'grid') {
      if (configLoading) {
        toast.error('Meter config still loading — please wait a moment before saving.');
        return;
      }
      if (!Array.isArray(configMultiplierArr) || configMultiplierArr.length === 0) {
        toast.error(
          'CT multiplier not configured for this plant. ' +
          'Set it under Plants → Power → CT Multiplier before saving grid readings, ' +
          'or enter it manually in the multiplier field above.',
        );
        return;
      }
    }
    const meterKey = `${kind}-${idx}`;
    const val = kind === 'solar' ? (solarMeterReadings[idx] ?? '') : (gridMeterReadings[idx] ?? '');
    if (!val) { toast.error(`Enter a reading for ${kind === 'solar' ? getSolarLabel(idx) : getGridLabel(idx)}`); return; }

    setSavingMeter(meterKey);

    // FIX (multi-meter collision): use a local `rowId` so we can resolve an existing
    // today-row and immediately proceed to save — no second click required.
    // The old pattern (setEditingId + early return) meant meter-2 would switch to
    // edit mode on click-1 and then OVERWRITE meter_reading_kwh on click-2, clobbering
    // whatever meter-1 had saved.  Now we fall through and merge into the existing row.
    let rowId: string | null = editingId;

    if (kind === 'grid' && !rowId) {
      const dup = await findExistingReading({
        table: 'power_readings', entityCol: 'plant_id', entityId: plantId,
        datetime: new Date(dt), windowKind: 'day',
      });
      if (dup) {
        rowId = dup;
        setEditingId(dup);
        // Don't return — fall through and patch only this meter's key in the existing row.
        toast.info(`Today's power reading found — saving ${getGridLabel(idx)} into existing row.`);
      }
    }

    // Compute deltas for the primary meter only.
    // BUG A FIX: removed the `showSolar &&` guard — computedDailyGrid must be
    // computed for grid-only plants too.  Previously it was always null when
    // showSolar === false, so the else-if partial path (below) never wrote
    // daily_grid_kwh and the Plants chart read the raw unscaled delta from
    // daily_consumption_kwh instead of the CT-multiplied effective kWh.
    const computedDailyGrid  = kind === 'grid'  && idx === 0 && deltaGrid  != null ? deltaGrid  * effectiveMultiplier : null;
    // In raw mode: delta is computed from prevSolar vs current solar meter reading
    // In direct mode: the user IS entering the delta — no prev needed, don't use deltaSolar
    const computedDailySolar = kind === 'solar' && idx === 0 && showSolar && solarInputMode === 'raw' && deltaSolar != null ? deltaSolar : null;

    const payload: any = {
      plant_id: plantId,
      reading_datetime: new Date(dt).toISOString(),
      recorded_by: user?.id,
    };

    if (kind === 'grid') {
      // ── JSONB merge: read the existing grid_meter_readings so we only patch this
      // meter's key, leaving all other meters' readings intact.
      let mergedGridReadings: Record<string, number> = { [String(idx)]: +val };
      if (rowId) {
        try {
          const { data: existingRow } = await supabase
            .from('power_readings')
            .select('grid_meter_readings')
            .eq('id', rowId)
            .maybeSingle();
          const existing = (existingRow?.grid_meter_readings as Record<string, number> | null) ?? {};
          mergedGridReadings = { ...existing, [String(idx)]: +val };
        } catch { /* non-critical — proceed with single-key payload */ }
      }
      payload.grid_meter_readings = mergedGridReadings;

      // meter_reading_kwh: kept for backward compatibility with dashboards, CSV importer,
      // cost pages, and trend charts that still read this column.
      // Only update it for meter 0; secondary meters live only in grid_meter_readings.
      if (idx === 0) payload.meter_reading_kwh = +val;

      // Compute daily_grid_kwh as the sum of (Δ per meter × per-meter CT multiplier).
      // Previous per-meter readings come from prevRow.grid_meter_readings; for legacy
      // rows that pre-date this migration, fall back to meter_reading_kwh as meter-0.
      const prevMeters: Record<string, number> = (() => {
        const gmr = (prevRow as any)?.grid_meter_readings as Record<string, number> | null | undefined;
        if (gmr && Object.keys(gmr).length > 0) return gmr;
        return prevGrid != null ? { '0': prevGrid } : {};
      })();

      let totalDailyGrid = 0;
      let allMetersPresent = true;
      for (let mi = 0; mi < gridMeterCount; mi++) {
        const curr = mergedGridReadings[String(mi)];
        const prev = prevMeters[String(mi)];
        if (curr != null && prev != null) {
          const mMult = Array.isArray(configMultiplierArr) && +configMultiplierArr[mi] > 0
            ? +configMultiplierArr[mi]
            : effectiveMultiplier;
          totalDailyGrid += (curr - prev) * mMult;
        } else {
          allMetersPresent = false;
        }
      }
      if (allMetersPresent) {
        payload.daily_grid_kwh       = totalDailyGrid;
        payload.daily_consumption_kwh = totalDailyGrid;
      } else if (idx === 0 && deltaGrid != null) {
        // Partial data: only meter-0 is available — write a partial estimate so the
        // dashboard doesn't show an empty bar until all meters are saved.
        // BUG B FIX: always set daily_grid_kwh here, not just when computedDailyGrid
        // is non-null.  With Bug A fixed, computedDailyGrid is now always non-null
        // when deltaGrid != null, so this path now correctly writes the CT-scaled
        // value for both solar+grid AND grid-only plants.
        const partialKwh = computedDailyGrid ?? deltaGrid * effectiveMultiplier;
        payload.daily_grid_kwh        = partialKwh;
        payload.daily_consumption_kwh = partialKwh;
      }
    }
    if (kind === 'solar') {
      // Only include meter_reading_kwh from grid if the user has actually entered one —
      // writing 0 would corrupt the cumulative grid meter sequence.
      const gridVal = gridMeterReadings[0];
      if (gridVal && +gridVal > 0) payload.meter_reading_kwh = +gridVal;
      if (solarInputMode === 'direct') {
        // Direct daily kWh: store only daily_solar_kwh, do NOT touch solar_meter_reading
        // (writing a raw meter value would corrupt the cumulative sequence)
        payload.daily_solar_kwh = +val;
      } else {
        // Raw cumulative meter: store solar_meter_reading and auto-compute daily_solar_kwh
        payload.solar_meter_reading = +val;
        // Only attach daily_solar_kwh when delta is actually computable (prev exists)
        if (idx === 0 && computedDailySolar != null) payload.daily_solar_kwh = computedDailySolar;
      }
    }

    const runQuery = () => rowId
      ? supabase.from('power_readings').update(payload).eq('id', rowId)
      : supabase.from('power_readings').insert(payload);

    let { error } = await runQuery();
    if (error && (
      error.message.includes('daily_solar_kwh') ||
      error.message.includes('daily_grid_kwh') ||
      error.message.includes('solar_meter_reading') ||
      error.message.includes('multiplier') ||
      error.message.includes('grid_meter_readings')
    )) {
      // Column may not exist yet in older DBs — retry without optional columns
      delete payload.daily_solar_kwh;
      delete payload.daily_grid_kwh;
      delete payload.solar_meter_reading;
      delete payload.multiplier;
      delete payload.grid_meter_readings;
      ({ error } = await runQuery());
    }

    setSavingMeter(null);
    if (error) { toast.error(error.message); return; }

    const label = kind === 'solar' ? getSolarLabel(idx) : getGridLabel(idx);
    toast.success(`${label}: reading saved`);

    // Clear only the saved meter's input
    if (kind === 'grid') {
      setGridMeterReadings(prev => { const next = [...prev]; next[idx] = ''; return next; });
      if (idx === 0) setReading('');
    } else {
      setSolarMeterReadings(prev => { const next = [...prev]; next[idx] = ''; return next; });
      if (idx === 0) setSolarReading('');
    }
    invalidatePowerDash(qc);
  };

  // Keep legacy submit for cancel/edit flows
  const submit = async () => {
    if (!plantId || !reading) return;
    // Guard: same race-condition protection as submitMeter
    if (configLoading) {
      toast.error('Meter config still loading — please wait a moment before saving.');
      return;
    }
    // BUG A (legacy submit): same fix as submitMeter — remove showSolar guard so
    // grid-only plants correctly persist the CT-scaled daily_grid_kwh.
    const computedDailyGrid  = deltaGrid  != null ? deltaGrid * effectiveMultiplier : null;
    const computedDailySolar = showSolar && deltaSolar != null ? deltaSolar : null;
    const payload: any = {
      plant_id: plantId,
      reading_datetime: new Date(dt).toISOString(),
      meter_reading_kwh: +reading,
      // Keep grid_meter_readings in sync so history delta calculations stay correct.
      // For edit flows we fetch existing secondary-meter data and merge, to avoid
      // clobbering meters 1+ that were saved via the per-meter Save buttons.
      recorded_by: user?.id,
    };
    // Merge grid_meter_readings: preserve secondary meters if editing an existing row.
    if (editingId) {
      try {
        const { data: existingRow } = await supabase
          .from('power_readings')
          .select('grid_meter_readings')
          .eq('id', editingId)
          .maybeSingle();
        const existing = (existingRow?.grid_meter_readings as Record<string, number> | null) ?? {};
        payload.grid_meter_readings = { ...existing, '0': +reading };
      } catch {
        payload.grid_meter_readings = { '0': +reading };
      }
    } else {
      payload.grid_meter_readings = { '0': +reading };
    }
    if (showSolar && solarReading) payload.solar_meter_reading = +solarReading;
    // Write daily_grid_kwh for ALL plants (not just solar+grid) — fixes Plants chart
    // discrepancy where grid-only readings showed raw delta instead of CT-scaled kWh.
    if (computedDailyGrid  != null) payload.daily_grid_kwh  = computedDailyGrid;
    if (showSolar && computedDailySolar != null) payload.daily_solar_kwh = computedDailySolar;
    // Bug 3 fix: always write daily_consumption_kwh so Dashboard kWh total and PV ratio are correct
    if (daily != null) payload.daily_consumption_kwh = daily * effectiveMultiplier;
    const runQuery = () => editingId
      ? supabase.from('power_readings').update(payload).eq('id', editingId)
      : supabase.from('power_readings').insert(payload);
    let { error } = await runQuery();
    if (error && (
      error.message.includes('daily_solar_kwh') ||
      error.message.includes('daily_grid_kwh') ||
      error.message.includes('solar_meter_reading') ||
      error.message.includes('multiplier')
    )) {
      delete payload.daily_solar_kwh; delete payload.daily_grid_kwh;
      delete payload.solar_meter_reading; delete payload.multiplier;
      ({ error } = await runQuery());
    }
    if (error) { toast.error(error.message); return; }
    toast.success(editingId ? 'Updated' : 'Power reading saved');
    setReading(''); setSolarReading(''); setEditingId(null);
    setGridMeterReadings(['', '', '', '', '']);
    setSolarMeterReadings(['', '', '', '', '']);
    invalidatePowerDash(qc);
  };

  const startEdit = (r: any) => {
    setReading(String(r.meter_reading_kwh));
    setSolarReading(r.solar_meter_reading != null ? String(r.solar_meter_reading) : '');
    // Restore per-meter grid readings from grid_meter_readings JSONB.
    // Falls back to meter_reading_kwh for legacy rows that pre-date the migration.
    const gmr = (r.grid_meter_readings as Record<string, number> | null) ?? {};
    setGridMeterReadings(prev => {
      const next = prev.map(() => '');
      next[0] = gmr['0'] != null ? String(gmr['0']) : String(r.meter_reading_kwh);
      for (let i = 1; i < prev.length; i++) {
        if (gmr[String(i)] != null) next[i] = String(gmr[String(i)]);
      }
      return next;
    });
    setSolarMeterReadings(prev => { const next = [...prev]; next[0] = r.solar_meter_reading != null ? String(r.solar_meter_reading) : ''; return next; });
    setDt(format(new Date(r.reading_datetime), "yyyy-MM-dd'T'HH:mm"));
    setEditingId(r.id);
    toast.info('Editing power reading');
  };

  // Build display rows: compute Δ on the fly by pairing consecutive readings
  const displayHistory = useMemo(() => {
    if (!history?.length) return [];
    return history.map((r: any, i: number) => {
      const pred          = history[i + 1] ?? null; // predecessor = row below (older), history is DESC
      // Grid meter Δ — for multi-meter plants, sum deltas across all meters using
      // grid_meter_readings JSONB.  Falls back to single meter_reading_kwh for legacy rows.
      const deltaKwh = (() => {
        const rGmr = r.grid_meter_readings    as Record<string, number> | null | undefined;
        const pGmr = pred?.grid_meter_readings as Record<string, number> | null | undefined;
        if (rGmr && pGmr && Object.keys(rGmr).length > 1) {
          let total = 0;
          for (const k of Object.keys(rGmr)) {
            if (pGmr[k] != null) total += rGmr[k] - pGmr[k];
          }
          return total;
        }
        return pred != null ? r.meter_reading_kwh - pred.meter_reading_kwh : (r.daily_consumption_kwh ?? null);
      })();
      // Solar meter Δ
      const deltaSolarKwh = (pred?.solar_meter_reading != null && r.solar_meter_reading != null)
        ? r.solar_meter_reading - pred.solar_meter_reading
        : (r.daily_solar_kwh ?? null);
      // Grid consumption = grid meter Δ × CT multiplier
      const deltaGridKwh  = showSolar && deltaKwh != null
        ? deltaKwh * effectiveMultiplier
        : (r.daily_grid_kwh != null ? r.daily_grid_kwh : deltaKwh);
      return { ...r, _deltaKwh: deltaKwh, _deltaSolar: deltaSolarKwh, _deltaGrid: deltaGridKwh };
    });
  }, [history, showSolar, effectiveMultiplier]);

  return (
    <div className="space-y-3">
      <Card className="p-4 space-y-4">
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Plant</Label>
            <PlantSelector value={plantId} onChange={handlePlantChange} />
          </div>
          {(isAdmin || isManager || isDataAnalyst) && plantId && (
            <Button
              size="sm" variant="outline"
              className="shrink-0 gap-1.5 h-10 border-teal-600/60 text-teal-700 hover:bg-teal-50 hover:border-teal-600 dark:hover:bg-teal-950/30"
              onClick={() => setImportOpen(true)}
              data-testid="import-power-readings-btn"
            >
              <Upload className="h-3.5 w-3.5" />
              Import
            </Button>
          )}
        </div>

        {/* ── Meter config hint ── */}
        {plantId && (
          <p className="text-[11px] text-muted-foreground">
            Meter count &amp; names are configured in <strong className="text-foreground/70">Plants → Power</strong>.
          </p>
        )}

        {/* Meter Reading(s) + Grid Power Multiplier — shown inline with Date & Time */}
        {showSolar ? (
          // ── Solar plant ────────────────────────────────────────────────────────
          <div className="space-y-3">

            {/* Date & Time — CT multipliers are now shown per-meter inline with each grid meter label */}
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label>Date &amp; Time</Label>
                <Input type="datetime-local" value={dt} onChange={e => setDt(e.target.value)}
                  className="h-10 w-full max-w-[260px] min-w-[220px] block text-center sm:text-left bg-muted/30 border-border/70 text-foreground/80" />
              </div>
            </div>

            {/* ── 2-column layout: Solar (left) | Grid (right) — desktop only ── */}
            {!isMobile && <div className="grid grid-cols-2 gap-4 items-start">

              {/* ── Solar column ── */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 pb-1 border-b border-yellow-200 dark:border-yellow-800/40">
                  <span className="text-yellow-500 text-sm leading-none">☀</span>
                  <span className="text-xs font-semibold text-yellow-700 dark:text-yellow-400 uppercase tracking-wide">Solar</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">{solarMeterCount} meter{solarMeterCount !== 1 ? 's' : ''}</span>
                </div>
                {Array.from({ length: solarMeterCount }).map((_, idx) => {
                  const meterLabel = getSolarLabel(idx);
                  const val = solarMeterReadings[idx] ?? '';
                  const isFirst = idx === 0;
                  const handleChange = (v: string) => {
                    setSolarMeterReading(idx, v);
                    if (isFirst) setSolarReading(v);
                  };
                  const meterKey = `solar-${idx}`;
                  const isSavingThis = savingMeter === meterKey;
                  // In raw mode the pre-filled baseline equals prevSolar — disable Save until
                  // the operator has actually rolled/typed a different value.
                  const solarPrevVal = idx === 0 ? prevSolar : null;
                  const solarMeterChanged = val !== '' && (
                    solarInputMode === 'direct' || solarPrevVal == null || +val !== solarPrevVal
                  );
                  return (
                    <div key={`solar-${idx}`}>
                      <Label className="flex items-center gap-1 text-xs">
                        <span className="text-yellow-400 text-[10px]">☀</span>
                        {meterLabel}
                        {isFirst && editingId && <span className="text-[10px] text-amber-600 ml-1">(editing)</span>}
                        {(isAdmin || isManager || isDataAnalyst) && (
                          <button
                            type="button"
                            title={`View ${meterLabel} history`}
                            onClick={() => setPowerHistoryOpen({ type: 'solar', idx })}
                            className="ml-auto p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          >
                            <History className="h-3 w-3" />
                          </button>
                        )}
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input type="number" step="any" value={val}
                          onChange={e => handleChange(e.target.value)}
                          placeholder={solarInputMode === 'direct' ? 'Daily kWh' : 'Solar reading'}
                          className="border-yellow-300 focus-visible:ring-yellow-300"
                          data-testid={`power-solar-input-${idx}`} />
                        <Button size="sm" disabled={isSavingThis || !solarMeterChanged}
                          onClick={() => submitMeter('solar', idx)}
                          className="shrink-0 h-9 px-3 text-xs bg-teal-700 text-white hover:bg-teal-800"
                          data-testid={`power-solar-save-${idx}`}>
                          {isSavingThis ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                        </Button>
                      </div>
                      {/* Input mode hint — shown below input to align with grid's prev reading */}
                      {isFirst && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          Mode: <span className="font-medium text-yellow-600 dark:text-yellow-400">
                            {solarInputMode === 'direct' ? 'Direct kWh' : 'Raw Meter'}
                          </span>
                          <span className="opacity-60 ml-1">(configure in Plants → Energy Sources)</span>
                        </p>
                      )}
                      {/* Hint line: raw mode shows prev + computed Δ; direct mode previews stored value */}
                      {isFirst && solarInputMode === 'raw' && prevSolar != null && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          prev: <span className="font-mono-num">{fmtNum(prevSolar)}</span>
                          {val && deltaSolar != null && (
                            <span className={`font-mono-num font-medium ml-1 ${deltaSolar >= 0 ? 'text-yellow-600' : 'text-destructive'}`}>
                              Δ {fmtNum(deltaSolar)} kWh
                            </span>
                          )}
                          {val && prevSolar != null && deltaSolar == null && (
                            <span className="ml-1 text-muted-foreground/60">(enter value to compute Δ)</span>
                          )}
                        </p>
                      )}
                      {isFirst && solarInputMode === 'raw' && prevSolar == null && val && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          No previous solar reading — Δ will be available after next entry.
                        </p>
                      )}
                      {isFirst && solarInputMode === 'direct' && val && (
                        <p className="text-[10px] text-yellow-600 dark:text-yellow-400 font-mono-num mt-0.5">
                          → {fmtNum(+val)} kWh will be saved as daily production
                        </p>
                      )}
                    </div>
                  );
                })}

                {/* Total Δ row — only meaningful in raw mode */}
                {solarInputMode === 'raw' && deltaSolar != null && solarMeterCount > 1 && (
                  <div className="rounded border border-yellow-200 bg-yellow-50/60 dark:border-yellow-800/30 dark:bg-yellow-950/10 px-2 py-1 text-[11px] flex items-center gap-1.5 mt-1">
                    <span className="text-yellow-500">☀</span>
                    <span className="text-muted-foreground">Total Δ</span>
                    <span className={`font-mono-num font-semibold ml-auto ${deltaSolar >= 0 ? 'text-yellow-700 dark:text-yellow-400' : 'text-destructive'}`}>
                      {fmtNum(deltaSolar)} kWh
                    </span>
                  </div>
                )}
              </div>

              {/* ── Grid column ── */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 pb-1 border-b border-blue-200 dark:border-blue-800/40">
                  <GridPylonIcon className="h-3 w-3 text-blue-500" />
                  <span className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wide">Grid</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">{gridMeterCount} meter{gridMeterCount !== 1 ? 's' : ''}</span>
                </div>
                {Array.from({ length: gridMeterCount }).map((_, idx) => {
                  const meterLabel = getGridLabel(idx);
                  const val = gridMeterReadings[idx] ?? '';
                  const isFirst = idx === 0;
                  const handleChange = (v: string) => {
                    setGridMeterReading(idx, v);
                    if (isFirst) setReading(v);
                  };
                  const meterKey = `grid-${idx}`;
                  const isSavingThis = savingMeter === meterKey;
                  const mMult = getGridMeterMult(idx);
                  // Pre-fill baseline guard — disable Save when value hasn't changed from previous
                  const gmrPrevSL = (prevRow as any)?.grid_meter_readings as Record<string, number> | null | undefined;
                  const prevMeterValSL = gmrPrevSL?.[String(idx)] ?? (idx === 0 ? prevGrid : null);
                  const gridMeterChanged = val !== '' && (prevMeterValSL == null || +val !== prevMeterValSL);
                  return (
                    <div key={`grid-${idx}`}>
                      <Label className="flex items-center gap-1 text-xs">
                        <GridPylonIcon className="h-2.5 w-2.5 text-blue-400" />
                        {meterLabel}
                        <span
                          className={`text-[9px] font-mono px-1 py-0 rounded ${mMult !== 1 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-700' : 'text-muted-foreground/40'}`}
                          title={configLoading ? 'Loading CT multiplier from config…' : `CT multiplier for this meter (configured in Plants → Power). Consumption = Δ × ${mMult}`}
                        >
                          {configLoading ? <Loader2 className="h-2 w-2 animate-spin inline" /> : `×${mMult}`}
                        </span>
                        {isFirst && editingId && <span className="text-[10px] text-amber-600 ml-1">(editing)</span>}
                        {(isAdmin || isManager || isDataAnalyst) && (
                          <button
                            type="button"
                            title={`View ${meterLabel} history`}
                            onClick={() => setPowerHistoryOpen({ type: 'grid', idx })}
                            className="ml-auto p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          >
                            <History className="h-3 w-3" />
                          </button>
                        )}
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input type="number" step="any" value={val}
                          onChange={e => handleChange(e.target.value)}
                          placeholder="Grid reading"
                          className="border-blue-300 focus-visible:ring-blue-300"
                          data-testid={`power-meter-input-${idx}`} />
                        <Button
                          size="sm"
                          disabled={isSavingThis || !gridMeterChanged || configLoading}
                          title={configLoading ? 'Loading meter config — please wait' : undefined}
                          onClick={() => submitMeter('grid', idx)}
                          className="shrink-0 h-9 px-3 text-xs bg-teal-700 text-white hover:bg-teal-800"
                          data-testid={`power-grid-save-${idx}`}
                        >
                          {isSavingThis || configLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                        </Button>
                      </div>
                      {(() => {
                        // Per-meter prev/delta: look up each meter's own previous reading
                        // from prevRow.grid_meter_readings JSONB; fall back to meter_reading_kwh for meter 0.
                        const gmrPrev = (prevRow as any)?.grid_meter_readings as Record<string, number> | null | undefined;
                        const prevMeterVal = gmrPrev?.[String(idx)] ?? (idx === 0 ? prevGrid : null);
                        if (prevMeterVal == null) return null;
                        // Suppress delta while showing unchanged pre-filled baseline
                        const perMeterDelta = gridMeterChanged ? +val - prevMeterVal : null;
                        return (
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            prev: <span className="font-mono-num">{fmtNum(prevMeterVal)}</span>
                            {perMeterDelta != null && (
                              <span className={`font-mono-num font-medium ml-1 ${perMeterDelta >= 0 ? 'text-blue-600' : 'text-destructive'}`}>
                                Δ {fmtNum(perMeterDelta)}
                              </span>
                            )}
                          </p>
                        );
                      })()}
                    </div>
                  );
                })}
                {/* Grid column total Δ — sums each meter's (Δ × per-meter multiplier) */}
                {gridMeterCount > 1 && (() => {
                  const gmrPrev = (prevRow as any)?.grid_meter_readings as Record<string, number> | null | undefined;
                  let totalDelta = 0;
                  let hasAny = false;
                  for (let mi = 0; mi < gridMeterCount; mi++) {
                    const currVal = gridMeterReadings[mi];
                    const prevVal = gmrPrev?.[String(mi)] ?? (mi === 0 ? prevGrid : null);
                    if (currVal && prevVal != null) {
                      totalDelta += (+currVal - prevVal) * getGridMeterMult(mi);
                      hasAny = true;
                    }
                  }
                  if (!hasAny) return null;
                  return (
                    <div className="rounded border border-blue-200 bg-blue-50/60 dark:border-blue-800/30 dark:bg-blue-950/10 px-2 py-1 text-[11px] flex items-center gap-1.5 mt-1">
                      <GridPylonIcon className="h-3 w-3 text-blue-500" />
                      <span className="text-muted-foreground">Total Δ</span>
                      <span className={`font-mono-num font-semibold ml-auto ${totalDelta >= 0 ? 'text-blue-700 dark:text-blue-400' : 'text-destructive'}`}>
                        {fmtNum(totalDelta)} kWh
                      </span>
                    </div>
                  );
                })()}
              </div>
            </div>}

            {/* ── Mobile: per-meter swipe carousel (grid meters first, then solar) ── */}
            {isMobile && (
              <MobileCarousel
                isMobile={true}
                items={powerMeterItems}
                renderItem={(item: { type: 'grid' | 'solar'; idx: number }) => {
                  /* ── Grid meter card ── */
                  if (item.type === 'grid') {
                    const meterLabel = getGridLabel(item.idx);
                    const val = gridMeterReadings[item.idx] ?? '';
                    const isFirst = item.idx === 0;
                    const handleChange = (v: string) => { setGridMeterReading(item.idx, v); if (isFirst) setReading(v); };
                    const isSavingThis = savingMeter === `grid-${item.idx}`;
                    const mMult = getGridMeterMult(item.idx);
                    const gmrPrevSL = (prevRow as any)?.grid_meter_readings as Record<string, number> | null | undefined;
                    const prevMeterValSL = gmrPrevSL?.[String(item.idx)] ?? (item.idx === 0 ? prevGrid : null);
                    const gridMeterChanged = val !== '' && (prevMeterValSL == null || +val !== prevMeterValSL);
                    const perMeterDelta = gridMeterChanged && prevMeterValSL != null ? +val - prevMeterValSL : null;
                    return (
                      <div key={`grid-card-${item.idx}`} className="px-4 py-3 space-y-2">
                        {/* Header: label + multiplier + history button */}
                        <div className="flex items-center justify-between gap-2">
                          <Label className="flex items-center gap-1.5 text-sm">
                            <GridPylonIcon className="h-3 w-3 text-blue-400" />
                            {meterLabel}
                            <span className={`text-[9px] font-mono px-1 py-0 rounded ${mMult !== 1 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-700' : 'text-muted-foreground/40'}`}>
                              {configLoading ? <Loader2 className="h-2 w-2 animate-spin inline" /> : `×${mMult}`}
                            </span>
                            {isFirst && editingId && <span className="text-[10px] text-amber-600">(editing)</span>}
                          </Label>
                          {(isAdmin || isManager || isDataAnalyst) && (
                            <Button variant="ghost" size="sm"
                              className="h-8 w-8 p-0 shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
                              onClick={() => setPowerHistoryOpen({ type: 'grid', idx: item.idx })} title={`View ${meterLabel} history`}>
                              <History className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                        {/* Drum roller */}
                        <OdometerRollerInput
                          value={val} onChange={handleChange}
                          alertState={gridMeterChanged ? (perMeterDelta != null && perMeterDelta < 0 ? 'warn' : 'ok') : 'neutral'}
                          disabled={isSavingThis || configLoading}
                          testId={`power-meter-input-${item.idx}`}
                        />
                        {/* prev / delta */}
                        <div className="flex items-center justify-between text-[11px] px-0.5">
                          <span className="text-muted-foreground">prev: <span className="font-mono-num">{prevMeterValSL != null ? fmtNum(prevMeterValSL) : '—'}</span></span>
                          {perMeterDelta != null && (
                            <span className={`font-mono-num font-medium ${perMeterDelta >= 0 ? 'text-blue-600' : 'text-destructive'}`}>Δ {fmtNum(perMeterDelta)} kWh</span>
                          )}
                        </div>
                        {/* Save */}
                        <Button
                          disabled={isSavingThis || !gridMeterChanged || configLoading}
                          title={configLoading ? 'Loading meter config — please wait' : undefined}
                          onClick={() => submitMeter('grid', item.idx)}
                          className="w-full h-11 text-sm bg-teal-700 text-white hover:bg-teal-800 active:bg-teal-900 shadow-sm"
                          data-testid={`power-grid-save-${item.idx}`}
                        >
                          {isSavingThis || configLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId && isFirst ? 'Update' : 'Save'}
                        </Button>
                      </div>
                    );
                  }
                  /* ── Solar meter card ── */
                  const meterLabel = getSolarLabel(item.idx);
                  const val = solarMeterReadings[item.idx] ?? '';
                  const isFirst = item.idx === 0;
                  const handleChange = (v: string) => { setSolarMeterReading(item.idx, v); if (isFirst) setSolarReading(v); };
                  const isSavingThis = savingMeter === `solar-${item.idx}`;
                  const solarPrevVal = item.idx === 0 ? prevSolar : null;
                  const solarMeterChanged = val !== '' && (solarInputMode === 'direct' || solarPrevVal == null || +val !== solarPrevVal);
                  const solarDeltaThis = solarInputMode === 'raw' && solarMeterChanged && solarPrevVal != null ? +val - solarPrevVal : null;
                  return (
                    <div key={`solar-card-${item.idx}`} className="px-4 py-3 space-y-2">
                      {/* Header: label + mode hint + history button */}
                      <div className="flex items-center justify-between gap-2">
                        <Label className="flex items-center gap-1.5 text-sm">
                          <span className="text-yellow-400">☀</span>
                          {meterLabel}
                          {isFirst && editingId && <span className="text-[10px] text-amber-600">(editing)</span>}
                        </Label>
                        {(isAdmin || isManager || isDataAnalyst) && (
                          <Button variant="ghost" size="sm"
                            className="h-8 w-8 p-0 shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
                            onClick={() => setPowerHistoryOpen({ type: 'solar', idx: item.idx })} title={`View ${meterLabel} history`}>
                            <History className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                      {isFirst && (
                        <p className="text-[10px] text-muted-foreground -mt-1">
                          Mode: <span className="font-medium text-yellow-600 dark:text-yellow-400">{solarInputMode === 'direct' ? 'Direct kWh' : 'Raw Meter'}</span>
                          <span className="opacity-60 ml-1">(Plants → Energy Sources)</span>
                        </p>
                      )}
                      {/* Input: drum for raw, regular input for direct */}
                      {solarInputMode === 'raw' ? (
                        <>
                          <OdometerRollerInput
                            value={val} onChange={handleChange}
                            alertState={solarMeterChanged ? (solarDeltaThis != null && solarDeltaThis < 0 ? 'warn' : 'ok') : 'neutral'}
                            disabled={isSavingThis}
                            testId={`power-solar-input-${item.idx}`}
                          />
                          {isFirst && (
                            <div className="flex items-center justify-between text-[11px] px-0.5">
                              <span className="text-muted-foreground">prev: <span className="font-mono-num">{prevSolar != null ? fmtNum(prevSolar) : '—'}</span></span>
                              {solarDeltaThis != null && <span className={`font-mono-num font-medium ${solarDeltaThis >= 0 ? 'text-yellow-600' : 'text-destructive'}`}>Δ {fmtNum(solarDeltaThis)} kWh</span>}
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <Input type="number" step="any" value={val}
                            onChange={e => handleChange(e.target.value)}
                            placeholder="Daily kWh"
                            className="border-yellow-300 focus-visible:ring-yellow-300"
                            data-testid={`power-solar-input-${item.idx}`} />
                          {isFirst && val && <p className="text-[10px] text-yellow-600 dark:text-yellow-400 font-mono-num">→ {fmtNum(+val)} kWh daily production</p>}
                        </>
                      )}
                      {/* Save */}
                      <Button
                        disabled={isSavingThis || !solarMeterChanged}
                        onClick={() => submitMeter('solar', item.idx)}
                        className="w-full h-11 text-sm bg-teal-700 text-white hover:bg-teal-800 active:bg-teal-900 shadow-sm"
                        data-testid={`power-solar-save-${item.idx}`}
                      >
                        {isSavingThis ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                      </Button>
                    </div>
                  );
                }}
              />
            )}

            {/* Energy Source Breakdown — total Δ solar + total Δ grid */}
            <div className="flex items-center gap-1.5 rounded border bg-muted/20 px-2.5 py-1.5 text-[11px]">
              <span className="text-muted-foreground/60 font-medium uppercase tracking-wide shrink-0">Breakdown</span>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-yellow-500 shrink-0">☀</span>
              <span className={deltaSolar != null ? 'font-mono-num font-medium text-yellow-700 dark:text-yellow-400' : 'text-muted-foreground/50'}>
                {deltaSolar != null ? `${fmtNum(deltaSolar)} kWh` : '—'}
              </span>
              <span className="text-muted-foreground/40 mx-0.5">|</span>
              <GridPylonIcon className="h-3 w-3 text-blue-500 shrink-0" />
              <span className={deltaGrid != null ? 'font-mono-num font-medium text-blue-700 dark:text-blue-400' : 'text-muted-foreground/50'}>
                {deltaGrid != null ? `${fmtNum(deltaGrid * effectiveMultiplier)} kWh` : '—'}
              </span>
              {effectiveMultiplier !== 1 && deltaGrid != null && (
                <span className="text-[10px] text-amber-500 ml-0.5">×{effectiveMultiplier}</span>
              )}
              <span className="text-muted-foreground/30 text-[10px] ml-auto">auto · read-only</span>
            </div>
          </div>
        ) : (
          // Non-solar plant: Date & Time inline, then dynamic grid meter rows (per-meter multipliers shown inline)
          <div className="space-y-3">
            {/* Date & Time */}
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label>Date &amp; Time</Label>
                <Input type="datetime-local" value={dt} onChange={e => setDt(e.target.value)}
                  className="h-10 w-full max-w-[260px] min-w-[220px] block text-center sm:text-left bg-muted/30 border-border/70 text-foreground/80" />
              </div>
            </div>

            {/* Dynamic grid meter rows — MobileCarousel on mobile, stacked on desktop */}
            <MobileCarousel
              isMobile={isMobile}
              items={Array.from({ length: gridMeterCount }, (_, i) => i)}
              renderItem={(idx: number) => {
                const meterLabel = getGridLabel(idx);
                const val = gridMeterReadings[idx] ?? '';
                const isFirst = idx === 0;
                const handleChange = (v: string) => { setGridMeterReading(idx, v); if (isFirst) setReading(v); };
                const isSavingThis2 = savingMeter === `grid-${idx}`;
                const mMult = getGridMeterMult(idx);
                const gmrPrevNS = (prevRow as any)?.grid_meter_readings as Record<string, number> | null | undefined;
                const prevMeterValNS = gmrPrevNS?.[String(idx)] ?? (idx === 0 ? prevGrid : null);
                const gridMeterChangedNS = val !== '' && (prevMeterValNS == null || +val !== prevMeterValNS);
                const perMeterDeltaNS = gridMeterChangedNS && prevMeterValNS != null ? +val - prevMeterValNS : null;
                const perMeterEffectiveNS = perMeterDeltaNS != null ? perMeterDeltaNS * mMult : null;
                return (
                  <div key={`grid-ns-${idx}`} className={isMobile ? 'px-4 py-3 space-y-2' : 'space-y-1'}>
                    {/* Header: label + CT multiplier + history button */}
                    <div className="flex items-center justify-between gap-2">
                      <Label className="flex items-center gap-1.5">
                        <GridPylonIcon className="h-3 w-3 text-blue-500" />
                        {meterLabel}
                        <span
                          className={`text-[9px] font-mono px-1 py-0 rounded ${mMult !== 1 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-700' : 'text-muted-foreground/40'}`}
                          title={`CT multiplier for this meter (configured in Plants → Power). Consumption = Δ × ${mMult}`}
                        >
                          ×{mMult}
                        </span>
                        {isFirst && editingId && <span className="text-xs text-highlight ml-1">(editing)</span>}
                      </Label>
                      {(isAdmin || isManager || isDataAnalyst) && (
                        <Button variant="ghost" size="sm"
                          className="h-8 w-8 p-0 shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
                          onClick={() => setPowerHistoryOpen({ type: 'grid', idx })} title={`View ${meterLabel} history`}>
                          <History className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>

                    {isMobile ? (
                      <>
                        <OdometerRollerInput
                          value={val} onChange={handleChange}
                          alertState={gridMeterChangedNS ? (perMeterDeltaNS != null && perMeterDeltaNS < 0 ? 'warn' : 'ok') : 'neutral'}
                          disabled={isSavingThis2}
                          testId={`power-meter-input-${idx}`}
                        />
                        <div className="flex items-center justify-between text-[11px] px-0.5">
                          <span className="text-muted-foreground">prev: <span className="font-mono-num">{prevMeterValNS != null ? fmtNum(prevMeterValNS) : '—'}</span>
                            {perMeterDeltaNS != null && <span className={`font-mono-num font-medium ml-1 ${perMeterDeltaNS >= 0 ? 'text-blue-600' : 'text-destructive'}`}>Δ {fmtNum(perMeterDeltaNS)}</span>}
                          </span>
                          {perMeterEffectiveNS != null && mMult !== 1 && (
                            <span className="font-mono-num text-amber-700 dark:text-amber-400">{fmtNum(perMeterEffectiveNS, 2)} kWh eff.</span>
                          )}
                        </div>
                        <Button
                          disabled={isSavingThis2 || !gridMeterChangedNS}
                          onClick={() => submitMeter('grid', idx)}
                          className="w-full h-11 text-sm bg-teal-700 text-white hover:bg-teal-800 active:bg-teal-900 shadow-sm"
                          data-testid={`power-grid-save-ns-${idx}`}
                        >
                          {isSavingThis2 ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                        </Button>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <Input type="number" step="any" value={val}
                            onChange={e => handleChange(e.target.value)}
                            placeholder="Grid meter reading"
                            className="border-blue-300 focus-visible:ring-blue-300"
                            data-testid={`power-meter-input-${idx}`} />
                          <Button
                            size="sm"
                            disabled={isSavingThis2 || !gridMeterChangedNS}
                            onClick={() => submitMeter('grid', idx)}
                            className="shrink-0 h-9 px-3 text-xs bg-teal-700 text-white hover:bg-teal-800"
                            data-testid={`power-grid-save-ns-${idx}`}
                          >
                            {isSavingThis2 ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                          </Button>
                        </div>
                        {prevMeterValNS != null && (() => {
                          const perMeterEffective = perMeterDeltaNS != null ? perMeterDeltaNS * mMult : null;
                          return (
                            <div className="text-xs text-muted-foreground space-y-0.5 mt-0.5">
                              <span>
                                Previous: <span className="font-mono-num">{fmtNum(prevMeterValNS)}</span>
                                {perMeterDeltaNS != null && <> · Δ <span className="font-mono-num">{fmtNum(perMeterDeltaNS)}</span></>}
                              </span>
                              {perMeterEffective != null && mMult !== 1 && (
                                <div className="inline-flex items-center gap-1.5 ml-2 rounded bg-amber-50 border border-amber-200 dark:bg-amber-950/20 dark:border-amber-800 px-2 py-0.5">
                                  <Zap className="h-3 w-3 text-amber-500 shrink-0" />
                                  <span className="font-mono-num font-medium text-amber-700 dark:text-amber-300">{fmtNum(perMeterEffective, 2)} kWh</span>
                                  <span className="text-amber-600/70 dark:text-amber-400/60">effective (×{mMult})</span>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </>
                    )}
                  </div>
                );
              }}
            />
          </div>
        )}

        {editingId && (
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => { setEditingId(null); setReading(''); setSolarReading(''); setGridMeterReadings(['', '', '', '', '']); setSolarMeterReadings(['', '', '', '', '']); setSolarInputMode('raw'); }}>Cancel edit</Button>
          </div>
        )}
      </Card>

      {importOpen && (
        <ImportReadingsDialog
          title="Import Power Readings from CSV"
          module="power"
          plantId={plantId}
          userId={user?.id ?? null}
          schemaHint={POWER_SCHEMA}
          templateFilename="power_readings_template.csv"
          templateRow={POWER_TEMPLATE_ROW}
          validateRow={validatePowerRow}
          insertRows={(rows, pid) => insertPowerReadings(rows, pid, user?.id ?? null)}
          onClose={() => setImportOpen(false)}
          onImported={() => { setImportOpen(false); invalidatePowerDash(qc); }}
        />
      )}
      {powerHistoryOpen && plantId && (
        <ReadingHistoryDialog
          entityName={plants?.find((p: any) => p.id === plantId)?.name ?? 'Plant'}
          module="power"
          entityId={plantId}
          multiplier={effectiveMultiplier}
          gridMeterCount={gridMeterCount}
          gridMeterNames={gridMeterNames}
          gridMultipliers={Array.isArray(configMultiplierArr) ? (configMultiplierArr as any[]).map(Number) : []}
          meterFilter={powerHistoryOpen}
          onClose={() => setPowerHistoryOpen(null)}
        />
      )}
    </div>
  );
}

// ─── Reading History Dialog ───────────────────────────────────────────────────

type HistoryModule = 'locator' | 'well' | 'blending' | 'power';
