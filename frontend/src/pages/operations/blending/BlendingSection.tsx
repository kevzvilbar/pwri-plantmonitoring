import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { PlantSelector } from '@/components/PlantSelector';
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
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';
import { MapPin, Pencil, X, Droplet, Zap, Upload, Download, FileText, AlertCircle, Loader2, History, Gauge, FlaskConical, Keyboard, CalendarClock } from 'lucide-react';

// High-voltage transmission tower icon — matches Plants.tsx grid icon exactly.

import { OdometerRollerInput, MobileCarousel } from '@/components/OdometerRollerInput';
import {
  parseCSVText, triggerTemplateDownload, normalizeDatetime,
  clearDupDecisions, clearBulkDupDecision, ImportReadingsDialog, resolveImportDuplicate,
} from '@/components/ReadingImportDialog';
import { ReadingHistoryDialog } from '@/components/ReadingHistoryDialog';
import {
  GridPylonIcon, BASE, WELL_MAX_READINGS_PER_DAY, READING_COOLDOWN_MINUTES, SPIKE_MULTIPLIER,
  formatCooldown, invalidateLocatorDash, invalidateWellDash, invalidateDashboard,
  invalidateProductMeterDash, invalidatePowerDash, invalidateRODash, invalidateChemDash,
} from '../shared';
import { useBlendingWells } from '../shared';

const BLENDING_SCHEMA =
  'well_name*,  raw_meter_reading (cumulative) | volume_m3* (daily m³),  ' +
  'previous_reading (prev cumulative — raw mode only; auto-detected if omitted),  ' +
  'event_date (YYYY-MM-DD),  reading_datetime (YYYY-MM-DDTHH:mm)';

const BLENDING_TEMPLATE_ROW = {
  well_name:          'Well #2',
  raw_meter_reading:  '12345.00',   // ← provide this (cumulative) …
  previous_reading:   '12195.00',   //   … and optionally the previous cumulative value
  volume_m3:          '',           //   OR provide volume_m3 (daily m³) instead
  event_date:         '2024-06-15',
  reading_datetime:   '2024-06-15T08:30',
};

export function validateBlendingRow(r: Record<string, string>, i: number): string[] {
  const e: string[] = [];
  if (!r.well_name?.trim()) e.push(`Row ${i}: well_name is required`);

  const hasRaw = !!r.raw_meter_reading?.trim();
  const hasVol = !!r.volume_m3?.trim();

  if (!hasRaw && !hasVol)
    e.push(`Row ${i}: provide raw_meter_reading (cumulative meter) or volume_m3 (daily m³) — one is required`);
  if (hasRaw && hasVol)
    e.push(`Row ${i}: provide raw_meter_reading OR volume_m3, not both`);
  if (hasRaw && (isNaN(Number(r.raw_meter_reading)) || Number(r.raw_meter_reading) < 0))
    e.push(`Row ${i}: raw_meter_reading must be a non-negative number`);
  if (hasVol && (isNaN(Number(r.volume_m3)) || Number(r.volume_m3) <= 0))
    e.push(`Row ${i}: volume_m3 must be a positive number`);
  if (r.previous_reading?.trim() && isNaN(Number(r.previous_reading)))
    e.push(`Row ${i}: previous_reading must be a number`);
  if (r.event_date && isNaN(Date.parse(r.event_date)))
    e.push(`Row ${i}: event_date is not a valid date (use YYYY-MM-DD)`);
  if (r.reading_datetime?.trim() && isNaN(Date.parse(normalizeDatetime(r.reading_datetime))))
    e.push(`Row ${i}: reading_datetime is not a valid date (use YYYY-MM-DDTHH:mm)`);
  return e;
}

async function insertBlendingReadings(
  rows: Record<string, string>[],
  plantId: string,
  plantName: string,
): Promise<{ count: number; errors: string[] }> {
  const { data: wells } = await supabase
    .from('wells').select('id, name').eq('plant_id', plantId);
  const nameToId: Record<string, string> = {};
  (wells ?? []).forEach((w: any) => { nameToId[w.name.trim().toLowerCase()] = w.id; });

  // ── Raw meter tracking ────────────────────────────────────────────────────
  // Priority for "previous cumulative reading" resolution (highest → lowest):
  //   1. Explicit `previous_reading` column in the CSV row
  //   2. Last raw_meter_reading processed for this well earlier in this batch
  //      (rows are sorted chronologically before processing)
  //   3. localStorage value persisted by manual BlendingRow entries or prior imports
  // If nothing is found → baseline entry: store the raw value as volume_m3 directly
  // (same behaviour as the manual raw-mode save with no prior reading).
  const prevRawByWell: Record<string, number | null> = {};

  const initPrevRaw = (wellId: string) => {
    if (wellId in prevRawByWell) return; // already seeded
    try {
      const stored = localStorage.getItem(`blending-raw-${wellId}`);
      prevRawByWell[wellId] = stored ? (JSON.parse(stored) as { reading: number }).reading : null;
    } catch {
      prevRawByWell[wellId] = null;
    }
  };

  // Sort chronologically so intra-batch deltas are computed in the right order
  const sorted = [...rows].sort((a, b) => {
    const da = a.reading_datetime || a.event_date || '';
    const db = b.reading_datetime || b.event_date || '';
    return da.localeCompare(db);
  });

  // Accumulate localStorage updates; apply them all at the end so a mid-import
  // error doesn't leave localStorage in a half-written state.
  const pendingRawPersist: Record<string, { reading: number; date: string }> = {};

  let count = 0;
  const errors: string[] = [];

  for (const r of sorted) {
    const wellId = nameToId[r.well_name?.trim().toLowerCase()];
    if (!wellId) { errors.push(`Well not found: "${r.well_name}"`); continue; }
    // Normalise event_date to YYYY-MM-DD regardless of what the CSV contains
    // (Excel commonly exports as M/D/YYYY e.g. "5/19/2026"; PostgreSQL stores
    // dates in ISO format so the duplicate-check .eq() and future queries must
    // use the same canonical form to match correctly).
    const _rawEventDate = r.event_date || '';
    const _parsedEvent = _rawEventDate ? new Date(_rawEventDate) : null;
    const eventDate = (_parsedEvent && !isNaN(_parsedEvent.getTime()))
      ? `${_parsedEvent.getFullYear()}-${String(_parsedEvent.getMonth() + 1).padStart(2, '0')}-${String(_parsedEvent.getDate()).padStart(2, '0')}`
      : new Date().toISOString().slice(0, 10);

    // ── Compute the volume_m3 value to store ──────────────────────────────
    let storeVol: number;
    const isRawRow = !!r.raw_meter_reading?.trim();

    if (isRawRow) {
      const curRaw = +r.raw_meter_reading;
      initPrevRaw(wellId);

      // Determine previous: explicit CSV column wins, then batch-tracked, then localStorage
      const prevRaw: number | null =
        r.previous_reading?.trim() ? +r.previous_reading
        : prevRawByWell[wellId] ?? null;

      if (prevRaw == null) {
        // No prior reading available → baseline: store raw value as first volume entry
        // (mirrors manual raw-mode behaviour for first-ever reading on a well)
        storeVol = curRaw;
      } else {
        storeVol = curRaw - prevRaw;
        if (storeVol < 0) {
          errors.push(
            `${r.well_name} @ ${eventDate}: negative delta ${storeVol.toFixed(2)} m³ ` +
            `(raw ${curRaw} − prev ${prevRaw}) — meter rollback? Row skipped.`,
          );
          continue;
        }
        if (storeVol === 0) {
          errors.push(
            `${r.well_name} @ ${eventDate}: delta is 0 (current reading equals previous ${curRaw}). Row skipped.`,
          );
          continue;
        }
      }

      // Advance the batch tracker so the next row for this well uses this reading
      prevRawByWell[wellId] = curRaw;
      pendingRawPersist[wellId] = { reading: curRaw, date: eventDate };
    } else {
      // Direct m³ mode — use volume_m3 as-is
      storeVol = +r.volume_m3;
    }

    if (!(storeVol > 0)) {
      errors.push(`${r.well_name} @ ${eventDate}: computed volume must be positive (got ${storeVol}). Row skipped.`);
      continue;
    }

    // ── Duplicate check: same well + same event_date ───────────────────────
    try {
      const { data: existing } = await (supabase.from('blending_events' as any) as any)
        .select('id')
        .eq('well_id', wellId)
        .eq('event_date', eventDate)
        .limit(1);
      if (existing && existing.length > 0) {
        const decision = await resolveImportDuplicate(
          `${wellId}|${eventDate}`,
          `${r.well_name} @ ${eventDate}`,
          true, // date-only match
        );
        if (decision === 'skip') continue;
        // overwrite: fall through to upsert below
      }
    } catch {
      // blending_events table may not exist yet — fall through and let the insert handle it
    }

    try {
      const { data: existingRec } = await (supabase.from('blending_events' as any) as any)
        .select('id').eq('well_id', wellId).eq('event_date', eventDate).limit(1);
      // Resolve reading_datetime from CSV: prefer reading_datetime column, fall back to event_date
      const _csvDt = r.reading_datetime?.trim() ? normalizeDatetime(r.reading_datetime.trim()) : null;
      const _rdIso = _csvDt && !isNaN(Date.parse(_csvDt)) ? new Date(_csvDt).toISOString() : null;
      let insErr: any;
      if (existingRec?.length) {
        ({ error: insErr } = await (supabase.from('blending_events' as any) as any)
          .update({ volume_m3: storeVol, plant_id: plantId, well_name: r.well_name, plant_name: plantName,
            ...(_rdIso ? { reading_datetime: _rdIso } : {}),
            ...(isRawRow ? { raw_meter_reading: +r.raw_meter_reading } : {}) })
          .eq('id', existingRec[0].id));
      } else {
        ({ error: insErr } = await (supabase.from('blending_events' as any) as any)
          .insert({ well_id: wellId, plant_id: plantId, well_name: r.well_name, plant_name: plantName,
            event_date: eventDate,
            ...(_rdIso ? { reading_datetime: _rdIso } : {}),
            volume_m3: storeVol, ...(isRawRow ? { raw_meter_reading: +r.raw_meter_reading } : {}) }));
      }
      if (insErr) throw new Error(insErr.message);
      count++;
    } catch (e: any) {
      errors.push(e.message);
    }
  }

  // ── Persist latest raw readings to localStorage ────────────────────────────
  // Applied after the loop so BlendingRow's delta calculation stays correct on
  // the next manual entry, and future imports can auto-detect the previous value.
  for (const [wellId, v] of Object.entries(pendingRawPersist)) {
    try { localStorage.setItem(`blending-raw-${wellId}`, JSON.stringify(v)); } catch { /* best-effort persist — ignore */ }
  }

  return { count, errors };
}

// Power readings:
// Note: Power/solar CSV import lives in PowerSection.tsx (POWER_SCHEMA there) —
// this module handles blending readings only.

export function BlendingForm() {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const { user, isAdmin, isManager, isDataAnalyst } = useAuth();
  const { data: plants } = usePlants();
  const [plantId, setPlantId] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const plantName = plants?.find((p: any) => p.id === plantId)?.name ?? '';

  const { data: wells } = useQuery({
    queryKey: ['op-wells', plantId],
    queryFn: async () => plantId
      ? (await supabase.from('wells').select('id, name, plant_id, status').eq('plant_id', plantId).eq('status', 'Active').order('name')).data ?? []
      : [],
    enabled: !!plantId,
  });

  const { data: blendingData } = useBlendingWells(plantId);
  const blendingIds    = useMemo(() => new Set((blendingData?.wells ?? []).map((w) => w.well_id)), [blendingData]);
  const blendingWells  = useMemo(() => (wells ?? []).filter((w: any) => blendingIds.has(w.id)), [wells, blendingIds]);

  const { data: volumeData } = useQuery<{
    by_well: { well_id: string; volume_m3: number; today_volume_m3: number; previous_volume_m3: number | null; previous_event_date: string | null }[];
  }>({
    queryKey: ['blending-today', plantId],
    queryFn: async () => {
      try {
        const res = await fetch(`${BASE}/api/blending/volume?days=14&plant_ids=${encodeURIComponent(plantId)}`);
        if (!res.ok) return { by_well: [] };
        return res.json();
      } catch { return { by_well: [] }; }
    },
    enabled: !!plantId,
    retry: false,
  });
  const todayByWell = useMemo(() => {
    const m: Record<string, number> = {};
    for (const w of volumeData?.by_well ?? []) m[w.well_id] = w.today_volume_m3 ?? 0;
    return m;
  }, [volumeData]);
  const prevByWell = useMemo(() => {
    const m: Record<string, { volume: number | null; date: string | null }> = {};
    for (const w of volumeData?.by_well ?? []) m[w.well_id] = { volume: w.previous_volume_m3 ?? null, date: w.previous_event_date ?? null };
    return m;
  }, [volumeData]);

  // Fetch the latest raw_meter_reading per blending well from the DB so the
  // OdometerRollerInput can pre-fill correctly on devices with no localStorage.
  const { data: latestRawData } = useQuery({
    queryKey: ['blending-latest-raw', plantId],
    queryFn: async () => {
      if (!plantId) return [];
      const { data } = await (supabase.from('blending_events' as any) as any)
        .select('well_id, raw_meter_reading, event_date')
        .eq('plant_id', plantId)
        .not('raw_meter_reading', 'is', null)
        .order('event_date', { ascending: false })
        .limit(200);
      // Keep only the most recent row per well
      const seen = new Set<string>();
      return ((data ?? []) as any[]).filter((r: any) => {
        if (seen.has(r.well_id)) return false;
        seen.add(r.well_id);
        return true;
      });
    },
    enabled: !!plantId,
  });

  const latestRawByWell = useMemo(() => {
    const m: Record<string, { reading: number; date: string } | null> = {};
    for (const r of latestRawData ?? [])
      m[r.well_id] = { reading: r.raw_meter_reading, date: r.event_date };
    return m;
  }, [latestRawData]);

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Plant</Label>
            <PlantSelector value={plantId} onChange={setPlantId} />
          </div>
          {(isAdmin || isManager || isDataAnalyst) && plantId && (
            <Button
              size="sm" variant="outline"
              className="shrink-0 gap-1.5 h-10 border-teal-600/60 text-teal-700 hover:bg-teal-50 hover:border-teal-600 dark:hover:bg-teal-950/30"
              onClick={() => setImportOpen(true)}
              data-testid="import-blending-readings-btn"
            >
              <Upload className="h-3.5 w-3.5" />
              Import
            </Button>
          )}
        </div>
      </Card>

      {plantId && (
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Gauge className="h-3.5 w-3.5 text-teal-600" />
              <span className="text-xs font-semibold text-foreground/80 tracking-tight">Blending Wells</span>
            </div>
            <span className="text-[11px] text-muted-foreground tabular-nums bg-muted px-2 py-0.5 rounded-full">{blendingWells.length} tagged</span>
          </div>
          {blendingWells.length ? (
            <MobileCarousel
              isMobile={isMobile}
              items={blendingWells}
              renderItem={(w: any) => (
                <BlendingRow
                  key={w.id}
                  well={w} plantId={plantId} plantName={plantName}
                  todayVolume={todayByWell[w.id] ?? 0}
                  previousVolume={prevByWell[w.id]?.volume ?? null}
                  previousDate={prevByWell[w.id]?.date ?? null}
                  avgVol={prevByWell[w.id]?.volume ?? null}
                  dbLatestRaw={latestRawByWell[w.id] ?? null}
                  onSaved={() => {
                    qc.invalidateQueries({ queryKey: ['blending-today', plantId] });
                    qc.invalidateQueries({ queryKey: ['blending-latest-raw', plantId] });
                    qc.invalidateQueries({ queryKey: ['blending-volume'] });
                  }}
                  isManagerOrAdmin={isAdmin || isManager || isDataAnalyst}
                />
              )}
            />
          ) : (
            <div className="px-4 py-6 text-xs text-muted-foreground text-center">
              No wells tagged as blending for this plant. Tag a well under <span className="font-medium text-foreground/70">Plants → Wells</span>.
            </div>
          )}
        </Card>
      )}

      {importOpen && (
        <ImportReadingsDialog
          title="Import Blending Readings from CSV"
          module="Blending Readings"
          plantId={plantId}
          userId={user?.id ?? null}
          schemaHint={BLENDING_SCHEMA}
          templateFilename="blending_readings_template.csv"
          templateRow={BLENDING_TEMPLATE_ROW}
          validateRow={validateBlendingRow}
          insertRows={(rows, pid) => insertBlendingReadings(rows, pid, plantName)}
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false);
            qc.invalidateQueries({ queryKey: ['blending-today', plantId] });
            qc.invalidateQueries({ queryKey: ['blending-volume'] });
          }}
        />
      )}
    </div>
  );
}

// ─── Blending per-well localStorage keys ─────────────────────────────────────
// BUG FIX #2: persist the user's chosen input mode (raw vs direct) across
// re-mounts / tab switches so it doesn't silently reset to 'direct' each time.
// BUG FIX #3: persist the last cumulative meter reading entered in raw mode
// so the Δ calculation and "prev" hint are correct on the next visit.
// The DB only stores the computed daily-volume delta — it has no cumulative
// column — so localStorage is the only reliable source for the previous raw value.
function getBlendingModeKey(wellId: string) { return `blending-mode-${wellId}`; }
function getBlendingRawKey(wellId: string)  { return `blending-raw-${wellId}`; }

function readPersistedMode(wellId: string): 'raw' | 'direct' {
  try {
    const v = localStorage.getItem(getBlendingModeKey(wellId));
    return v === 'raw' ? 'raw' : 'direct';
  } catch { return 'direct'; }
}

function readPersistedRaw(wellId: string): { reading: number; date: string } | null {
  try {
    const v = localStorage.getItem(getBlendingRawKey(wellId));
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}

function persistMode(wellId: string, mode: 'raw' | 'direct') {
  try { localStorage.setItem(getBlendingModeKey(wellId), mode); } catch { /* best-effort persist — ignore */ }
}

function persistRaw(wellId: string, reading: number, date: string) {
  try { localStorage.setItem(getBlendingRawKey(wellId), JSON.stringify({ reading, date })); } catch { /* best-effort persist — ignore */ }
}

function BlendingRow({
  well, plantId, plantName, todayVolume, previousVolume, previousDate, avgVol, dbLatestRaw, onSaved, isManagerOrAdmin,
}: {
  well: any; plantId: string; plantName?: string;
  todayVolume: number; previousVolume: number | null; previousDate: string | null;
  avgVol?: number | null;
  dbLatestRaw?: { reading: number; date: string } | null;
  onSaved: () => void;
  isManagerOrAdmin: boolean;
}) {
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const [volume, setVolume] = useState('');
  const lastPrefilledBlend = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [customDt, setCustomDt] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const dtInputRef = useRef<HTMLInputElement>(null);

  // BUG FIX #2: initialise from localStorage so the mode survives remounts/navigation.
  const [inputMode, setInputMode] = useState<'raw' | 'direct'>(() => readPersistedMode(well.id));

  // BUG FIX #3: the previous *cumulative* meter reading is not stored in the DB
  // (the DB only keeps the computed daily-volume delta). Read it from localStorage
  // where it was written on the last successful raw-mode save for this well.
  const [prevRawReading, setPrevRawReading] = useState<{ reading: number; date: string } | null>(
    () => readPersistedRaw(well.id),
  );

  // Pre-fill the drum with the last persisted raw reading (raw mode) so the
  // operator starts from the real odometer value and rolls only the changed digits.
  // Priority: localStorage (most recent) → DB latest raw_meter_reading (fallback for
  // new devices / cleared storage) → nothing (first-ever entry).
  // Race-condition fix: same pattern as LocatorRow / WellRow — track last auto-fill
  // in a ref so a poll-driven update to prevRawReading also updates the drum when
  // the user hasn't yet typed anything.
  useEffect(() => {
    if (inputMode !== 'raw') return;
    const src = prevRawReading?.reading ?? dbLatestRaw?.reading ?? null;
    if (src == null) return;
    const expected = src.toFixed(2);
    if (volume === '' || volume === lastPrefilledBlend.current) {
      setVolume(expected);
      lastPrefilledBlend.current = expected;
    }
  }, [prevRawReading, dbLatestRaw, inputMode, volume]);

  // Pre-fill with today's already-logged volume for direct mode.
  useEffect(() => {
    if (volume === '' && todayVolume > 0 && inputMode === 'direct') {
      setVolume(todayVolume.toFixed(2));
    }
  }, [todayVolume, volume, inputMode]);

  // BUG FIX #2: persist the chosen mode and clear the input field.
  const switchMode = (m: 'raw' | 'direct') => {
    setInputMode(m);
    setVolume('');
    persistMode(well.id, m);
  };

  // BUG FIX #3: Δ for raw mode uses the persisted cumulative reading first,
  // then the DB-fetched raw_meter_reading (for cross-device consistency),
  // finally falling back to the API-supplied previousVolume (daily m³ — less accurate
  // for cumulative meters, but better than showing nothing).
  const prevCumulative: number | null =
    prevRawReading?.reading ?? dbLatestRaw?.reading ?? previousVolume ?? null;

  const deltaRaw = inputMode === 'raw' && volume !== ''
    ? prevCumulative != null ? +volume - prevCumulative : null
    : null;

  // BUG FIX #1: Save was permanently disabled in raw mode whenever there was no
  // prior reading (deltaRaw == null) — e.g. first entry ever for this well.
  // Fix: allow saving a baseline reading (storeVol = +volume) when no prev exists.
  // Also guard direct mode against saving 0 m³.
  const isBaselineRaw = inputMode === 'raw' && prevCumulative == null && volume !== '' && +volume > 0;
  const volumeChanged = volume !== '' && (
    inputMode === 'raw'
      ? isBaselineRaw || (deltaRaw != null && deltaRaw > 0)  // allow baseline entry
      : +volume > 0 && +volume !== todayVolume               // guard against saving 0
  );

  // ── Warning flags (mirrors well / locator logic) ───────────────────────────
  // Negative delta: raw mode reading goes below previous cumulative.
  const blendBelowPrev = inputMode === 'raw' && deltaRaw != null && deltaRaw < 0;
  // Above-average: compare current entry volume against avgVol (or previousVolume as
  // fallback reference) scaled by the shared ALERTS multiplier.
  const blendVolToCheck = inputMode === 'raw' ? (deltaRaw ?? null) : (volume !== '' ? +volume : null);
  const avgRef = avgVol ?? previousVolume;
  const blendHighVol = avgRef != null && blendVolToCheck != null
    && blendVolToCheck > avgRef * ALERTS.avg_multiplier_warn;

  const save = async () => {
    const eventDate = customDt.slice(0, 10);

    // BUG FIX #1 cont.: when no previous cumulative reading exists (baseline),
    // store the raw meter reading itself as the daily volume for this first entry.
    const storeVol = inputMode === 'raw'
      ? (deltaRaw != null ? deltaRaw : +volume)   // baseline → store full reading
      : +volume;

    if (!volume || !(storeVol > 0)) {
      // BUG FIX #4a: more descriptive error in raw mode (negative delta case).
      if (inputMode === 'raw' && deltaRaw != null && deltaRaw <= 0) {
        toast.error(`${well.name}: current reading must be greater than the previous (${fmtNum(prevCumulative!)})`);
      } else {
        toast.error(`${well.name}: enter a positive blending volume`);
      }
      return;
    }
    // Warn on suspicious values (same behaviour as locator / well — save proceeds).
    if (blendBelowPrev) toast.info(`${well.name}: reading below previous — saved anyway`);
    else if (blendHighVol) toast.info(`${well.name}: blending volume unusually high vs. reference — saved anyway`);
    setSaving(true);
    try {
      const { data: existing } = await (supabase.from('blending_events' as any) as any)
        .select('id').eq('well_id', well.id).eq('event_date', eventDate).limit(1);
      let error: any;
      if (existing?.length) {
        ({ error } = await (supabase.from('blending_events' as any) as any)
          .update({ volume_m3: storeVol, plant_id: plantId, well_name: well.name, plant_name: plantName,
            reading_datetime: new Date(customDt).toISOString(),
            ...(inputMode === 'raw' ? { raw_meter_reading: +volume } : {}) })
          .eq('id', existing[0].id));
      } else {
        ({ error } = await (supabase.from('blending_events' as any) as any)
          .insert({ well_id: well.id, plant_id: plantId, well_name: well.name, plant_name: plantName,
            event_date: eventDate, reading_datetime: new Date(customDt).toISOString(),
            volume_m3: storeVol,
            ...(inputMode === 'raw' ? { raw_meter_reading: +volume } : {}) }));
      }
      if (error) throw error;

      // BUG FIX #3 cont.: persist the cumulative meter reading locally so the
      // next raw-mode save can compute the correct Δ.
      if (inputMode === 'raw') {
        persistRaw(well.id, +volume, eventDate);
        setPrevRawReading({ reading: +volume, date: eventDate });
        // Reset the pre-fill guard so the drum auto-fills with the new "prev"
        // value after setVolume('') clears the input.
        lastPrefilledBlend.current = null;
      }

      toast.success(`${well.name}: blending volume saved (${fmtNum(storeVol)} m³)`);
      setVolume('');

      // BUG FIX #4b: invalidate dashboard so stat cards refresh immediately.
      invalidateWellDash(qc, [well.id]);
      onSaved();
    } catch (e: any) {
      toast.error(friendlyError(e));
    } finally { setSaving(false); }
  };

  return (
    <div className="p-3 space-y-2" data-testid={`blending-row-${well.id}`}>
      {/* Row 1: Well name + badge + history icon (always visible) */}
      <div className="flex items-start gap-2 min-w-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium break-words">{well.name}</span>
            <Badge className="bg-violet-100 text-violet-700 border-violet-200 hover:bg-violet-100 font-normal text-[10px]">Blending</Badge>
          </div>
        </div>
        {/* History + date always in top-right, never behind name */}
        <div className="flex items-center gap-1.5 shrink-0">
          {isManagerOrAdmin && (
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full text-muted-foreground"
              onClick={() => setShowHistory(true)} title="View blending history">
              <History className="h-3.5 w-3.5" />
            </Button>
          )}
          <label className="cursor-pointer relative">
            <span
              className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded px-3 py-1 font-mono-num whitespace-nowrap hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              onClick={(e) => {
                e.preventDefault();
                const el = dtInputRef.current;
                if (!el) return;
                if (typeof el.showPicker === 'function') {
                  try { el.showPicker(); } catch { el.focus(); }
                } else {
                  el.focus();
                }
              }}
            >
              {customDt ? new Date(customDt).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
              <CalendarClock className="h-3 w-3 shrink-0 opacity-70" />
            </span>
            <Input ref={dtInputRef} type="datetime-local" value={customDt} onChange={e => setCustomDt(e.target.value)}
              className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" title="Reading date & time" />
          </label>
        </div>
      </div>

      {/* Row 2: prev / today data — label adapts to mode for clarity */}
      <div className="text-xs text-muted-foreground">
        {inputMode === 'raw' ? (
          <>
            {/* Priority: localStorage → DB raw_meter_reading → daily vol fallback */}
            prev meter: <span className="font-mono-num" title={
              prevRawReading
                ? `Last cumulative reading on ${prevRawReading.date}`
                : dbLatestRaw
                  ? `Last cumulative reading on ${dbLatestRaw.date} (from DB)`
                  : previousDate ? `Last entry on ${previousDate} (daily vol)` : 'No prior reading'
            }>
              {prevCumulative != null ? fmtNum(prevCumulative) : '—'}
            </span>
            {(prevRawReading?.date ?? dbLatestRaw?.date ?? previousDate) && (
              <span className="text-muted-foreground/60 ml-1">({prevRawReading?.date ?? dbLatestRaw?.date ?? previousDate})</span>
            )}
          </>
        ) : (
          <>
            prev: <span className="font-mono-num" title={previousDate ? `last entry on ${previousDate}` : 'no prior blending entry'}>
              {previousVolume == null ? '—' : `${fmtNum(previousVolume)} m³`}
            </span>
            {previousDate && <span className="text-muted-foreground/60 ml-1">({previousDate})</span>}
          </>
        )}
        <span className="mx-1">·</span>
        today: <span className="font-mono-num">{fmtNum(todayVolume)} m³</span> logged
      </div>

      {/* Row 3: Raw/Direct mode toggle */}
      <div className="flex items-center gap-0">
        <button
          onClick={() => switchMode('direct')}
          className={`flex-1 py-1 text-[11px] font-medium rounded-l border transition-colors ${inputMode === 'direct' ? 'bg-violet-600 text-white border-violet-600' : 'bg-muted text-muted-foreground border-border hover:bg-muted/80'}`}
        >Direct m³</button>
        <button
          onClick={() => switchMode('raw')}
          className={`flex-1 py-1 text-[11px] font-medium rounded-r border-t border-b border-r transition-colors ${inputMode === 'raw' ? 'bg-violet-600 text-white border-violet-600' : 'bg-muted text-muted-foreground border-border hover:bg-muted/80'}`}
        >Raw Meter</button>
      </div>

      {/* Row 4: Input — drum roller (mobile + raw) or regular input */}
      {isMobile && inputMode === 'raw' ? (
        <div className="space-y-1.5">
          <OdometerRollerInput
            value={volume} onChange={setVolume}
            alertState={!volumeChanged ? 'neutral' : blendBelowPrev ? 'warn' : blendHighVol ? 'warn' : 'ok'}
            disabled={saving}
            testId={`blending-input-${well.id}`}
          />
          <div className="flex items-center justify-between text-[11px] px-0.5">
            <span className="text-muted-foreground">
              prev: <span className="font-mono-num">{prevCumulative != null ? fmtNum(prevCumulative) : '—'}</span>
            </span>
            {deltaRaw != null ? (
              <span className={`font-mono-num font-medium ${deltaRaw >= 0 ? 'text-violet-600' : 'text-destructive'}`}>
                Δ {fmtNum(deltaRaw)} m³
              </span>
            ) : isBaselineRaw ? (
              <span className="font-mono-num font-medium text-violet-500 text-[10px]">baseline entry</span>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="relative">
          <Droplet className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-violet-600 pointer-events-none" />
          <Input type="number" step="any" inputMode="decimal" value={volume}
            onChange={(e) => setVolume(e.target.value)}
            placeholder={inputMode === 'raw' ? 'Cumulative meter reading' : 'Blending m³'}
            className="h-9 pl-7 w-full border-violet-300 focus-visible:ring-violet-300 bg-violet-50/40 dark:bg-violet-950/20"
            data-testid={`blending-input-${well.id}`} />
          {inputMode === 'raw' && volume !== '' && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {deltaRaw != null ? (
                <>Δ <span className={`font-mono-num font-medium ${deltaRaw >= 0 ? 'text-violet-600' : 'text-destructive'}`}>{fmtNum(deltaRaw)} m³</span> will be saved</>
              ) : isBaselineRaw ? (
                <span className="text-violet-500">First reading — will be saved as baseline</span>
              ) : null}
            </p>
          )}
        </div>
      )}

      {/* Row 5: Save button — full-width on mobile */}
      <Button onClick={save} disabled={saving || !volumeChanged}
        className={isMobile ? 'w-full h-11 text-sm bg-teal-700 text-white hover:bg-teal-800 active:bg-teal-900 shadow-sm' : 'h-9 px-4 text-xs w-full bg-teal-700 text-white hover:bg-teal-800'}>
        {saving ? <Loader2 className={isMobile ? 'h-4 w-4 animate-spin' : 'h-3 w-3 animate-spin'} /> : 'Save'}
      </Button>

      {/* Warning banner */}
      {volume !== '' && (blendBelowPrev || blendHighVol) && (
        <div className="flex flex-col gap-1 text-xs bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 px-3 py-2 rounded-lg">
          <span className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            Verify before saving
          </span>
          {blendBelowPrev && (
            <span className="text-amber-700 dark:text-amber-400 pl-5">
              Reading is below the previous value — possible meter rollback or data entry error.
            </span>
          )}
          {blendHighVol && (
            <span className="text-amber-700 dark:text-amber-400 pl-5">
              Volume is more than {Math.round(ALERTS.avg_multiplier_warn * 100 - 100)}% above the reference — unusually high.
            </span>
          )}
        </div>
      )}

      {showHistory && (
        <ReadingHistoryDialog
          entityName={well.name}
          module="blending"
          entityId={well.id}
          plantId={plantId}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}

// ─── PRODUCT METER audit logger ──────────────────────────────────────────────

async function logProductMeterChange(entry: {
  plant_id: string;
  meter_id: string;
  meter_name: string;
  old_value: number | null;
  new_value: number | null;
  user_id: string | null;
  timestamp: string;
}) {
  try {
    await (supabase.from('product_meter_audit_log' as any) as any).insert([entry]);
  } catch { /* silently ignore if table missing */ }
}

