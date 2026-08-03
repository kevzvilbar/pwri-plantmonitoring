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
import { format, subDays } from 'date-fns';
import { MapPin, Pencil, X, Droplet, Zap, Upload, Download, FileText, AlertCircle, Loader2, History, Gauge, FlaskConical, Keyboard, CalendarClock } from 'lucide-react';

// High-voltage transmission tower icon — matches Plants.tsx grid icon exactly.

import { OdometerRollerInput, MobileCarousel } from '@/components/OdometerRollerInput';
import {
  parseCSVText, triggerTemplateDownload, normalizeDatetime,
  clearDupDecisions, clearBulkDupDecision, ImportReadingsDialog, resolveImportDuplicate,
} from '@/components/ReadingImportDialog';
import { ReadingHistoryDialog } from '@/components/ReadingHistoryDialog';
import {
  GridPylonIcon, WELL_MAX_READINGS_PER_DAY, READING_COOLDOWN_MINUTES, SPIKE_MULTIPLIER,
  formatCooldown, invalidateLocatorDash, invalidateWellDash, invalidateDashboard,
  invalidateProductMeterDash, invalidatePowerDash, invalidateRODash, invalidateChemDash,
} from '../shared';
import { useBlendingWells } from '../shared';

// Blending wells are always metered — there is no such thing as a blending
// source with no physical meter, so daily volume is always derived as a
// delta between two cumulative readings. volume_m3 is no longer an accepted
// direct-entry column; raw_meter_reading is required on every row.
const BLENDING_SCHEMA =
  'well_name*,  raw_meter_reading* (cumulative),  ' +
  'previous_reading (prev cumulative — auto-detected if omitted),  ' +
  'event_date (YYYY-MM-DD),  reading_datetime (YYYY-MM-DDTHH:mm)';

const BLENDING_TEMPLATE_ROW = {
  well_name:          'Well #2',
  raw_meter_reading:  '12345.00',   // ← required: current cumulative meter reading
  previous_reading:   '12195.00',   //   optional: previous cumulative value (auto-detected if omitted)
  event_date:         '2024-06-15',
  reading_datetime:   '2024-06-15T08:30',
};

export function validateBlendingRow(r: Record<string, string>, i: number): string[] {
  const e: string[] = [];
  if (!r.well_name?.trim()) e.push(`Row ${i}: well_name is required`);

  const hasRaw = !!r.raw_meter_reading?.trim();

  if (!hasRaw)
    e.push(`Row ${i}: raw_meter_reading (cumulative meter) is required — blending wells are metered, volume is always computed as a delta`);
  if (hasRaw && (isNaN(Number(r.raw_meter_reading)) || Number(r.raw_meter_reading) < 0))
    e.push(`Row ${i}: raw_meter_reading must be a non-negative number`);
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
  // If nothing is found here, previous_reading is simply omitted from the
  // write — trg_blending_set_reading (20260729_blending_previous_reading_
  // trigger.sql) resolves it from the well's own history on INSERT, or
  // correctly treats it as a genuine baseline (0 m³ logged) if none exists
  // anywhere. Nothing here ever stores the raw reading itself as a volume.
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

    // ── Client-side delta preview — this is validation only now (fast,
    // per-row error messages before a round trip), not what actually gets
    // stored. trg_blending_set_reading (20260729_blending_previous_reading_
    // trigger.sql) owns volume_m3 server-side; the client never writes it.
    if (!r.raw_meter_reading?.trim()) {
      errors.push(`${r.well_name} @ ${eventDate}: raw_meter_reading is required — row skipped.`);
      continue;
    }
    const curRaw = +r.raw_meter_reading;
    initPrevRaw(wellId);

    // Determine previous: explicit CSV column wins, then batch-tracked, then localStorage
    const prevRaw: number | null =
      r.previous_reading?.trim() ? +r.previous_reading
      : prevRawByWell[wellId] ?? null;

    if (prevRaw != null) {
      const previewDelta = curRaw - prevRaw;
      if (previewDelta < 0) {
        errors.push(
          `${r.well_name} @ ${eventDate}: negative delta ${previewDelta.toFixed(2)} m³ ` +
          `(raw ${curRaw} − prev ${prevRaw}) — meter rollback? Row skipped.`,
        );
        continue;
      }
      if (previewDelta === 0) {
        errors.push(
          `${r.well_name} @ ${eventDate}: delta is 0 (current reading equals previous ${curRaw}). Row skipped.`,
        );
        continue;
      }
    }

    // Advance the batch tracker so the next row for this well uses this reading
    prevRawByWell[wellId] = curRaw;
    pendingRawPersist[wellId] = { reading: curRaw, date: eventDate };

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
          .update({ plant_id: plantId, well_name: r.well_name, plant_name: plantName,
            raw_meter_reading: curRaw,
            ...(_rdIso ? { reading_datetime: _rdIso } : {}),
            ...(prevRaw != null ? { previous_reading: prevRaw } : {}) })
          .eq('id', existingRec[0].id));
      } else {
        ({ error: insErr } = await (supabase.from('blending_events' as any) as any)
          .insert({ well_id: wellId, plant_id: plantId, well_name: r.well_name, plant_name: plantName,
            event_date: eventDate,
            ...(_rdIso ? { reading_datetime: _rdIso } : {}),
            raw_meter_reading: curRaw,
            ...(prevRaw != null ? { previous_reading: prevRaw } : {}) }));
      }
      if (insErr) throw new Error(insErr.message);
      count++;
    } catch (e) {
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
      // Ported from the old FastAPI /api/blending/volume route's `by_well`
      // computation — same 14-day window, same per-well today/previous-day
      // fields — just read directly from blending_events now.
      const span = 14;
      const base = new Date();
      const today = format(base, 'yyyy-MM-dd');
      const since = format(subDays(base, span - 1), 'yyyy-MM-dd');

      let q = supabase.from('blending_events' as any).select('*').gte('event_date', since);
      if (plantId) q = q.eq('plant_id', plantId);
      const { data: events } = await q;

      const byWell = new Map<string, {
        well_id: string; volume_m3: number; today_volume_m3: number;
        previous_volume_m3: number | null; previous_event_date: string | null;
      }>();

      for (const ev of (events ?? []) as any[]) {
        const day = String(ev.event_date ?? '').slice(0, 10);
        const vol = Number(ev.volume_m3) || 0;
        const wid = ev.well_id || '';
        if (!wid) continue;
        if (!byWell.has(wid)) {
          byWell.set(wid, {
            well_id: wid, volume_m3: 0, today_volume_m3: 0,
            previous_volume_m3: null, previous_event_date: null,
          });
        }
        const cur = byWell.get(wid)!;
        cur.volume_m3 += vol;
        if (day === today) {
          cur.today_volume_m3 += vol;
        } else if (day && day < today) {
          const prevDay = cur.previous_event_date;
          if (prevDay === null || day > prevDay) {
            cur.previous_event_date = day;
            cur.previous_volume_m3 = vol;
          }
        }
      }

      const byWellList = Array.from(byWell.values())
        .sort((a, b) => b.volume_m3 - a.volume_m3)
        .map((w) => ({
          ...w,
          volume_m3: Math.round(w.volume_m3 * 100) / 100,
          today_volume_m3: Math.round(w.today_volume_m3 * 100) / 100,
          previous_volume_m3: w.previous_volume_m3 !== null ? Math.round(w.previous_volume_m3 * 100) / 100 : null,
        }));

      return { by_well: byWellList };
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

  // ── Summary strip — supervisors scanning several wells need at-a-glance
  // totals more than the per-well detail; the old "N tagged" pill only gave
  // one of the three numbers they'd actually want.
  const loggedTodayCount = useMemo(
    () => blendingWells.filter((w) => (todayByWell[w.id] ?? 0) > 0).length,
    [blendingWells, todayByWell],
  );
  const totalTodayM3 = useMemo(
    () => blendingWells.reduce((sum, w) => sum + (todayByWell[w.id] ?? 0), 0),
    [blendingWells, todayByWell],
  );

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
              className="shrink-0 gap-1.5 h-10 border-primary/60 text-primary hover:bg-primary-soft hover:border-primary/90"
              onClick={() => setImportOpen(true)}
              data-testid="import-blending-readings-btn"
            >
              <Upload className="h-3.5 w-3.5" />
              Import
            </Button>
          )}
        </div>
      </Card>

      {plantId && blendingWells.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <Card className="p-3.5">
            <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Tagged wells</div>
            <div className="text-2xl font-semibold mt-1 tabular-nums">{blendingWells.length}</div>
          </Card>
          <Card className="p-3.5">
            <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Logged today</div>
            <div className="text-2xl font-semibold mt-1 tabular-nums">
              {loggedTodayCount}<span className="text-muted-foreground font-normal">/{blendingWells.length}</span>
            </div>
          </Card>
          <Card className="p-3.5">
            <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Total blended today</div>
            <div className="text-2xl font-semibold mt-1 tabular-nums text-primary">{fmtNum(totalTodayM3)} m³</div>
          </Card>
        </div>
      )}

      {plantId && (
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Gauge className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold text-foreground/80 tracking-tight">Blending Wells</span>
            </div>
            <span className="text-xs text-muted-foreground tabular-nums bg-muted px-2 py-0.5 rounded-full">{blendingWells.length} tagged</span>
          </div>
          {blendingWells.length ? (
            // Two-column responsive grid on desktop cuts scrolling once a plant
            // has more than 2–3 blending wells; MobileCarousel keeps its own
            // swipeable single-item layout on mobile (its `!isMobile` branch
            // just returns a fragment, so this grid governs desktop only).
            <div className={isMobile ? '' : 'grid grid-cols-1 lg:grid-cols-2 gap-3 p-3'}>
              <MobileCarousel
                isMobile={isMobile}
                items={blendingWells}
                renderItem={(w) => (
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
            </div>
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
// Blending wells are always metered — there's no raw/direct mode choice to
// persist any more, only the last cumulative meter reading entered, so the
// Δ calculation and "prev" hint are correct on the next visit.
// The DB only stores the computed daily-volume delta — it has no cumulative
// column — so localStorage is the only reliable source for the previous raw value.
function getBlendingRawKey(wellId: string)  { return `blending-raw-${wellId}`; }

function readPersistedRaw(wellId: string): { reading: number; date: string } | null {
  try {
    const v = localStorage.getItem(getBlendingRawKey(wellId));
    return v ? JSON.parse(v) : null;
  } catch { return null; }
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
  const [volume, setVolumeRaw] = useState('');
  const lastPrefilledBlend = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [customDt, setCustomDt] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const dtInputRef = useRef<HTMLInputElement>(null);

  // Status-chip support: reflects an optimistic "Logged today" immediately on
  // a successful save, ahead of the todayVolume query refetch landing. Cleared
  // the moment the operator starts editing a new value.
  const [justSaved, setJustSaved] = useState(false);
  const setVolume = (v: string) => { setVolumeRaw(v); setJustSaved(false); };

  // Blending wells are always metered — there is no direct-volume input mode.
  // The previous *cumulative* meter reading is not stored in the DB (the DB
  // only keeps the computed daily-volume delta). Read it from localStorage
  // where it was written on the last successful save for this well.
  const [prevRawReading, setPrevRawReading] = useState<{ reading: number; date: string } | null>(
    () => readPersistedRaw(well.id),
  );

  // Pre-fill the drum with the last persisted raw reading so the operator
  // starts from the real odometer value and rolls only the changed digits.
  // Priority: localStorage (most recent) → DB latest raw_meter_reading (fallback for
  // new devices / cleared storage) → nothing (first-ever entry).
  // Race-condition fix: same pattern as LocatorRow / WellRow — track last auto-fill
  // in a ref so a poll-driven update to prevRawReading also updates the drum when
  // the user hasn't yet typed anything.
  useEffect(() => {
    const src = prevRawReading?.reading ?? dbLatestRaw?.reading ?? null;
    if (src == null) return;
    const expected = src.toFixed(2);
    if (volume === '' || volume === lastPrefilledBlend.current) {
      setVolumeRaw(expected);
      lastPrefilledBlend.current = expected;
    }
  }, [prevRawReading, dbLatestRaw, volume]);

  // Δ uses the persisted cumulative reading first, then the DB-fetched
  // raw_meter_reading (for cross-device consistency), finally falling back to
  // the API-supplied previousVolume (daily m³ — less accurate for cumulative
  // meters, but better than showing nothing).
  const prevCumulative: number | null =
    prevRawReading?.reading ?? dbLatestRaw?.reading ?? previousVolume ?? null;

  const deltaRaw = volume !== ''
    ? prevCumulative != null ? +volume - prevCumulative : null
    : null;

  // Allow saving a baseline reading (storeVol = +volume) when no prior
  // cumulative reading exists yet — e.g. first entry ever for this well.
  const isBaselineRaw = prevCumulative == null && volume !== '' && +volume > 0;
  const volumeChanged = volume !== '' && (isBaselineRaw || (deltaRaw != null && deltaRaw > 0));

  // ── Warning flags (mirrors well / locator logic) ───────────────────────────
  const blendBelowPrev = deltaRaw != null && deltaRaw < 0;
  // Above-average: compare current entry volume against avgVol (or previousVolume as
  // fallback reference) scaled by the shared ALERTS multiplier.
  const avgRef = avgVol ?? previousVolume;
  const blendHighVol = avgRef != null && deltaRaw != null
    && deltaRaw > avgRef * ALERTS.avg_multiplier_warn;

  // ── Status chip: "Not logged" → "Ready to save" → "Logged today" ──────────
  // Replaces having to parse "prev: — · today: 0 m³ logged" — the color alone
  // now tells a supervisor scanning many wells what state each one is in.
  const chipState: 'pending' | 'ready' | 'logged' =
    (todayVolume > 0 || justSaved) ? 'logged' : volumeChanged ? 'ready' : 'pending';

  // ── Live preview of what Save will actually commit ─────────────────────────
  let previewLine: React.ReactNode = null;
  if (volume !== '' && deltaRaw != null) {
    previewLine = (
      <>Δ <span className={`font-semibold ${deltaRaw >= 0 ? 'text-kpi-ro' : 'text-destructive'}`}>{fmtNum(deltaRaw)} m³</span> will be saved</>
    );
  } else if (isBaselineRaw) {
    previewLine = (
      <>First reading — <span className="font-semibold text-kpi-ro">{fmtNum(+volume)} m³</span> will be saved as baseline</>
    );
  }

  const save = async () => {
    const eventDate = customDt.slice(0, 10);

    // Client-side preview/guard only — mirrors deltaRaw when a previous
    // reading is known, or the raw entry itself as a placeholder when this
    // looks like a first-ever reading. What actually gets stored is decided
    // server-side by trg_blending_set_reading, which correctly logs 0 m³ for
    // a genuine baseline rather than the full reading.
    const storeVol = deltaRaw != null ? deltaRaw : +volume;

    if (!volume || !(storeVol > 0)) {
      if (deltaRaw != null && deltaRaw <= 0) {
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
        // previous_reading intentionally omitted on UPDATE — carries forward
        // unchanged (trg_blending_set_reading only auto-resolves it on
        // INSERT), so correcting a typo'd reading here never re-baselines it.
        // volume_m3 is never sent; the trigger recomputes it from
        // raw_meter_reading / previous_reading on every write.
        ({ error } = await (supabase.from('blending_events' as any) as any)
          .update({ plant_id: plantId, well_name: well.name, plant_name: plantName,
            reading_datetime: new Date(customDt).toISOString(),
            raw_meter_reading: +volume })
          .eq('id', existing[0].id));
      } else {
        ({ error } = await (supabase.from('blending_events' as any) as any)
          .insert({ well_id: well.id, plant_id: plantId, well_name: well.name, plant_name: plantName,
            event_date: eventDate, reading_datetime: new Date(customDt).toISOString(),
            raw_meter_reading: +volume,
            ...(prevCumulative != null ? { previous_reading: prevCumulative } : {}) }));
      }
      if (error) throw error;

      // Persist the cumulative meter reading locally so the next save can
      // compute the correct Δ. Purely a same-device UX cache now — the
      // trigger is the actual source of truth for what gets stored.
      persistRaw(well.id, +volume, eventDate);
      setPrevRawReading({ reading: +volume, date: eventDate });
      // Reset the pre-fill guard so the drum auto-fills with the new "prev"
      // value after setVolume('') clears the input.
      lastPrefilledBlend.current = null;

      toast.success(`${well.name}: meter reading saved${deltaRaw != null ? ` (Δ ${fmtNum(deltaRaw)} m³)` : ''}`);
      setVolume('');
      setJustSaved(true);

      // Invalidate dashboard so stat cards refresh immediately.
      invalidateWellDash(qc, [well.id]);
      onSaved();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally { setSaving(false); }
  };

  return (
    <div
      className="p-3.5 space-y-2.5 border border-border rounded-xl hover:border-muted-foreground/40 transition-colors bg-card"
      data-testid={`blending-row-${well.id}`}
    >
      {/* Row 1: Well name + badge + history icon (always visible) */}
      <div className="flex items-start gap-2 min-w-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium break-words">{well.name}</span>
            <Badge className="bg-kpi-ro/15 text-kpi-ro border-kpi-ro hover:bg-kpi-ro/15 font-normal text-2xs">Blending</Badge>
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
              className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded px-3 py-1 font-mono-num whitespace-nowrap hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
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
              className="absolute inset-0 opacity-0 w-full h-full pointer-events-none" title="Reading date & time" tabIndex={-1} />
          </label>
        </div>
      </div>

      {/* Row 2: prev / today data (left) + status chip (right) — the chip
          replaces having to parse "prev: — · today: 0 m³ logged" for state;
          color reads at a glance, the text alongside it keeps the real numbers. */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs text-muted-foreground">
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
          <span className="mx-1">·</span>
          today: <span className="font-mono-num">{fmtNum(todayVolume)} m³</span>
        </div>

        {chipState === 'logged' && (
          <span className="inline-flex items-center gap-1 text-2xs font-semibold px-2 py-0.5 rounded-full bg-accent-soft text-accent shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-current" />Logged today
          </span>
        )}
        {chipState === 'ready' && (
          <span className="inline-flex items-center gap-1 text-2xs font-semibold px-2 py-0.5 rounded-full bg-kpi-ro/15 text-kpi-ro shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-current" />Ready to save
          </span>
        )}
        {chipState === 'pending' && (
          <span className="inline-flex items-center gap-1 text-2xs font-semibold px-2 py-0.5 rounded-full bg-warn-soft text-warn shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-current" />Not logged
          </span>
        )}
      </div>

      {/* Row 3: Input — drum roller (mobile) or regular input. Blending wells
          are always metered, so this is always a cumulative meter reading —
          there is no direct-volume alternative to switch to. */}
      {isMobile ? (
        <div className="space-y-1">
          <OdometerRollerInput
            value={volume} onChange={setVolume}
            alertState={!volumeChanged ? 'neutral' : blendBelowPrev ? 'warn' : blendHighVol ? 'warn' : 'ok'}
            disabled={saving}
            testId={`blending-input-${well.id}`}
          />
          <div className="text-xs text-muted-foreground px-0.5">
            prev: <span className="font-mono-num">{prevCumulative != null ? fmtNum(prevCumulative) : '—'}</span>
          </div>
        </div>
      ) : (
        <div className="relative">
          <Droplet className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-kpi-ro pointer-events-none" />
          <Input type="number" step="any" inputMode="decimal" value={volume}
            onChange={(e) => setVolume(e.target.value)}
            placeholder="Cumulative meter reading"
            className="h-9 pl-7 w-full border-kpi-ro focus-visible:ring-violet-300 bg-kpi-ro/40"
            data-testid={`blending-input-${well.id}`} />
        </div>
      )}

      {/* Live preview of what Save will actually commit — sits right above
          the button so the Δ that's about to be written is never a surprise. */}
      {previewLine && (
        <div className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-kpi-ro/15 border border-kpi-ro">
          {previewLine}
        </div>
      )}

      {/* Row 5: Save button — full-width on mobile */}
      <Button onClick={save} disabled={saving || !volumeChanged}
        className={isMobile ? 'w-full h-11 text-sm bg-primary text-white hover:bg-primary/90 active:bg-primary shadow-sm' : 'h-9 px-4 text-xs w-full bg-primary text-white hover:bg-primary/90'}>
        {saving ? <Loader2 className={isMobile ? 'h-4 w-4 animate-spin' : 'h-3 w-3 animate-spin'} /> : 'Save'}
      </Button>

      {/* Warning banner */}
      {volume !== '' && (blendBelowPrev || blendHighVol) && (
        <div className="flex flex-col gap-1 text-xs bg-warn-soft border border-warn px-3 py-2 rounded-lg">
          <span className="flex items-center gap-1.5 font-semibold text-warn">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            Verify before saving
          </span>
          {blendBelowPrev && (
            <span className="text-warn pl-5">
              Reading is below the previous value — possible meter rollback or data entry error.
            </span>
          )}
          {blendHighVol && (
            <span className="text-warn pl-5">
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

