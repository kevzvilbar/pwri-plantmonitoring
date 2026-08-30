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
import { MapPin, Pencil, X, Droplet, Zap, Upload, Download, FileText, AlertCircle, Loader2, History, Gauge, FlaskConical, Keyboard, CalendarClock, MessageCircleOff, ArrowUpRight, Lock, SquarePen } from 'lucide-react';
import { MetaStrip } from '@/components/operations/MetaStrip';
import { ControlCluster } from '@/components/operations/ControlCluster';
import { cn } from '@/lib/utils';
import { ReasonDialog } from '@/components/ReasonDialog';
import { reasonCategoryLabel } from '@/lib/reasonCodes';
import { resolveBlendingDateContext } from '@/lib/blendingBackdate';
import { latestRaw } from '@/lib/blendingRawCache';

// High-voltage transmission tower icon — matches Plants.tsx grid icon exactly.

import { OdometerRollerInput, MobileCarousel } from '@/components/OdometerRollerInput';
import {
  computeRate, computeRollingAverageRateFromDeltas, classifyDeviation, MIN_ELAPSED_DAYS,
  type VolumePoint,
} from '@/lib/flowRateGuards';
import { AnomalyRemarkBanner } from '@/components/AnomalyRemarkBanner';
import { submitAnomalyRemark, isAnomalyRemarkValid } from '@/lib/anomalyRemarks';
import {
  parseCSVText, triggerTemplateDownload, normalizeDatetime,
  clearDupDecisions, clearBulkDupDecision, ImportReadingsDialog, resolveImportDuplicate,
} from '@/components/ReadingImportDialog';
import { ReadingHistoryDialog } from '@/components/ReadingHistoryDialog';
import {
  GridPylonIcon, WELL_MAX_READINGS_PER_DAY,
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
      // Resolve reading_datetime from CSV: prefer reading_datetime column, fall back to event_date
      const _csvDt = r.reading_datetime?.trim() ? normalizeDatetime(r.reading_datetime.trim()) : null;
      const _rdIso = _csvDt && !isNaN(Date.parse(_csvDt)) ? new Date(_csvDt).toISOString() : null;
      // Atomic upsert via fn_blending_upsert_reading (INSERT ... ON CONFLICT
      // (well_id, event_date) DO UPDATE) — replaces the old select-then-
      // insert/update pair, which left a race window where two concurrent
      // imports/saves for the same well+day could each pass the "does it
      // exist?" check before either had written, producing two rows for the
      // same well/day. See 20260809_blending_events_dedupe_and_unique_constraint.sql.
      const { error: insErr } = await supabase.rpc('fn_blending_upsert_reading' as any, {
        p_well_id: wellId, p_plant_id: plantId, p_well_name: r.well_name, p_plant_name: plantName,
        p_event_date: eventDate,
        p_reading_datetime: _rdIso,
        p_raw_meter_reading: curRaw,
        p_previous_reading: prevRaw,
        p_update_previous_reading: true, // CSV always carries prevRaw through on overwrite, same as before
      });
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
    by_well: {
      well_id: string; volume_m3: number; today_volume_m3: number;
      previous_volume_m3: number | null; previous_event_date: string | null;
      avg_rate_m3_per_day: number | null;
    }[];
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
      const { data: events, error } = await q;
      if (error) throw error;

      const byWell = new Map<string, {
        well_id: string; volume_m3: number; today_volume_m3: number;
        previous_volume_m3: number | null; previous_event_date: string | null;
        byDay: Map<string, number>;
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
            byDay: new Map(),
          });
        }
        const cur = byWell.get(wid)!;
        cur.volume_m3 += vol;
        cur.byDay.set(day, (cur.byDay.get(day) ?? 0) + vol);
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
        .map((w) => {
          // Q = V / t at day granularity — blending_events only stores a
          // DATE (event_date), not a timestamp, so hours aren't available;
          // each calendar day with events becomes one point, and each
          // point's rate is that day's TOTAL volume ÷ days since the
          // previous day WITH an event (not ÷1, so a day with no blending
          // event doesn't silently get treated as "0 that day" or get
          // smeared into a false same-length gap the way a plain average
          // of volume_m3 across events would).
          const points: VolumePoint[] = Array.from(w.byDay.entries())
            .map(([day, volume]) => ({ volume, at: new Date(`${day}T00:00:00`) }));
          const avgRate = computeRollingAverageRateFromDeltas(points, span, MIN_ELAPSED_DAYS, 86_400_000);
          return {
            well_id: w.well_id,
            volume_m3: Math.round(w.volume_m3 * 100) / 100,
            today_volume_m3: Math.round(w.today_volume_m3 * 100) / 100,
            previous_volume_m3: w.previous_volume_m3 !== null ? Math.round(w.previous_volume_m3 * 100) / 100 : null,
            previous_event_date: w.previous_event_date,
            avg_rate_m3_per_day: avgRate,
          };
        });

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
  // Real rolling-average rate (m³/day), distinct from prevByWell's single
  // most-recent-day snapshot above. Was: avgVol was literally just
  // prevByWell[...].volume reused — i.e. "the average" was one prior day's
  // volume, not an average of anything, and not normalized for gap days
  // between blending events (blending_events only stores a DATE, so this is
  // day-granularity, not hourly, like the other odometer inputs — see
  // computeRollingAverageRateFromDeltas's call above with 86_400_000ms/day).
  const avgRateByWell = useMemo(() => {
    const m: Record<string, number | null> = {};
    for (const w of volumeData?.by_well ?? []) m[w.well_id] = w.avg_rate_m3_per_day ?? null;
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

  // "No reading — why?" gap reasons logged for today, keyed by well ID.
  // Mirrors WellSection.tsx / LocatorSection.tsx — entity_type here is
  // 'blending', not 'well', because a well's regular well_readings gap and
  // its blending_events gap are two separate things (see the migration
  // adding 'blending' to reading_gap_reasons' entity_type check).
  const todayDateStr = format(new Date(), 'yyyy-MM-dd');
  const { data: gapReasons } = useQuery({
    queryKey: ['blending-gap-reasons', plantId, todayDateStr],
    enabled: !!plantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reading_gap_reasons' as any)
        .select('*')
        .eq('plant_id', plantId)
        .eq('entity_type', 'blending')
        .eq('gap_date', todayDateStr);
      if (error) return [];
      return (data ?? []) as any[];
    },
  });
  const gapReasonsByWell = useMemo(() => {
    const m: Record<string, any> = {};
    (gapReasons ?? []).forEach((g: any) => { m[g.entity_id] = g; });
    return m;
  }, [gapReasons]);

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
            <Label htmlFor="blendingsection-plant" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Plant</Label>
            <PlantSelector value={plantId} onChange={setPlantId} id="blendingsection-plant" />
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
                    avgVol={avgRateByWell[w.id] ?? null}
                    dbLatestRaw={latestRawByWell[w.id] ?? null}
                    userId={user?.id ?? null}
                    gapReason={gapReasonsByWell[w.id] ?? null}
                    onGapReasonSaved={() => qc.invalidateQueries({ queryKey: ['blending-gap-reasons', plantId, todayDateStr] })}
                    onSaved={() => {
                      qc.invalidateQueries({ queryKey: ['blending-today', plantId] });
                      qc.invalidateQueries({ queryKey: ['blending-latest-raw', plantId] });
                      qc.invalidateQueries({ queryKey: ['blending-volume'] });
                    }}
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
  well, plantId, plantName, todayVolume, previousVolume, previousDate, avgVol, dbLatestRaw, userId, gapReason, onGapReasonSaved, onSaved,
}: {
  well: any; plantId: string; plantName?: string;
  todayVolume: number; previousVolume: number | null; previousDate: string | null;
  avgVol?: number | null;
  dbLatestRaw?: { reading: number; date: string } | null;
  userId?: string | null;
  gapReason?: any | null;
  onGapReasonSaved?: () => void;
  onSaved: () => void;
}) {
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const [volume, setVolumeRaw] = useState('');
  const lastPrefilledBlend = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [gapDialogOpen, setGapDialogOpen] = useState(false);
  const [gapSaving, setGapSaving] = useState(false);
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
  // Source: whichever of localStorage / DB latest raw_meter_reading is
  // actually more recent by date (see latestRaw above) — not localStorage
  // unconditionally.
  // Race-condition fix: same pattern as LocatorRow / WellRow — track last auto-fill
  // in a ref so a poll-driven update to prevRawReading also updates the drum when
  // the user hasn't yet typed anything.
  useEffect(() => {
    const src = latestRaw(prevRawReading, dbLatestRaw)?.reading ?? null;
    if (src == null) return;
    const expected = src.toFixed(2);
    if (volume === '' || volume === lastPrefilledBlend.current) {
      setVolumeRaw(expected);
      lastPrefilledBlend.current = expected;
    }
  }, [prevRawReading, dbLatestRaw, volume]);

  // Self-heal the per-device cache: if the DB's latest reading for this well
  // is newer than what's cached on this device, adopt it (and re-persist it
  // locally). Without this, a stale local cache — e.g. left over from a
  // manual save weeks ago, on a device that never received the newer entries
  // saved elsewhere or imported elsewhere — shadows the fresher DB value
  // indefinitely, since localStorage here is otherwise only ever written by
  // this device's own Save button.
  useEffect(() => {
    if (dbLatestRaw && (!prevRawReading || dbLatestRaw.date > prevRawReading.date)) {
      setPrevRawReading(dbLatestRaw);
      persistRaw(well.id, dbLatestRaw.reading, dbLatestRaw.date);
    }
  }, [dbLatestRaw, prevRawReading, well.id]);

  // Δ uses the persisted cumulative reading first, then the DB-fetched
  // raw_meter_reading (for cross-device consistency), finally falling back to
  // the API-supplied previousVolume (daily m³ — less accurate for cumulative
  // meters, but better than showing nothing).
  const eventDate = customDt.slice(0, 10);
  const todayDateStr = format(new Date(), 'yyyy-MM-dd');
  const isBackdated = eventDate !== todayDateStr;

  // When the operator backdates (picks a date other than today), the
  // sources above are the well's GLOBALLY latest reading — not the reading
  // that was actually current as of the selected date. Comparing a
  // backfilled Aug 13 entry against an already-logged Aug 15 reading
  // produces a nonsensical negative delta and permanently blocks Save
  // (volumeChanged below requires deltaRaw > 0), even though the entry may
  // be perfectly valid. This mirrors trg_blending_set_reading's own
  // resolution (latest event_date strictly before the selected one) so the
  // preview/warning/Save-gating here agree with what the server would
  // derive — and reports whether a reading already exists ON the selected
  // date, so the "No reading — why?" affordance below can key off the date
  // actually being edited instead of assuming "today".
  // limit(2) + lte (rather than two separate queries) gets both answers —
  // "does this exact date already have a reading" and "what's the true
  // predecessor" — in one round trip: sorted desc, an exact match for
  // eventDate (the largest date <= eventDate) always sorts first, so the
  // next row that doesn't match eventDate is necessarily the predecessor.
  const { data: backdatedContext, isLoading: backdatedContextLoading } = useQuery({
    queryKey: ['blending-backdated-context', well.id, eventDate],
    enabled: isBackdated,
    queryFn: async () => {
      const { data, error } = await (supabase.from('blending_events' as any) as any)
        .select('raw_meter_reading, event_date')
        .eq('well_id', well.id)
        .lte('event_date', eventDate)
        .not('raw_meter_reading', 'is', null)
        .order('event_date', { ascending: false })
        .limit(2);
      if (error) return { existingForDate: null, predecessor: null };
      return resolveBlendingDateContext((data ?? []) as { raw_meter_reading: number; event_date: string }[], eventDate);
    },
    staleTime: 15_000,
  });

  // "No reading — why?" for the currently selected date. Today keeps using
  // the form-level batched query (gapReason prop, keyed to todayDateStr —
  // cheap because it's fetched once for all wells together). Backdating
  // needs its own per-row lookup since eventDate varies per-row/per-
  // interaction and can't be usefully batched at the form level.
  const { data: backdatedGapReason } = useQuery({
    queryKey: ['blending-gap-reason-for-date', well.id, eventDate],
    enabled: isBackdated,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reading_gap_reasons' as any)
        .select('*')
        .eq('plant_id', plantId)
        .eq('entity_type', 'blending')
        .eq('entity_id', well.id)
        .eq('gap_date', eventDate)
        .maybeSingle();
      if (error) return null;
      return data;
    },
    staleTime: 15_000,
  });
  const effectiveGapReason = isBackdated ? backdatedGapReason : gapReason;
  const hasReadingForSelectedDate = isBackdated ? !!backdatedContext?.existingForDate : todayVolume > 0;

  const prevCumulative: number | null = isBackdated
    ? (backdatedContext?.predecessor?.reading ?? null)
    : (latestRaw(prevRawReading, dbLatestRaw)?.reading ?? previousVolume ?? null);

  const deltaRaw = volume !== ''
    ? prevCumulative != null ? +volume - prevCumulative : null
    : null;

  // Allow saving a baseline reading (storeVol = +volume) when no prior
  // cumulative reading exists yet — e.g. first entry ever for this well.
  const isBaselineRaw = prevCumulative == null && volume !== '' && +volume > 0;
  const volumeChanged = volume !== '' && (isBaselineRaw || (deltaRaw != null && deltaRaw > 0));

  // ── Warning flags (mirrors well / locator logic) ───────────────────────────
  const blendBelowPrev = deltaRaw != null && deltaRaw < 0;
  // Q = V / t at day granularity — blending_events is keyed one row per
  // (well, day), so "t" here is days since the previous row for this well,
  // not a fixed 1. avgVol is now avgRateByWell (m³/day, a real rolling
  // average — see the query above), not the single previous day's volume it
  // used to be, so a gap of several days between blending events no longer
  // makes every entry after it look like a huge, false spike.
  const prevDateStr = isBackdated
    ? (backdatedContext?.predecessor?.date ?? null)
    : (latestRaw(prevRawReading, dbLatestRaw)?.date ?? previousDate ?? null);
  const daysElapsedBlend = prevDateStr
    ? (new Date(`${eventDate}T00:00:00`).getTime() - new Date(`${prevDateStr}T00:00:00`).getTime()) / 86_400_000
    : null;
  const blendRate = computeRate(deltaRaw, daysElapsedBlend, MIN_ELAPSED_DAYS);
  const deviationBlend = classifyDeviation(blendRate, avgVol ?? null, ALERTS.blending_spike_multiplier);
  const blendHighVol = deviationBlend.tier !== 'ok';
  // Required whenever the rate falls outside ±50% of the rolling average
  // (see flowRateGuards.ts) — cleared after every successful save.
  const [anomalyRemark, setAnomalyRemark] = useState('');
  const anomalyRemarkRequired = blendHighVol && !isAnomalyRemarkValid(anomalyRemark);

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
    if (anomalyRemarkRequired) {
      toast.error(`${well.name}: this reading is outside the normal range — add a remark before saving.`);
      return;
    }
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
    setSaving(true);
    try {
      // Atomic upsert via fn_blending_upsert_reading (INSERT ... ON CONFLICT
      // (well_id, event_date) DO UPDATE) — replaces the old select-then-
      // insert/update pair, which left a race window where two concurrent
      // saves for the same well+day (double-click, retry, two people saving
      // around the same time) could each pass the "does it exist?" check
      // before either had written, producing two rows for the same well/day.
      // See 20260809_blending_events_dedupe_and_unique_constraint.sql.
      // p_update_previous_reading: false — previous_reading is intentionally
      // left untouched when this resolves to an UPDATE (trg_blending_set_reading
      // only auto-resolves it on INSERT), so correcting a typo'd reading here
      // never re-baselines it from a client-tracked value — same behaviour
      // as the old manual UPDATE branch. volume_m3 is never sent; the
      // trigger recomputes it from raw_meter_reading / previous_reading on
      // every write.
      // p_previous_reading: null when backdating — this may be a brand new
      // INSERT (no row yet for well_id + eventDate), and prevCumulative here
      // is already the correct chronological predecessor for display, but
      // trusting it as a literal value risks drift if another entry landed
      // between the query above and this write. Passing null instead lets
      // trg_blending_set_reading resolve it itself, from the same
      // (event_date < eventDate) lookup, at the actual moment of insert —
      // and trg_blending_readings_chain (AFTER trigger) independently
      // re-derives and confirms it either way, so this can't drift from
      // what ends up stored. Today's entry is unchanged — still sends its
      // own prevCumulative as before.
      const { data: savedId, error } = await supabase.rpc('fn_blending_upsert_reading' as any, {
        p_well_id: well.id, p_plant_id: plantId, p_well_name: well.name, p_plant_name: plantName,
        p_event_date: eventDate, p_reading_datetime: new Date(customDt).toISOString(),
        p_raw_meter_reading: +volume,
        p_previous_reading: isBackdated ? null : prevCumulative,
        p_update_previous_reading: false,
      });
      if (error) throw error;

      // Best-effort — the reading itself already saved successfully above,
      // this never blocks or rolls it back. See flowRateGuards.ts. Note:
      // blending_events has no norm_status column, so unlike locator/well/
      // product/RO, a 'critical' reading here still isn't auto-queued for
      // supervisor review — just remarked and visually flagged. See the
      // `escalates={false}` passed to AnomalyRemarkBanner below.
      if (blendHighVol && savedId) {
        void submitAnomalyRemark({
          table_name: 'blending_events',
          record_id: savedId,
          plant_id: plantId,
          tier: deviationBlend.tier as 'needs_remark' | 'critical',
          direction: deviationBlend.direction!,
          deviation_pct: deviationBlend.deviationPct!,
          flow_rate: deviationBlend.rate,
          avg_flow_rate: deviationBlend.avgRate,
          rate_unit: 'm3/day',
          remark_text: anomalyRemark,
        });
      }
      setAnomalyRemark('');

      // Persist the cumulative meter reading locally so the next save can
      // compute the correct Δ. Purely a same-device UX cache now — the
      // trigger is the actual source of truth for what gets stored.
      // Guarded by date: a backdated fill-in for an earlier gap (eventDate
      // older than what's already cached) must never regress this cache
      // backward — that cache also seeds the prefill + Δ baseline for
      // today's entry, and overwriting it with an older reading would
      // corrupt that baseline the next time this well is opened.
      const cachedDate = latestRaw(prevRawReading, dbLatestRaw)?.date ?? null;
      if (!cachedDate || eventDate >= cachedDate) {
        persistRaw(well.id, +volume, eventDate);
        setPrevRawReading({ reading: +volume, date: eventDate });
        // Reset the pre-fill guard so the drum auto-fills with the new "prev"
        // value after setVolume('') clears the input.
        lastPrefilledBlend.current = null;
      }

      toast.success(`${well.name}: meter reading saved${deltaRaw != null ? ` (Δ ${fmtNum(deltaRaw)} m³)` : ''}`);
      setVolume('');
      setJustSaved(true);

      // Invalidate dashboard so stat cards refresh immediately, plus the
      // date-aware queries above — a partial key matches every eventDate
      // cached for this well, so this covers whichever date(s) the operator
      // looks at next without needing to know which one just changed.
      invalidateWellDash(qc, [well.id]);
      qc.invalidateQueries({ queryKey: ['blending-backdated-context', well.id] });
      qc.invalidateQueries({ queryKey: ['blending-gap-reason-for-date', well.id] });
      onSaved();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally { setSaving(false); }
  };

  // "No reading — why?" — same (entity_type, entity_id, gap_date) upsert
  // pattern as WellRow / LocatorRow, entity_type: 'blending' instead of
  // 'well' (see 20260815000000_reading_gap_reasons_add_blending.sql).
  // Keyed to eventDate (the currently selected date), not hardcoded to
  // today, so this also covers logging a reason for a backdated gap —
  // eventDate already equals todayDateStr in the default case, so this is
  // a strict generalization, not a behavior change for that path.
  const saveGapReason = async (category: string, detail: string) => {
    setGapSaving(true);
    const { error } = await supabase.from('reading_gap_reasons' as any).upsert(
      [{
        entity_type: 'blending', entity_id: well.id, plant_id: plantId,
        gap_date: eventDate, reason_category: category, reason_detail: detail || null,
        logged_by: userId ?? null,
      }] as any,
      { onConflict: 'entity_type,entity_id,gap_date' },
    );
    setGapSaving(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success(`${well.name}: reason logged`);
    setGapDialogOpen(false);
    qc.invalidateQueries({ queryKey: ['blending-gap-reason-for-date', well.id, eventDate] });
    onGapReasonSaved?.();
  };

  return (
    <div
      className="instrument-housing p-4 space-y-3 border border-border/80 rounded-2xl mb-3 shadow-xs"
      data-testid={`blending-row-${well.id}`}
    >
      {/* Row 1: Well name + Prioritized MetaStrip + ControlCluster + date */}
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
          <span className="text-sm font-bold text-foreground break-words">{well.name}</span>
          <MetaStrip
            primary={
              <Badge className="bg-kpi-ro/20 text-kpi-ro border-kpi-ro/40 hover:bg-kpi-ro/20 font-semibold text-2xs rounded-full">
                Blending
              </Badge>
            }
            alerts={[
              chipState === 'logged' && {
                tone: 'accent',
                label: 'Logged today',
              },
              chipState === 'ready' && {
                tone: 'default',
                label: 'Ready to save',
              },
              chipState === 'pending' && {
                tone: 'warn',
                label: 'Not logged',
              },
            ].filter(Boolean)}
            overflow={[
              hasReadingForSelectedDate === false && !justSaved && !(isBackdated && backdatedContextLoading) && {
                icon: MessageCircleOff,
                label: effectiveGapReason ? reasonCategoryLabel(effectiveGapReason.reason_category) : (isBackdated ? `Log gap for ${eventDate}` : 'Log gap reason'),
                onClick: () => setGapDialogOpen(true),
                testId: `blending-gap-reason-btn-${well.id}`,
              },
            ].filter(Boolean)}
            maxVisible={3}
          />
        </div>

        {/* Controls & Date */}
        <div className="flex items-center gap-2 shrink-0">
          <ControlCluster
            actions={[
              {
                icon: History,
                title: 'View blending history',
                onClick: () => setShowHistory(true),
              },
            ]}
          />
          <label className="cursor-pointer relative">
            <span
              className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground bg-muted border border-border/70 rounded-full px-3 py-1 font-mono-num whitespace-nowrap hover:bg-muted/80 hover:text-foreground transition-colors"
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
              className="peer absolute inset-0 opacity-0 w-full h-full pointer-events-none" title="Reading date & time" />
          </label>
        </div>
      </div>

      {/* Row 2: Recessed Telemetry Panel */}
      <div className="recessed-glass p-2.5 sm:p-3 flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs text-muted-foreground">
          prev meter: <span className="font-mono-num font-semibold text-foreground" title={
            isBackdated
              ? (backdatedContextLoading
                  ? 'Looking up the reading before this date…'
                  : backdatedContext?.predecessor
                    ? `Last cumulative reading before ${eventDate}, on ${backdatedContext.predecessor.date}`
                    : `No reading before ${eventDate} — this would be the well's earliest known reading`)
              : prevRawReading
                ? `Last cumulative reading on ${prevRawReading.date}`
                : dbLatestRaw
                  ? `Last cumulative reading on ${dbLatestRaw.date} (from DB)`
                  : previousDate ? `Last entry on ${previousDate} (daily vol)` : 'No prior reading'
          }>
            {isBackdated && backdatedContextLoading ? '…' : prevCumulative != null ? fmtNum(prevCumulative) : '—'}
          </span>
          {prevDateStr && (
            <span className="text-muted-foreground/60 ml-1">({prevDateStr})</span>
          )}
          <span className="mx-1.5 text-border">·</span>
          today: <span className="font-mono-num font-semibold text-primary">{fmtNum(todayVolume)} m³</span>
        </div>
      </div>

      {/* Row 3: Input — drum roller (mobile) or regular input */}
      {isMobile ? (
        <div className="space-y-2">
          <OdometerRollerInput
            value={volume} onChange={setVolume}
            alertState={!volumeChanged ? 'neutral' : blendBelowPrev ? 'warn' : blendHighVol ? 'warn' : 'ok'}
            disabled={saving}
            testId={`blending-input-${well.id}`}
          />
          <div className="text-xs text-muted-foreground px-1">
            prev: <span className="font-mono-num font-semibold text-foreground">{prevCumulative != null ? fmtNum(prevCumulative) : '—'}</span>
          </div>
        </div>
      ) : (
        <div className="relative">
          <Droplet className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-kpi-ro pointer-events-none" />
          <Input type="number" step="any" inputMode="decimal" value={volume}
            onChange={(e) => setVolume(e.target.value)}
            placeholder="Cumulative meter reading"
            className="h-11 pl-9 w-full rounded-xl border-kpi-ro/30 focus-visible:ring-kpi-ro bg-kpi-ro/10 font-mono-num font-medium"
            data-testid={`blending-input-${well.id}`} />
        </div>
      )}

      {/* Live preview of what Save will actually commit */}
      {previewLine && (
        <div className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl bg-kpi-ro/15 border border-kpi-ro/30 text-kpi-ro font-medium">
          {previewLine}
        </div>
      )}

      {/* Save button */}
      <Button onClick={save} disabled={saving || !volumeChanged || anomalyRemarkRequired || (isBackdated && backdatedContextLoading)}
        style={{ '--confirm-glow': 'hsl(var(--kpi-ro, 271 81% 56%) / 0.5)' } as React.CSSProperties}
        className={cn(
          'w-full sm:w-auto h-11 px-6 rounded-full text-sm font-semibold bg-kpi-ro hover:bg-kpi-ro/90 active:scale-[0.98] text-white shadow-sm transition-all',
          justSaved && 'animate-gauge-confirm',
        )}
        data-testid={`blending-save-${well.id}`}
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : isBackdated ? `Save reading for ${eventDate}` : 'Save reading'}
      </Button>

      {/* Warning banner */}
      {volume !== '' && blendBelowPrev && (
        <div className="flex flex-col gap-1 text-xs bg-warn-soft border border-warn px-3 py-2 rounded-lg">
          <span className="flex items-center gap-1.5 font-semibold text-warn">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            Verify before saving
          </span>
          <span className="text-warn pl-5">
            Reading is below the previous value — possible meter rollback or data entry error.
          </span>
        </div>
      )}

      {volume !== '' && !blendBelowPrev && blendHighVol && (
        <AnomalyRemarkBanner
          result={deviationBlend}
          label={well.name}
          unit="m3/day"
          windowDays={14}
          remark={anomalyRemark}
          onRemarkChange={setAnomalyRemark}
          escalates={false}
        />
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

      <ReasonDialog
        open={gapDialogOpen}
        onOpenChange={setGapDialogOpen}
        title={isBackdated
          ? `No blending reading for "${well.name}" on ${eventDate} — why?`
          : `No blending reading today for "${well.name}" — why?`}
        description={isBackdated
          ? `This explains the gap on ${eventDate}. If you have the real meter reading for that day instead, enter it above and Save — that takes priority over this note.`
          : 'This explains the gap for today. If a reading comes in later today, it takes priority over this note.'}
        confirmLabel="Log reason"
        busy={gapSaving}
        onConfirm={(category, detail) => saveGapReason(category, detail)}
      />
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

