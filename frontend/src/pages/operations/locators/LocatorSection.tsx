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

const LOCATOR_SCHEMA = 'locator_name*, current_reading, reading_datetime (YYYY-MM-DDTHH:mm), previous_reading, input_mode (raw|direct), daily_volume';
const LOCATOR_TEMPLATE_ROW = {
  locator_name: 'MCWD - M1',
  current_reading: '1234.56',
  reading_datetime: '2024-06-15T08:30',
  previous_reading: '1200.00',
  input_mode: 'raw',
  daily_volume: '',
};

export function validateLocatorReadingRow(r: Record<string, string>, i: number): string[] {
  const e: string[] = [];
  if (!r.locator_name?.trim()) e.push(`Row ${i}: locator_name is required`);
  const isDirect = r.input_mode?.trim().toLowerCase() === 'direct';
  if (isDirect) {
    if (!r.daily_volume?.trim() || isNaN(Number(r.daily_volume)) || Number(r.daily_volume) <= 0)
      e.push(`Row ${i}: daily_volume must be a positive number when input_mode=direct`);
  } else {
    if (!r.current_reading?.trim() || isNaN(Number(r.current_reading)))
      e.push(`Row ${i}: current_reading must be a number`);
  }
  if (r.previous_reading && isNaN(Number(r.previous_reading)))
    e.push(`Row ${i}: previous_reading must be a number`);
  if (r.daily_volume && !isDirect && isNaN(Number(r.daily_volume)))
    e.push(`Row ${i}: daily_volume must be a number`);
  if (r.reading_datetime && isNaN(Date.parse(normalizeDatetime(r.reading_datetime))))
    e.push(`Row ${i}: reading_datetime is not a valid date`);
  return e;
}

async function insertLocatorReadings(
  rows: Record<string, string>[],
  plantId: string,
  userId: string | null,
): Promise<{ count: number; errors: string[]; affectedIds: string[] }> {
  // Resolve locator names → IDs (single query for the whole batch)
  const { data: locators } = await supabase
    .from('locators').select('id, name').eq('plant_id', plantId);
  const nameToId: Record<string, string> = {};
  (locators ?? []).forEach((l: any) => { nameToId[l.name.trim().toLowerCase()] = l.id; });

  // ── FIX: Batch duplicate check ───────────────────────────────────────────────
  // Old code did one SELECT per row inside the loop → 60 sequential round-trips
  // for a 60-row CSV, causing the import to hang/never finish.
  // New approach: resolve all locator IDs first, then fetch ALL existing readings
  // for those locators in a single query keyed by "locatorId|YYYY-MM-DDTHH:mm".
  const locatorIds = Object.values(nameToId);
  let existingByKey: Record<string, string> = {}; // "locatorId|dtMin" → reading id
  if (locatorIds.length > 0) {
    const { data: existingReadings } = await supabase
      .from('locator_readings')
      .select('id, locator_id, reading_datetime')
      .in('locator_id', locatorIds);
    (existingReadings ?? []).forEach((e: any) => {
      const key = `${e.locator_id}|${(e.reading_datetime as string).slice(0, 16)}`;
      existingByKey[key] = e.id;
    });
  }

  let count = 0;
  const errors: string[] = [];
  // ── HYBRID STRATEGY: track mutated entity IDs for targeted cache flush ──────
  const affectedIds = new Set<string>();

  for (const r of rows) {
    const locatorId = nameToId[r.locator_name?.trim().toLowerCase()];
    if (!locatorId) { errors.push(`Locator not found: "${r.locator_name}"`); continue; }

    const dt = r.reading_datetime ? new Date(normalizeDatetime(r.reading_datetime)).toISOString() : new Date().toISOString();
    const dtMin = dt.slice(0, 16); // minute-level key e.g. "2026-04-01T00:00"
    const dupKey = `${locatorId}|${dtMin}`;
    const existingId = existingByKey[dupKey];

    const isDirect = r.input_mode?.trim().toLowerCase() === 'direct';

    if (existingId) {
      // ── Duplicate: ask user then overwrite or skip ───────────────────────────
      const decision = await resolveImportDuplicate(dupKey, `${r.locator_name} @ ${dtMin}`);
      if (decision === 'skip') continue;

      // Build update payload.
      // FIX: daily_volume is a GENERATED ALWAYS column — omit it from UPDATE too;
      //      Postgres recomputes it automatically from current_reading - previous_reading.
      // Clear is_estimated: operator is entering actual data, overriding any regression estimate.
      const updatePayload: Record<string, any> = { reading_datetime: dt, recorded_by: userId, is_estimated: false };
      if (isDirect) {
        updatePayload.current_reading  = r.previous_reading ? +r.previous_reading : 0;
        updatePayload.previous_reading = r.previous_reading ? +r.previous_reading : null;
        // daily_volume omitted — generated column
      } else {
        const csvCurLoc  = +r.current_reading;
        const csvPrevLoc = r.previous_reading ? +r.previous_reading : null;
        updatePayload.current_reading  = csvCurLoc;
        updatePayload.previous_reading = csvPrevLoc;
        const rawLocDelta = csvPrevLoc != null ? csvCurLoc - csvPrevLoc : null;
        if (rawLocDelta != null && rawLocDelta < 0)
          errors.push(`Locator "${r.locator_name}" @ ${dtMin}: negative delta (${rawLocDelta.toFixed(2)}) — meter rollback detected.`);
        // daily_volume omitted — generated column
      }
      const { error } = await supabase.from('locator_readings').update(updatePayload).eq('id', existingId);
      if (error) errors.push(error.message); else { count++; existingByKey[dupKey] = existingId; }
      continue;
    }

    // ── New insert ────────────────────────────────────────────────────────────
    // FIX: daily_volume removed — it is a GENERATED ALWAYS AS column in Postgres
    //      (auto-computed as current_reading - previous_reading). Supplying it
    //      causes: "cannot insert a non-DEFAULT value into column daily_volume".
    //      plant_id IS required (NOT NULL constraint) — keep it.
    const insertPayload: Record<string, any> = {
      locator_id:       locatorId,
      plant_id:         plantId,
      reading_datetime: dt,
      recorded_by:      userId,
      is_estimated:     false, // operator-entered — never an estimate
    };

    if (isDirect) {
      // Direct m³ mode: user supplied daily volume explicitly.
      // Store current_reading = previous to preserve the cumulative sequence.
      insertPayload.current_reading  = r.previous_reading ? +r.previous_reading : 0;
      insertPayload.previous_reading = r.previous_reading ? +r.previous_reading : null;
      // daily_volume intentionally omitted — GENERATED ALWAYS column
    } else {
      // Raw cumulative meter mode
      const csvCurLoc2  = +r.current_reading;
      const csvPrevLoc2 = r.previous_reading ? +r.previous_reading : null;
      insertPayload.current_reading  = csvCurLoc2;
      insertPayload.previous_reading = csvPrevLoc2;
      const rawLocDelta2 = csvPrevLoc2 != null ? csvCurLoc2 - csvPrevLoc2 : null;
      if (rawLocDelta2 != null && rawLocDelta2 < 0)
        errors.push(`Locator "${r.locator_name}" @ ${dtMin}: negative delta (${rawLocDelta2.toFixed(2)}) — meter rollback detected.`);
      // daily_volume intentionally omitted — GENERATED ALWAYS column
    }

    const { error } = await supabase.from('locator_readings').insert(insertPayload);
    if (error) errors.push(error.message);
    else {
      count++;
      affectedIds.add(locatorId); // ── HYBRID: track for cache invalidation
      existingByKey[dupKey] = 'inserted'; // mark so intra-batch dups resolve correctly
    }
  }
  return { count, errors, affectedIds: Array.from(affectedIds) };
}

// Well readings:
// well_name*, current_reading*, reading_datetime, previous_reading, power_meter_reading, solar_meter_reading

export function LocatorReadingForm() {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const { user, isAdmin, isManager, isDataAnalyst } = useAuth();
  const [plantId, setPlantId] = useState('');
  const [importOpen, setImportOpen] = useState(false);

  // Fetch per-plant locator reading limit from Plant Configuration (manager-configurable)
  const { data: locatorReadingLimit } = useQuery({
    queryKey: ['plant-locator-limit', plantId],
    enabled: !!plantId,
    staleTime: 30_000,
    queryFn: async () => {
      try {
        const { data } = await (supabase.from('plant_meter_config' as any) as any)
          .select('config')
          .eq('plant_id', plantId)
          .maybeSingle();
        if (data?.config?.locator_readings_per_day != null) return data.config.locator_readings_per_day as number;
      } catch { /* table may not exist yet */ }
      try {
        const raw = localStorage.getItem(`plant_meter_config_${plantId}`);
        if (raw) {
          const cfg = JSON.parse(raw);
          if (cfg.locator_readings_per_day != null) return cfg.locator_readings_per_day as number;
        }
      } catch { /* ignore */ }
      return 3; // default
    },
  });
  const maxLocatorReadings = locatorReadingLimit ?? 3;

  const { data: locators } = useQuery({
    queryKey: ['op-locators', plantId],
    queryFn: async () => plantId
      ? (await supabase.from('locators').select('*').eq('plant_id', plantId).eq('status', 'Active').order('name')).data ?? []
      : [],
    enabled: !!plantId,
  });

  // BUG FIX: locator_readings has NO plant_id column — filtering by it returns 0 rows.
  // Two-step query: resolve active locator IDs for this plant, then fetch readings
  // by locator_id. This mirrors the fix already applied in TrendChart and Dashboard.
  const { data: _locatorIds } = useQuery({
    queryKey: ['op-locator-ids', plantId],
    queryFn: async () => {
      if (!plantId) return [] as string[];
      const { data } = await supabase
        .from('locators').select('id').eq('plant_id', plantId).eq('status', 'Active');
      return (data ?? []).map((l: any) => l.id as string);
    },
    enabled: !!plantId,
  });

  const { data: recentReadings } = useQuery({
    queryKey: ['op-loc-recent', plantId],
    queryFn: async () => {
      const locatorIds = _locatorIds ?? [];
      if (!locatorIds.length) return [];
      const start = new Date(); start.setDate(start.getDate() - 30);
      return (await supabase.from('locator_readings')
        .select('*').in('locator_id', locatorIds)
        .gte('reading_datetime', start.toISOString())
        .order('reading_datetime', { ascending: false })
        // Safety cap — PostgREST default is 1 000 rows; high-frequency plants
        // (e.g. hourly Mambaling: 24/day × 30d × N locators) can exceed that,
        // causing silent truncation. 5 000 covers even the most aggressive schedule.
        .limit(5000)).data ?? [];
    },
    enabled: !!plantId && (_locatorIds !== undefined),
    staleTime: 0,            // always treat cached data as stale on mount/focus
    refetchInterval: 30_000, // poll every 30 s so readings from other sessions appear
  });

  // ── Dedicated latest-reading query ────────────────────────────────────────
  // Fetches exactly ONE row per locator (the absolute newest), completely
  // independent of the 30-day window above.  This guarantees that `prev` in
  // the entry card always reflects the true latest reading even when the plant
  // has hourly readings and the 30-day dump would otherwise be truncated by
  // PostgREST's row limit.
  const { data: latestReadingsRaw } = useQuery({
    queryKey: ['op-loc-latest', _locatorIds],
    queryFn: async () => {
      const locatorIds = _locatorIds ?? [];
      if (!locatorIds.length) return [];
      // One lightweight query per locator — N is small (typically 1–10)
      const results = await Promise.all(
        locatorIds.map(id =>
          supabase.from('locator_readings')
            .select('*')
            .eq('locator_id', id)
            .order('reading_datetime', { ascending: false })
            .limit(1),
        ),
      );
      return results.flatMap(r => r.data ?? []);
    },
    enabled: !!plantId && !!_locatorIds?.length,
    staleTime: 0,
    refetchInterval: 30_000,
  });

  // latestByLocator — sourced from the dedicated query above, NOT from the
  // 30-day dump, so it is immune to row-limit truncation.
  const latestByLocator = useMemo(() => {
    const latest: Record<string, any> = {};
    latestReadingsRaw?.forEach((r: any) => { latest[r.locator_id] = r; });
    return latest;
  }, [latestReadingsRaw]);

  const { todayByLocator, avgByLocator } = useMemo(() => {
    const today: Record<string, any[]> = {};
    const avgs: Record<string, number | null> = {};
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    // 10-day window for average flow-rate computation (not 30-day raw volume)
    const tenDaysAgo = new Date(); tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    const readingsByLocator: Record<string, any[]> = {};
    recentReadings?.forEach((r: any) => {
      if (new Date(r.reading_datetime) >= startOfDay) (today[r.locator_id] ||= []).push(r);
      // Collect readings within the 10-day window for Q=V/t computation
      if (new Date(r.reading_datetime) >= tenDaysAgo)
        (readingsByLocator[r.locator_id] ||= []).push(r);
    });
    // Q = V / t — compute time-normalised flow rate (m³/hr) for each consecutive pair,
    // then average those rates so that readings taken at different intervals are comparable.
    for (const [locId, readings] of Object.entries(readingsByLocator)) {
      const sorted = [...readings].sort(
        (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
      );
      const flowRates: number[] = [];
      for (let i = 1; i < sorted.length; i++) {
        const vol = sorted[i].current_reading - sorted[i - 1].current_reading;
        const hrs = (new Date(sorted[i].reading_datetime).getTime() - new Date(sorted[i - 1].reading_datetime).getTime()) / 3_600_000;
        if (vol > 0 && hrs > 0) flowRates.push(vol / hrs);
      }
      avgs[locId] = flowRates.length ? flowRates.reduce((s, n) => s + n, 0) / flowRates.length : null;
    }
    return { todayByLocator: today, avgByLocator: avgs };
  }, [recentReadings]);

  return (
    <div className="space-y-3">
      {/* Plant selector card */}
      <Card className="p-4">
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Plant</Label>
            <PlantSelector value={plantId} onChange={setPlantId} />
          </div>
          {(isAdmin || isManager || isDataAnalyst) && plantId && (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 gap-1.5 h-10 border-teal-600/60 text-teal-700 hover:bg-teal-50 hover:border-teal-600 dark:hover:bg-teal-950/30"
              onClick={() => setImportOpen(true)}
              data-testid="import-locator-readings-btn"
            >
              <Upload className="h-3.5 w-3.5" />
              Import
            </Button>
          )}
        </div>
      </Card>

      {plantId && (
        <Card className="p-0 overflow-hidden">
          {/* Section header */}
          <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 text-teal-600" />
              <span className="text-xs font-semibold text-foreground/80 tracking-tight">Active Locators</span>
            </div>
            <span className="text-[11px] text-muted-foreground tabular-nums bg-muted px-2 py-0.5 rounded-full">
              {locators?.length ?? 0} total
            </span>
          </div>
          {locators?.length ? (
            <MobileCarousel
              isMobile={isMobile}
              items={locators ?? []}
              renderItem={(l: any) => (
                <LocatorRow
                  key={l.id}
                  locator={l} plantId={plantId}
                  previous={latestByLocator[l.id]?.current_reading ?? null}
                  previousDt={latestByLocator[l.id]?.reading_datetime ?? null}
                  todayReadings={todayByLocator[l.id] ?? []}
                  avgVol={avgByLocator[l.id] ?? null}
                  userId={user?.id}
                  onSaved={() => invalidateLocatorDash(qc)}
                  isManagerOrAdmin={isAdmin || isManager || isDataAnalyst}
                  maxReadingsPerDay={maxLocatorReadings}
                />
              )}
            />
          ) : (
            <p className="p-4 text-xs text-muted-foreground text-center">No active locators for this plant</p>
          )}
        </Card>
      )}

      {importOpen && (
        <ImportReadingsDialog
          title="Import Locator Readings from CSV"
          module="Locator Readings"
          plantId={plantId}
          userId={user?.id ?? null}
          schemaHint={LOCATOR_SCHEMA}
          templateFilename="locator_readings_template.csv"
          templateRow={LOCATOR_TEMPLATE_ROW}
          validateRow={validateLocatorReadingRow}
          insertRows={(rows, pid) => insertLocatorReadings(rows, pid, user?.id ?? null)}
          onClose={() => setImportOpen(false)}
          onImported={() => { setImportOpen(false); invalidateDashboard(qc); }}
        />
      )}
    </div>
  );
}

function LocatorRow({
  locator, plantId, previous, previousDt, todayReadings, avgVol, userId, onSaved, isManagerOrAdmin, maxReadingsPerDay = 3,
}: {
  locator: any; plantId: string; previous: number | null; previousDt: string | null;
  todayReadings: any[]; avgVol: number | null;
  userId: string | undefined; onSaved: () => void;
  isManagerOrAdmin: boolean;
  maxReadingsPerDay?: number;
}) {
  const isMobile = useIsMobile();

  const [reading, setReading]     = useState('');
  const lastPrefilledLoc = useRef<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving]       = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [customDt, setCustomDt]   = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));

  // Draft recovery — persists the reading input so an accidental navigation
  // or browser crash doesn't lose what the operator was entering.
  const { draft: draftReading, setDraft: setDraftReading, clearDraft: clearDraftReading } =
    useDraft(`loc-reading-${locator.id}`);
  useEffect(() => {
    if (reading === '' && draftReading) setReading(draftReading);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 'raw'  = user enters cumulative meter reading; delta = cur - prev
  // 'direct' = user enters daily m³ directly; stored as daily_volume
  const [locInputMode, setLocInputMode] = useState<'raw' | 'direct'>('raw');

  // Pre-fill the drum with the latest previous reading so the operator
  // starts from the real odometer value and rolls only the changed digits.
  //
  // Race-condition fix — two scenarios both produce stale display:
  //  (A) After save: setReading('') fires synchronously, effect pre-fills with
  //      OLD `previous` before 'op-loc-recent' refetches. When the query later
  //      returns NEW `previous`, reading !== '' so the effect no-ops → stale drum.
  //  (B) The 30-second poll (refetchInterval) on op-loc-recent fires and brings in
  //      a newer reading from another session — same no-op because reading !== ''.
  //  Fix: track the last auto-filled value in a ref. If `previous` changes and the
  //  drum still shows that old auto-fill (user hasn't touched it), update to latest.
  useEffect(() => {
    if (locInputMode !== 'raw' || previous == null || editingId) return;
    const expected = previous.toFixed(2);
    if (reading === '' || reading === lastPrefilledLoc.current) {
      setReading(expected);
      lastPrefilledLoc.current = expected;
    }
  }, [previous, locInputMode, editingId, reading]);

  const cur      = +reading || 0;
  // A reading that exactly equals previous is the pre-filled baseline, not a new entry.
  const readingChanged = reading !== '' && (previous == null || cur !== previous);
  const dailyVol = locInputMode === 'direct'
    ? (reading ? +reading : null)                      // entered value IS the delta
    : (readingChanged && previous != null ? cur - previous : null);
  const belowPrev = locInputMode === 'raw' && previous != null && cur > 0 && cur < previous;
  // Q = V / t: compute current flow rate (m³/hr) from delta ÷ hours since last reading.
  // avgVol is the 10-day average flow rate (m³/hr); warn when current rate exceeds avg × multiplier.
  const hoursElapsedLoc = previousDt && reading
    ? (new Date(customDt).getTime() - new Date(previousDt).getTime()) / 3_600_000
    : null;
  const currentFlowRateLoc = dailyVol != null && hoursElapsedLoc != null && hoursElapsedLoc > 0
    ? dailyVol / hoursElapsedLoc
    : null;
  const highVol = locInputMode === 'raw' && avgVol != null && currentFlowRateLoc != null
    && currentFlowRateLoc > avgVol * ALERTS.avg_multiplier_warn;
  const todayCount = todayReadings.length;
  const lastToday  = todayReadings[0] ?? null;
  const atLimit    = !editingId && todayCount >= maxReadingsPerDay;

  // ── Alert state for odometer drum ─────────────────────────────────────────
  const odometerAlert: OdometerAlertState =
    !readingChanged   ? 'neutral' :
    belowPrev         ? 'warn'    :
    highVol           ? 'warn'    :
    (+reading < 0 && locInputMode === 'raw') ? 'error' :
    'ok';

  // Tracks whether the last save was auto-quarantined as pending_review
  const [lastSavePending, setLastSavePending] = useState(false);
  // Cooldown: minutes left before operator can submit again for this locator
  const [cooldownMinutes, setCooldownMinutes] = useState(0);
  const [cooldownAvailableAt, setCooldownAvailableAt] = useState<Date | null>(null);

  const save = async () => {
    if (!reading) { toast.error(`${locator.name}: enter a reading`); return; }
    if (atLimit) { toast.error(`${locator.name}: max ${maxReadingsPerDay} readings/day reached`); return; }
    if (locInputMode === 'direct' && +reading <= 0) { toast.error(`${locator.name}: enter a positive volume`); return; }

    // ── Pre-flight guard: cooldown + backward/spike detection ────────────────
    // Mirrors the DB trigger logic (fn_locator_reading_integrity) so the UI can
    // give instant feedback before the round-trip. The trigger is the source of
    // truth; this is a UX convenience only.
    if (!editingId && userId) {
      setSaving(true);
      const guard = await evaluateReadingGuard(
        'locator', locator.id, plantId, userId,
        locInputMode === 'direct' ? (previous ?? cur) : cur,
        new Date(customDt), false, false, avgVol,
      );
      setSaving(false);

      if (guard.status === 'blocked' && guard.reason === 'cooldown') {
        setCooldownMinutes(guard.minutesLeft);
        setCooldownAvailableAt(guard.availableAt);
        toast.error(
          `${locator.name}: cooldown — next reading available in ${formatCooldown(guard.minutesLeft)}.`,
          { duration: 6000 },
        );
        return;
      }
      if (guard.status === 'pending_review') {
        // Save proceeds — DB trigger will also set pending_review independently.
        toast.info(`${locator.name}: ${guard.detail}`, { duration: 8000 });
      }
    }

    setSaving(true);
    let gps_lat = null, gps_lng = null, off = false;
    try {
      const pos = await getCurrentPosition();
      gps_lat = pos.coords.latitude; gps_lng = pos.coords.longitude;
      if (locator.gps_lat && locator.gps_lng)
        off = isOffLocation(gps_lat, gps_lng, locator.gps_lat, locator.gps_lng, 100);
    } catch (err) { console.warn('[Operations] geolocation unavailable:', err); }

    // NOTE: previous_reading is intentionally omitted from the payload.
    // The DB trigger fn_locator_reading_integrity() overwrites it with the last
    // confirmed (non-retracted, non-pending_review) reading. Sending it from
    // the client would be ignored by the trigger; omitting it makes the intent explicit
    // and prevents stale anchor values from leaking through if the trigger is disabled.
    const payload: any = locInputMode === 'direct'
      ? {
          locator_id: locator.id, plant_id: plantId,
          current_reading: previous ?? cur,
          // previous_reading: owned by DB trigger — DO NOT send from client
          gps_lat, gps_lng, off_location_flag: off, recorded_by: userId,
          reading_datetime: new Date(customDt).toISOString(),
          is_estimated: false,
        }
      : {
          locator_id: locator.id, plant_id: plantId,
          current_reading: cur,
          // previous_reading: owned by DB trigger — DO NOT send from client
          gps_lat, gps_lng, off_location_flag: off, recorded_by: userId,
          reading_datetime: new Date(customDt).toISOString(),
          is_estimated: false,
        };

    const { data: savedRow, error } = editingId
      ? await (supabase.from('locator_readings').update(payload).eq('id', editingId).select('norm_status,current_reading,previous_reading,daily_volume').single() as any)
      : await (supabase.from('locator_readings').insert(payload).select('norm_status,current_reading,previous_reading,daily_volume').single() as any);

    setSaving(false);

    if (error) {
      // 23505 = unique_violation: same user already submitted within this clock hour (SRP double-entry)
      if (error.code === '23505') {
        toast.error(
          `${locator.name}: a reading was already submitted within the last hour. Check the log before resubmitting.`,
          { duration: 8000 },
        );
      } else {
        toast.error(error.message);
      }
      return;
    }

    const isPending = savedRow?.norm_status === 'pending_review';
    setLastSavePending(isPending);
    setCooldownMinutes(0);
    setCooldownAvailableAt(null);

    if (isPending) {
      toast.info(`${locator.name}: reading saved and sent to supervisor for review.`, { duration: 6000 });
    } else {
      const curr = savedRow?.current_reading;
      const prev = savedRow?.previous_reading;
      const vol  = savedRow?.daily_volume;
      toast.success(fmtSaveToast(locator.name, editingId ? 'updated' : 'saved', curr, prev, vol), { duration: 5000 });
    }
    setReading(''); clearDraftReading(); setEditingId(null); onSaved();
  };

  // ── Shared action buttons row (edit / cancel / history) ────────────────────
  // Item 2: within 2h = free edit; 2h-7days = correction request sent to pending_review
  // Item 9: locked readings (approved by supervisor) cannot be self-edited regardless of age
  const lastTodayAge  = lastToday ? (Date.now() - new Date(lastToday.reading_datetime).getTime()) / 60_000 : Infinity;
  const isLocked      = !!(lastToday as any)?.locked_at;
  const canSelfEdit   = lastTodayAge <= 120 && !isLocked; // within 2 hours AND not locked
  const canRequest    = lastTodayAge > 120 && lastTodayAge < 7 * 24 * 60 && !isLocked; // 2h→7d AND not locked

  // Item 8: correction request target drives the dialog (replaces window.prompt)
  const [correctionTarget, setCorrectionTarget] = useState<CorrectionTarget | null>(null);

  const handleCorrectionRequest = () => {
    if (!lastToday) return;
    setCorrectionTarget({
      id:              lastToday.id,
      sourceTable:     'locator_readings',
      plantId:         plantId,
      entityName:      locator.name,
      currentReading:  lastToday.current_reading,
      previousReading: lastToday.previous_reading ?? null,
      dailyVolume:     lastToday.daily_volume ?? null,
      readingDatetime: lastToday.reading_datetime,
    });
  };

  const ActionButtons = (
    <>
      {lastToday && !editingId && canSelfEdit && (
        <Button variant="ghost" size="sm"
          className="h-10 w-10 p-0 rounded-lg shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted"
          onClick={() => { setEditingId(lastToday.id); setReading(String(lastToday.current_reading)); }}
          title={`Edit last reading (${fmtNum(lastToday.current_reading)})`}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}
      {editingId && (
        <Button variant="ghost" size="sm"
          className="h-10 w-10 p-0 rounded-lg shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          onClick={() => { setEditingId(null); setReading(''); }} title="Cancel edit">
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
      {isManagerOrAdmin && (
        <Button variant="ghost" size="sm"
          className="h-10 w-10 p-0 rounded-lg shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted"
          onClick={() => setShowHistory(true)} title="View reading history">
          <History className="h-3.5 w-3.5" />
        </Button>
      )}
      {/* Item 9: locked badge — reading approved by supervisor, cannot be edited */}
      {isLocked && lastToday && !editingId && (
        <span className="h-10 px-2 flex items-center text-[10px] font-medium text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800/40 rounded-lg gap-1 shrink-0">
          🔒 Locked
        </span>
      )}
      {/* Item 8: correction request — visible for entries 2h–7d old that aren't locked */}
      {lastToday && !editingId && canRequest && (
        <Button variant="ghost" size="sm"
          className="h-10 px-2.5 rounded-lg shrink-0 text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/20 text-xs font-medium gap-1.5"
          onClick={handleCorrectionRequest}
          title="Entry is older than 2 hours — submit a correction request for supervisor review">
          ✎ Fix
        </Button>
      )}
      {/* Item 8: CorrectionRequestDialog mounts when correctionTarget is set */}
      {correctionTarget && (
        <CorrectionRequestDialog
          target={correctionTarget}
          onClose={() => setCorrectionTarget(null)}
          onSubmitted={() => { setCorrectionTarget(null); onSaved(); }}
        />
      )}
    </>
  );

  return (
    <div className="px-4 py-3 space-y-2.5">
      {/* Row 1: Name + editing badge (full width — no truncation) */}
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground break-words">{locator.name}</div>
          {lastToday?.off_location_flag && (
            <StatusPill tone="warn"><MapPin className="h-3 w-3" /> off-site</StatusPill>
          )}
          {editingId && (
            <span className="text-[10px] font-semibold uppercase tracking-widest text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/40 px-1.5 py-0.5 rounded">Editing</span>
          )}
        </div>
        {/* Date picker always visible, not fighting for space with the name */}
        <label className="shrink-0 cursor-pointer relative">
          <span className="text-[11px] text-muted-foreground bg-muted border border-border/70 rounded-md px-2.5 py-1.5 font-mono-num whitespace-nowrap hover:bg-muted/80 transition-colors">
            {customDt ? new Date(customDt).toLocaleString([], { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—'}
          </span>
          <Input type="datetime-local" value={customDt} onChange={e => setCustomDt(e.target.value)}
            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" title="Reading date & time" />
        </label>
      </div>

      {/* Row 2: input mode toggle + status */}
      <div className="flex items-center gap-3">
        <div className="flex items-center rounded-lg border border-border overflow-hidden text-[10px] font-semibold shrink-0">
          <button type="button"
            onClick={() => { setLocInputMode('raw'); setReading(''); }}
            className={`px-2.5 py-1.5 transition-colors ${locInputMode === 'raw' ? 'bg-teal-700 text-white' : 'bg-transparent text-muted-foreground hover:bg-muted'}`}
            title="Cumulative meter reading — Δ auto-computed">Raw</button>
          <button type="button"
            onClick={() => { setLocInputMode('direct'); setReading(''); }}
            className={`px-2.5 py-1.5 transition-colors border-l border-border ${locInputMode === 'direct' ? 'bg-teal-700 text-white' : 'bg-transparent text-muted-foreground hover:bg-muted'}`}
            title="Enter daily m³ directly">Direct m³</button>
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {locInputMode === 'raw' ? (
            <>
              prev: <span className="font-mono-num text-foreground/80">{previous == null ? '—' : fmtNum(previous)}</span>
              {/* On mobile the delta is shown below the drum, so only show it inline on desktop */}
              {!isMobile && dailyVol != null && <> · Δ <span className="font-mono-num font-medium text-teal-700 dark:text-teal-400">{fmtNum(dailyVol)} m³</span></>}
              <span className="mx-1.5 text-border">·</span>
              <span className={atLimit ? 'text-warn-foreground font-medium' : 'text-muted-foreground'}>{todayCount}/{maxReadingsPerDay} today</span>
            </>
          ) : (
            <>
              {dailyVol != null ? <><span className="font-mono-num font-medium text-teal-700 dark:text-teal-400">{fmtNum(dailyVol)} m³</span> to save</> : <span className="text-muted-foreground/60">enter daily volume</span>}
              <span className="mx-1.5 text-border">·</span>
              <span className={atLimit ? 'text-warn-foreground font-medium' : 'text-muted-foreground'}>{todayCount}/{maxReadingsPerDay} today</span>
            </>
          )}
        </div>
      </div>

      {/* ── Row 3 (mobile raw mode): Odometer drum + current reading + save ── */}
      {isMobile && locInputMode === 'raw' ? (
        <div className="space-y-2">
          {/* Drum display */}
          <OdometerRollerInput
            value={reading}
            onChange={(v) => { setReading(v); setDraftReading(v); }}
            alertState={odometerAlert}
            disabled={saving || atLimit}
            testId={`loc-odometer-${locator.id}`}
          />

          {/* Current reading label + delta */}
          <div className="flex items-center justify-between text-xs px-0.5 min-h-[18px]">
            <span className="text-muted-foreground">
              Current:{' '}
              <span className={`font-mono-num font-semibold ${reading ? 'text-foreground' : 'text-muted-foreground/50'}`}>
                {reading ? (+reading).toFixed(2) : '—'}
              </span>
            </span>
            {dailyVol != null && (
              <span className="font-mono-num font-semibold text-teal-700 dark:text-teal-400">
                Δ {fmtNum(dailyVol)} m³
              </span>
            )}
          </div>

          {/* Save + action buttons */}
          <div className="flex items-center gap-2">
            <Button
              onClick={save} disabled={saving || !readingChanged || atLimit}
              className="flex-1 h-11 text-sm bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white shadow-sm"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId ? 'Update' : 'Save'}
            </Button>
            {ActionButtons}
          </div>
        </div>
      ) : (
        /* ── Row 3 (desktop or direct-mode): standard Input row ── */
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Droplet className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-teal-500 pointer-events-none" />
            <Input
              type="number" step="any" inputMode="decimal"
              value={reading} onChange={(e) => { setReading(e.target.value); setDraftReading(e.target.value); }}
              placeholder={locInputMode === 'direct' ? 'Daily volume (m³)' : 'Meter reading'}
              className="pl-8 h-10 bg-teal-50/30 dark:bg-teal-950/10 border-teal-200 dark:border-teal-800/50 focus-visible:ring-teal-500/30"
            />
          </div>
          <Button
            onClick={save} disabled={saving || !readingChanged || atLimit}
            className="h-10 px-4 text-sm shrink-0 bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white shadow-sm"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : editingId ? 'Update' : 'Save'}
          </Button>
          {ActionButtons}
        </div>
      )}

      {showHistory && (
        <ReadingHistoryDialog
          entityName={locator.name}
          module="locator"
          entityId={locator.id}
          onClose={() => setShowHistory(false)}
        />
      )}
      {cooldownMinutes > 0 && cooldownAvailableAt && (
        <div className="flex items-center gap-1.5 rounded-md bg-destructive/10 border border-destructive/30 px-2.5 py-1.5 text-xs text-destructive">
          <AlertCircle className="h-3 w-3 shrink-0" />
          Cooldown active — next reading available at{' '}
          {cooldownAvailableAt.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}{' '}
          ({cooldownMinutes} min remaining).
        </div>
      )}

      {lastSavePending && !cooldownMinutes && (
        <div className="flex items-center gap-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700 px-2.5 py-1.5 text-xs text-amber-800 dark:text-amber-300">
          <AlertCircle className="h-3 w-3 shrink-0" />
          Last reading sent for supervisor review — excluded from totals until approved.
        </div>
      )}

      {reading && (belowPrev || highVol) && !lastSavePending && (
        <div className="flex flex-col gap-1 text-xs bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 px-3 py-2 rounded-lg">
          <span className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {belowPrev ? 'Below previous — will go to supervisor review after save.' : `Flow rate ${Math.round(ALERTS.avg_multiplier_warn * 100 - 100)}% above avg — will go to supervisor review after save.`}
          </span>
          {belowPrev && (
            <span className="text-amber-700 dark:text-amber-400 pl-5">
              If the meter was replaced, use the meter replacement toggle.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── WELL ────────────────────────────────────────────────────────────────────

// ─── SharedPowerMeterRow ──────────────────────────────────────────────────────
// Shown once per shared-power-meter group, above the member wells.
// Saves the raw kWh reading to the primary well's record for that day.
function SharedPowerMeterRow({
  groupName, primaryWellId, plantId, previousPower, userId, onSaved,
}: {
  groupName: string;
  primaryWellId: string;
  plantId: string;
  previousPower: number | null;
  userId: string | undefined;
  onSaved: () => void;
}) {
  const [reading, setReading] = useState('');
  // Draft recovery — restores the power meter value if the operator navigates away accidentally
  const { draft: draftReading, setDraft: setDraftReading, clearDraft: clearDraftReading } =
    useDraft(`shared-power-${primaryWellId}`);
  // Restore draft on mount if input is empty
  useEffect(() => { if (!reading && draftReading) setReading(draftReading); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [saving, setSaving] = useState(false);
  const [customDt, setCustomDt] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));

  const save = async () => {
    if (!reading) { toast.error(`${groupName}: enter a power meter reading`); return; }
    setSaving(true);
    const val = +reading;
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);

    // Check if primary well already has a reading today — update it if so
    const { data: todayRecs } = await supabase
      .from('well_readings')
      .select('id')
      .eq('well_id', primaryWellId)
      .gte('reading_datetime', startOfDay.toISOString())
      .order('reading_datetime', { ascending: false })
      .limit(1);

    if (todayRecs?.length) {
      const { error } = await supabase.from('well_readings')
        .update({ power_meter_reading: val })
        .eq('id', (todayRecs[0] as any).id);
      setSaving(false);
      if (error) { toast.error(error.message); return; }
    } else {
      // No water reading yet for today — insert a standalone power record
      const { error } = await supabase.from('well_readings').insert({
        well_id: primaryWellId,
        plant_id: plantId,
        current_reading: previousPower ?? 0,
        power_meter_reading: val,
        recorded_by: userId,
        reading_datetime: new Date(customDt).toISOString(),
      } as any);
      setSaving(false);
      if (error) { toast.error(error.message); return; }
    }

    toast.success(`${groupName}: power meter saved`);
    setReading(''); clearDraftReading();
    onSaved();
  };

  return (
    /* ── Shared meter group header — owns the kWh input ── */
    <div className="border-b border-amber-200/80 dark:border-amber-800/40 bg-amber-50/60 dark:bg-amber-950/20">
      {/* Title bar */}
      <div className="flex items-center gap-2.5 px-4 pt-3 pb-2">
        <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-900/40 shrink-0">
          <Zap className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-sm font-semibold text-foreground tracking-tight truncate">{groupName}</span>
          <span className="text-[9px] font-bold uppercase tracking-widest bg-amber-200/70 dark:bg-amber-800/50 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded-full shrink-0">
            Shared Meter
          </span>
        </div>
        {/* Date picker */}
        <label className="shrink-0 cursor-pointer relative">
          <span className="text-[11px] text-muted-foreground bg-muted border border-border/70 rounded-md px-2.5 py-1.5 font-mono-num whitespace-nowrap hover:bg-muted/80 transition-colors">
            {customDt ? new Date(customDt).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
          </span>
          <Input type="datetime-local" value={customDt}
            onChange={e => setCustomDt(e.target.value)}
            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
            title="Reading date & time" />
        </label>
      </div>

      {/* kWh input */}
      <div className="flex items-center gap-3 px-4 pb-3">
        <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
          prev: <span className="font-mono-num font-medium text-foreground/80">{previousPower == null ? '—' : fmtNum(previousPower)}</span>
        </span>
        <div className="relative flex-1">
          <Zap className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-amber-500 pointer-events-none" />
          <Input type="number" step="any" inputMode="decimal" value={reading}
            onChange={e => { setReading(e.target.value); setDraftReading(e.target.value); }} placeholder="Shared power kWh"
            className="h-10 pl-8 w-full border-amber-200 dark:border-amber-800/50 focus-visible:ring-amber-400/40 bg-white/70 dark:bg-amber-950/30 placeholder:text-muted-foreground/50"
            data-testid={`shared-power-input-${primaryWellId}`} />
        </div>
        <Button onClick={save} disabled={saving || !reading}
          className="h-10 px-4 text-sm shrink-0 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white shadow-sm border-0">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
        </Button>
      </div>
    </div>
  );
}
