import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { PlantSelector } from '@/components/PlantSelector';
import { useBlendingWells } from '../shared';
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
import { Checkbox } from '@/components/ui/checkbox';
import { StatusPill } from '@/components/StatusPill';
import { fmtNum, getCurrentPosition, isOffLocation, ALERTS } from '@/lib/calculations';
import { fmtSaveToast } from '@/lib/format';
import { findExistingReading } from '@/lib/duplicateCheck';
import { downloadCSV } from '@/lib/csv';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { MapPin, Pencil, X, Droplet, Zap, Upload, Download, FileText, AlertCircle, Loader2, History, Gauge, FlaskConical, Keyboard, MessageCircleOff } from 'lucide-react';

// High-voltage transmission tower icon — matches Plants.tsx grid icon exactly.

import { OdometerRollerInput, MobileCarousel, type OdometerAlertState } from '@/components/OdometerRollerInput';
import { evaluateReadingGuard } from '@/lib/readingGuards';
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
import { ReasonDialog } from '@/components/ReasonDialog';
import { reasonCategoryLabel } from '@/lib/reasonCodes';

const WELL_SCHEMA = 'well_name*, current_reading*, reading_datetime (YYYY-MM-DDTHH:mm), previous_reading, tds_ppm, turbidity_ntu, pressure_psi';
const WELL_TEMPLATE_ROW = {
  well_name: 'Well #1',
  current_reading: '5678.90',
  reading_datetime: '2024-06-15T08:30',
  previous_reading: '5600.00',
  tds_ppm: '',
  turbidity_ntu: '',
  pressure_psi: '',
};

export function validateWellReadingRow(r: Record<string, string>, i: number): string[] {
  const e: string[] = [];
  if (!r.well_name?.trim()) e.push(`Row ${i}: well_name is required`);
  if (!r.current_reading?.trim() || isNaN(Number(r.current_reading)))
    e.push(`Row ${i}: current_reading must be a number`);
  if (r.previous_reading && isNaN(Number(r.previous_reading)))
    e.push(`Row ${i}: previous_reading must be a number`);
  if (r.tds_ppm && isNaN(Number(r.tds_ppm)))
    e.push(`Row ${i}: tds_ppm must be a number`);
  if (r.turbidity_ntu && isNaN(Number(r.turbidity_ntu)))
    e.push(`Row ${i}: turbidity_ntu must be a number`);
  if (r.pressure_psi && isNaN(Number(r.pressure_psi)))
    e.push(`Row ${i}: pressure_psi must be a number`);
  if (r.reading_datetime && isNaN(Date.parse(normalizeDatetime(r.reading_datetime))))
    e.push(`Row ${i}: reading_datetime is not a valid date`);
  return e;
}

// PERFORMANCE FIX: the previous version did one SELECT (duplicate check) and
// one INSERT/UPDATE *per CSV row*, sequentially awaited in a for-loop — i.e.
// up to 2×N round-trips to Supabase for an N-row file. Each round-trip pays
// full network latency, so a 500-row import (roughly a year of daily
// readings) could take minutes. This version:
//   1. Resolves all duplicates in ONE batched query instead of N.
//   2. Splits rows into "new" vs "duplicate" up front.
//   3. Inserts all new rows in chunked bulk INSERTs instead of one at a time,
//      falling back to per-row inserts only for a chunk that errors, so a
//      single bad row can't silently swallow the rest of a good chunk.
//   4. Only genuine duplicates still go through the interactive per-row
//      overwrite/skip prompt + individual UPDATE — which is correct, since
//      that step needs the user's decision and can't be batched, but is
//      normally a small minority of rows in a typical import.
const INSERT_CHUNK_SIZE = 200;

async function insertWellReadings(
  rows: Record<string, string>[],
  plantId: string,
  userId: string | null,
): Promise<{ count: number; errors: string[] }> {
  const { data: wells } = await supabase
    .from('wells').select('id, name').eq('plant_id', plantId);
  const nameToId: Record<string, string> = {};
  (wells ?? []).forEach((w: any) => { nameToId[w.name.trim().toLowerCase()] = w.id; });

  let count = 0;
  const errors: string[] = [];

  // ── Pass 1: resolve well_id + normalised datetime for every row up front ──
  type Resolved = { r: Record<string, string>; wellId: string; dt: string; dtMin: string };
  const resolved: Resolved[] = [];
  for (const r of rows) {
    const wellId = nameToId[r.well_name?.trim().toLowerCase()];
    if (!wellId) { errors.push(`Well not found: "${r.well_name}"`); continue; }
    const dt = r.reading_datetime ? new Date(normalizeDatetime(r.reading_datetime)).toISOString() : new Date().toISOString();
    resolved.push({ r, wellId, dt, dtMin: dt.slice(0, 16) });
  }
  if (resolved.length === 0) return { count, errors };

  // ── Pass 2: ONE batched query for every existing reading that could collide,
  // instead of one SELECT per row. Bounded to the wells + date range actually
  // present in this file. ──
  const wellIds = Array.from(new Set(resolved.map(x => x.wellId)));
  const dtValues = resolved.map(x => x.dt).sort();
  const rangeStart = dtValues[0].slice(0, 10) + 'T00:00:00';
  const rangeEnd   = dtValues[dtValues.length - 1].slice(0, 10) + 'T23:59:59';

  const { data: existingRows } = await supabase
    .from('well_readings')
    .select('id, well_id, reading_datetime')
    .in('well_id', wellIds)
    .gte('reading_datetime', rangeStart)
    .lte('reading_datetime', rangeEnd);

  const existingByKey = new Map<string, string>(); // `${well_id}|${dtMin}` -> reading id
  (existingRows ?? []).forEach((row: any) => {
    const key = `${row.well_id}|${new Date(row.reading_datetime).toISOString().slice(0, 16)}`;
    existingByKey.set(key, row.id);
  });

  // ── Pass 3: split into duplicates (need the interactive prompt + individual
  // UPDATE) vs new rows (safe to bulk-insert). ──
  const toInsert: Record<string, any>[] = [];

  for (const { r, wellId, dt, dtMin } of resolved) {
    const existingId = existingByKey.get(`${wellId}|${dtMin}`);

    if (existingId) {
      const decision = await resolveImportDuplicate(`${wellId}|${dtMin}`, `${r.well_name} @ ${dtMin}`);
      if (decision === 'skip') continue;
      const ovwCur = +r.current_reading;
      const ovwPrev = r.previous_reading ? +r.previous_reading : null;
      const ovwDailyVol = ovwPrev != null ? Math.max(0, ovwCur - ovwPrev) : null;
      const ovwPayload: Record<string, any> = {
        current_reading: ovwCur,
        previous_reading: ovwPrev,
        reading_datetime: dt,
        recorded_by: userId,
        daily_volume: ovwDailyVol,
      };
      if (r.tds_ppm?.trim())       ovwPayload.tds_ppm = +r.tds_ppm;
      if (r.turbidity_ntu?.trim()) ovwPayload.turbidity_ntu = +r.turbidity_ntu;
      if (r.pressure_psi?.trim())  ovwPayload.pressure_psi = +r.pressure_psi;
      const { error } = await supabase.from('well_readings').update(ovwPayload as any).eq('id', existingId);
      if (error) errors.push(error.message); else count++;
      continue;
    }

    const csvCur = +r.current_reading;
    const csvPrev = r.previous_reading ? +r.previous_reading : null;
    const rawWellDelta = csvPrev != null ? csvCur - csvPrev : null;
    if (rawWellDelta != null && rawWellDelta < 0)
      errors.push(`Well "${r.well_name}" @ ${dt.slice(0, 10)}: negative delta (${rawWellDelta.toFixed(2)}) — meter rollback detected. daily_volume stored as 0.`);
    const csvDailyVol = rawWellDelta != null ? Math.max(0, rawWellDelta) : null;

    const insertPayload: Record<string, any> = {
      well_id: wellId,
      plant_id: plantId,
      current_reading: csvCur,
      previous_reading: csvPrev,
      daily_volume: csvDailyVol,
      reading_datetime: dt,
      recorded_by: userId,
    };
    if (r.tds_ppm?.trim())       insertPayload.tds_ppm = +r.tds_ppm;
    if (r.turbidity_ntu?.trim()) insertPayload.turbidity_ntu = +r.turbidity_ntu;
    if (r.pressure_psi?.trim())  insertPayload.pressure_psi = +r.pressure_psi;
    toInsert.push(insertPayload);
  }

  // ── Pass 4: bulk-insert new rows in chunks instead of one INSERT per row.
  // A chunk that fails falls back to per-row inserts so one bad row in an
  // otherwise-good batch doesn't discard the rest of that chunk. ──
  for (let i = 0; i < toInsert.length; i += INSERT_CHUNK_SIZE) {
    const chunk = toInsert.slice(i, i + INSERT_CHUNK_SIZE);
    const { error: chunkError } = await supabase.from('well_readings').insert(chunk as any);
    if (!chunkError) {
      count += chunk.length;
      continue;
    }
    // Fallback: this chunk had a problem row somewhere — insert individually
    // so the good rows in it still get saved and the bad one is identified.
    for (const payload of chunk) {
      const { error } = await supabase.from('well_readings').insert(payload as any);
      if (error) errors.push(`${payload.reading_datetime}: ${error.message}`);
      else count++;
    }
  }

  return { count, errors };
}

export function WellReadingForm() {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const { user, isAdmin, isManager, isDataAnalyst } = useAuth();
  const [plantId, setPlantId] = useState('');
  const [importOpen, setImportOpen] = useState(false);

  // Load plant meter config to detect shared power meter groups
  const { data: meterConfig } = useQuery({
    queryKey: ['plant-meter-config', plantId],
    enabled: !!plantId,
    staleTime: 30_000,
    queryFn: async () => {
      try {
        const { data } = await (supabase.from('plant_meter_config' as any) as any)
          .select('config').eq('plant_id', plantId).maybeSingle();
        if (data?.config) return data.config as Record<string, any>;
      } catch { /* table may not exist */ }
      try {
        const raw = localStorage.getItem(`plant_meter_config_${plantId}`);
        if (raw) return JSON.parse(raw) as Record<string, any>;
      } catch { /* ignore */ }
      return {} as Record<string, any>;
    },
  });

  const sharedGroups: Array<{ id: string; name: string; members: string[] }> =
    (meterConfig?.wells_shared_electric_groups as any[]) ?? [];

  // Map: well ID → { groupId, groupName, primaryWellId (first member) }
  const wellGroupMap = useMemo(() => {
    const m: Record<string, { groupId: string; groupName: string; primaryWellId: string }> = {};
    for (const grp of sharedGroups) {
      if (!grp.members?.length) continue;
      for (const wId of grp.members) {
        m[wId] = { groupId: grp.id, groupName: grp.name, primaryWellId: grp.members[0] };
      }
    }
    return m;
  }, [sharedGroups]);

  const { data: wells } = useQuery({
    queryKey: ['op-wells', plantId],
    queryFn: async () => plantId
      ? (await supabase.from('wells').select('*').eq('plant_id', plantId).eq('status', 'Active').order('name')).data ?? []
      : [],
    enabled: !!plantId,
  });

  const { data: recentReadings } = useQuery({
    queryKey: ['op-well-recent', plantId],
    // meta.silent suppresses the global QueryCache error toast — the well section
    // degrades gracefully to empty state when the table / columns are missing.
    meta: { silent: true },
    queryFn: async () => {
      if (!plantId) return [];
      const start = new Date(); start.setDate(start.getDate() - 30);
      const { data, error } = await supabase.from('well_readings')
        .select('*').eq('plant_id', plantId)
        .gte('reading_datetime', start.toISOString())
        .order('reading_datetime', { ascending: false });
      if (error) {
        // Table or optional columns missing — degrade gracefully without a toast.
        // Run the migration in Supabase Dashboard to restore full functionality.
        console.warn('[op-well-recent] well_readings query failed:', error.message);
        return [];
      }
      return data ?? [];
    },
    enabled: !!plantId,
    staleTime: 0,
    refetchInterval: 30_000, // poll every 30 s — mirrors op-loc-recent so both sections stay live
  });

  const { latestByWell, todayByWell, avgByWell } = useMemo(() => {
    const latest: Record<string, any> = {};
    const today: Record<string, any[]> = {};
    const avgs: Record<string, number | null> = {};
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const tenDaysAgo = new Date(); tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    const readingsByWell: Record<string, any[]> = {};
    recentReadings?.forEach((r: any) => {
      if (!latest[r.well_id]) latest[r.well_id] = r;
      if (new Date(r.reading_datetime) >= startOfDay) (today[r.well_id] ||= []).push(r);
      // Collect last-10-day readings for Q=V/t average
      if (new Date(r.reading_datetime) >= tenDaysAgo)
        (readingsByWell[r.well_id] ||= []).push(r);
    });
    // Q = V / t — average flow rate (m³/hr) over the last 10 days
    for (const [wId, readings] of Object.entries(readingsByWell)) {
      const sorted = [...readings].sort(
        (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
      );
      const flowRates: number[] = [];
      for (let i = 1; i < sorted.length; i++) {
        const vol = sorted[i].current_reading - sorted[i - 1].current_reading;
        const hrs = (new Date(sorted[i].reading_datetime).getTime() - new Date(sorted[i - 1].reading_datetime).getTime()) / 3_600_000;
        if (vol > 0 && hrs > 0) flowRates.push(vol / hrs);
      }
      avgs[wId] = flowRates.length ? flowRates.reduce((s, n) => s + n, 0) / flowRates.length : null;
    }
    return { latestByWell: latest, todayByWell: today, avgByWell: avgs };
  }, [recentReadings]);

  const { data: blendingData } = useBlendingWells(plantId);
  const blendingSet = useMemo(
    () => new Set((blendingData?.wells ?? []).map((w) => w.well_id)),
    [blendingData],
  );

  // "No reading — why?" gap reasons logged for today, keyed by well ID.
  const todayDateStr = format(new Date(), 'yyyy-MM-dd');
  const { data: gapReasons } = useQuery({
    queryKey: ['well-gap-reasons', plantId, todayDateStr],
    enabled: !!plantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reading_gap_reasons' as any)
        .select('*')
        .eq('plant_id', plantId)
        .eq('entity_type', 'well')
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

  // Split wells into shared-group sections and standalone
  const { groupedSections, standaloneWells } = useMemo(() => {
    if (!wells?.length) return { groupedSections: [], standaloneWells: [] };
    const groupMap: Record<string, { group: { id: string; name: string; members: string[] }; wells: any[] }> = {};
    const standalone: any[] = [];
    for (const w of wells as any[]) {
      const info = wellGroupMap[w.id];
      if (info) {
        if (!groupMap[info.groupId]) {
          const grp = sharedGroups.find(g => g.id === info.groupId)!;
          groupMap[info.groupId] = { group: grp, wells: [] };
        }
        groupMap[info.groupId].wells.push(w);
      } else {
        standalone.push(w);
      }
    }
    return { groupedSections: Object.values(groupMap), standaloneWells: standalone };
  }, [wells, wellGroupMap, sharedGroups]);

  const onSaved = () => invalidateWellDash(qc);

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
              size="sm" variant="outline"
              className="shrink-0 gap-1.5 h-10 border-teal-600/60 text-teal-700 hover:bg-teal-50 hover:border-teal-600 dark:hover:bg-teal-950/30"
              onClick={() => setImportOpen(true)}
              data-testid="import-well-readings-btn"
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
              <Droplet className="h-3.5 w-3.5 text-teal-600" />
              <span className="text-xs font-semibold text-foreground/80 tracking-tight">Active Wells</span>
            </div>
            <span className="text-[11px] text-muted-foreground tabular-nums bg-muted px-2 py-0.5 rounded-full">
              {wells?.length ?? 0} total
            </span>
          </div>
          {wells?.length ? (
            (() => {
              // Flatten all wells into a single ordered list for the mobile carousel.
              // Group wells are kept together (group header implicit via sharedPower prop).
              const allWellItems: Array<{
                w: any;
                isInSharedPowerGroup: boolean;
                sharedPower?: { groupName: string; primaryWellId: string; previousPower: number | null };
                previousPower: number | null;
              }> = [];

              groupedSections.forEach(({ group, wells: groupWells }) => {
                groupWells.forEach((w: any, idx: number) => {
                  allWellItems.push({
                    w,
                    isInSharedPowerGroup: true,
                    previousPower: null,
                    sharedPower: idx === groupWells.length - 1 ? {
                      groupName: group.name,
                      primaryWellId: group.members[0],
                      previousPower: latestByWell[group.members[0]]?.power_meter_reading ?? null,
                    } : undefined,
                  });
                });
              });

              standaloneWells.forEach((w: any) => {
                allWellItems.push({
                  w,
                  isInSharedPowerGroup: false,
                  previousPower: latestByWell[w.id]?.power_meter_reading ?? null,
                });
              });

              return (
                <MobileCarousel
                  isMobile={isMobile}
                  items={allWellItems}
                  renderItem={(item: typeof allWellItems[number]) => (
                    <WellRow
                      key={item.w.id}
                      well={item.w} plantId={plantId}
                      previousMeter={latestByWell[item.w.id]?.current_reading ?? null}
                      previousPower={item.previousPower}
                      previousDt={latestByWell[item.w.id]?.reading_datetime ?? null}
                      avgVol={avgByWell[item.w.id] ?? null}
                      todayReadings={todayByWell[item.w.id] ?? []}
                      userId={user?.id}
                      isBlending={blendingSet.has(item.w.id)}
                      onSaved={onSaved}
                      isManagerOrAdmin={isAdmin || isManager || isDataAnalyst}
                      isInSharedPowerGroup={item.isInSharedPowerGroup}
                      sharedPower={item.sharedPower}
                      gapReason={gapReasonsByWell[item.w.id] ?? null}
                      onGapReasonSaved={() => qc.invalidateQueries({ queryKey: ['well-gap-reasons', plantId, todayDateStr] })}
                    />
                  )}
                />
              );
            })()
          ) : (
            <p className="px-4 py-6 text-xs text-muted-foreground text-center">No active wells for this plant</p>
          )}
        </Card>
      )}

      {importOpen && (
        <ImportReadingsDialog
          title="Import Well Readings from CSV"
          module="Well Readings"
          plantId={plantId}
          userId={user?.id ?? null}
          schemaHint={WELL_SCHEMA}
          templateFilename="well_readings_template.csv"
          templateRow={WELL_TEMPLATE_ROW}
          validateRow={validateWellReadingRow}
          insertRows={(rows, pid) => insertWellReadings(rows, pid, user?.id ?? null)}
          onClose={() => setImportOpen(false)}
          onImported={() => { setImportOpen(false); invalidateDashboard(qc); }}
        />
      )}
    </div>
  );
}

function WellRow({
  well, plantId, previousMeter, previousPower, previousDt, avgVol, todayReadings, userId, isBlending, onSaved, isManagerOrAdmin, isInSharedPowerGroup,
  sharedPower, gapReason, onGapReasonSaved,
}: {
  well: any; plantId: string;
  previousMeter: number | null; previousPower: number | null;
  previousDt: string | null; avgVol: number | null;
  todayReadings: any[]; userId: string | undefined;
  isBlending: boolean; onSaved: () => void;
  isManagerOrAdmin: boolean;
  isInSharedPowerGroup: boolean;
  sharedPower?: { groupName: string; primaryWellId: string; previousPower: number | null };
  gapReason?: any | null;
  onGapReasonSaved?: () => void;
}) {
  const isMobile = useIsMobile();

  const [reading, setReading]                   = useState('');
  const lastPrefilledMeter = useRef<string | null>(null);
  const [powerReading, setPowerReading]           = useState('');
  const [tdsReading, setTdsReading]               = useState('');
  const [ntuReading, setNtuReading]               = useState('');
  const [pressureReading, setPressureReading]     = useState('');
  const [editingId, setEditingId]               = useState<string | null>(null);
  const [saving, setSaving]                     = useState(false);
  const [savingTds, setSavingTds]               = useState(false);
  const [savingNtu, setSavingNtu]               = useState(false);
  const [savingPressure, setSavingPressure]     = useState(false);
  const [savingPower, setSavingPower]           = useState(false);
  const [sharedPowerReading, setSharedPowerReading] = useState('');
  const [savingSharedPower, setSavingSharedPower]   = useState(false);
  const [showHistory, setShowHistory]           = useState(false);
  const [customDt, setCustomDt]                 = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [gapDialogOpen, setGapDialogOpen]       = useState(false);
  const [gapSaving, setGapSaving]               = useState(false);
  // D4 fix: lets the operator mark a backward reading as a genuine meter
  // rollover (odometer wrapped, e.g. 99999 -> 00012) instead of it either
  // being silently sent for pending_review as a suspected data-entry error,
  // or a raw negative-clamped-to-zero delta polluting daily_volume.
  const [isRollover, setIsRollover]             = useState(false);
  const [rolloverMax, setRolloverMax]           = useState('99999');

  // Draft recovery — restores the meter reading if the operator navigates away accidentally
  const { draft: draftWell, setDraft: setDraftWell, clearDraft: clearDraftWell } =
    useDraft(`well-reading-${well.id}`, { value: '' });
  useEffect(() => {
    if (reading === '' && draftWell.value) setReading(draftWell.value);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-fill the drum with the latest previous meter reading so the operator
  // starts from the real odometer value and only rolls the changed digits.
  // Race-condition fix: same as LocatorRow — see comment there for full details.
  useEffect(() => {
    if (editingId || previousMeter == null) return;
    const expected = previousMeter.toFixed(2);
    if (reading === '' || reading === lastPrefilledMeter.current) {
      setReading(expected);
      lastPrefilledMeter.current = expected;
    }
  }, [previousMeter, reading, editingId]);

  const cur        = +reading || 0;
  // A reading that exactly matches the pre-filled previous is the baseline, not a new entry.
  const meterChanged = reading !== '' && (previousMeter == null || cur !== previousMeter);
  const dailyVol   = meterChanged && previousMeter != null ? cur - previousMeter : null;
  const belowPrev  = previousMeter != null && cur > 0 && cur < previousMeter;
  // Q = V / t: compare current flow rate against 10-day average flow rate (m³/hr)
  const hoursElapsedWell = previousDt && reading
    ? (new Date(customDt).getTime() - new Date(previousDt).getTime()) / 3_600_000
    : null;
  const wellFlowRate = dailyVol != null && hoursElapsedWell != null && hoursElapsedWell > 0
    ? dailyVol / hoursElapsedWell
    : null;
  const highVol    = avgVol != null && wellFlowRate != null && wellFlowRate > avgVol * ALERTS.avg_multiplier_warn;
  const todayCount = todayReadings.length;
  const lastToday  = todayReadings[0] ?? null;
  const atLimit    = !editingId && todayCount >= WELL_MAX_READINGS_PER_DAY;
  const showDedicatedPower = well.has_power_meter && !isInSharedPowerGroup;

  // ── Alert state for water-meter odometer drum (mobile) ───────────────────
  const wellOdometerAlert: OdometerAlertState =
    !meterChanged ? 'neutral' :
    belowPrev     ? 'warn'    :
    highVol       ? 'warn'    :
    'ok';

  // ── Main water (+ optional dedicated power) save ──
  const [wellLastSavePending, setWellLastSavePending] = useState(false);

  const save = async () => {
    if (!reading) { toast.error(`${well.name}: enter a meter reading`); return; }
    if (atLimit) { toast.error(`${well.name}: max ${WELL_MAX_READINGS_PER_DAY} readings/day reached`); return; }

    // Pre-flight guard: cooldown + backward/spike detection
    if (!editingId && userId) {
      setSaving(true);
      const guard = await evaluateReadingGuard(
        'well', well.id, plantId, userId, cur, new Date(customDt),
        false, false, avgVol, isRollover,
      );
      setSaving(false);

      if (guard.status === 'blocked' && guard.reason === 'cooldown') {
        toast.error(
          `${well.name}: cooldown — next reading available in ${formatCooldown(guard.minutesLeft)}.`,
          { duration: 6000 },
        );
        return;
      }
      if (guard.status === 'pending_review') {
        toast.info(`${well.name}: ${guard.detail}`, { duration: 8000 });
      }
    }

    setSaving(true);
    let gps_lat = null, gps_lng = null;
    try {
      const pos = await getCurrentPosition();
      gps_lat = pos.coords.latitude; gps_lng = pos.coords.longitude;
    } catch (err) { console.warn('[Operations] geolocation unavailable:', err); }

    const rolloverMaxNum = isRollover ? Number(rolloverMax) : null;
    const rolloverDailyVol = isRollover && Number.isFinite(rolloverMaxNum) && previousMeter != null
      ? Math.max(0, (rolloverMaxNum as number) - previousMeter + cur)
      : null;

    const payload: any = {
      well_id: well.id, plant_id: plantId,
      current_reading: cur,
      // previous_reading: owned by DB trigger fn_well_reading_integrity() — DO NOT send from client
      daily_volume: isRollover ? rolloverDailyVol : (dailyVol != null ? Math.max(0, dailyVol) : null),
      is_meter_rollover: isRollover,
      meter_rollover_max: isRollover ? rolloverMaxNum : null,
      power_meter_reading: showDedicatedPower && powerReading ? +powerReading : null,
      gps_lat, gps_lng, off_location_flag: false, recorded_by: userId,
      reading_datetime: new Date(customDt).toISOString(),
    };
    if (tdsReading) payload.tds_ppm = +tdsReading;
    if (ntuReading) payload.turbidity_ntu = +ntuReading;
    if (pressureReading) payload.pressure_psi = +pressureReading;

    const { data: savedRow, error } = editingId
      ? await (supabase.from('well_readings').update(payload).eq('id', editingId).select('norm_status,current_reading,previous_reading,daily_volume').single() as any)
      : await (supabase.from('well_readings').insert(payload).select('norm_status,current_reading,previous_reading,daily_volume').single() as any);

    setSaving(false);

    if (error) {
      if (error.code === '23505') {
        toast.error(
          `${well.name}: a reading was already submitted within the last hour. Check the log before resubmitting.`,
          { duration: 8000 },
        );
      } else {
        toast.error(error.message);
      }
      return;
    }

    const isPending = savedRow?.norm_status === 'pending_review';
    setWellLastSavePending(isPending);

    if (isPending) {
      toast.info(`${well.name}: reading saved and sent to supervisor for review.`, { duration: 6000 });
    } else {
      const curr = savedRow?.current_reading;
      const prev = savedRow?.previous_reading;
      const vol  = savedRow?.daily_volume;
      toast.success(fmtSaveToast(well.name, editingId ? 'updated' : 'saved', curr, prev, vol), { duration: 5000 });
    }
    setReading(''); clearDraftWell(); setPowerReading(''); setTdsReading(''); setNtuReading(''); setPressureReading('');
    setIsRollover(false); setRolloverMax('99999');
    setEditingId(null); onSaved();
  };

  // ── Dedicated power save (standalone — updates today's record or inserts new) ──
  const savePower = async () => {
    if (!powerReading) { toast.error(`${well.name}: enter a power reading`); return; }
    setSavingPower(true);
    const val = +powerReading;
    if (lastToday) {
      const { error } = await supabase.from('well_readings')
        .update({ power_meter_reading: val }).eq('id', lastToday.id);
      setSavingPower(false);
      if (error) { toast.error(error.message); return; }
    } else {
      const { error } = await supabase.from('well_readings').insert({
        well_id: well.id, plant_id: plantId,
        current_reading: previousMeter ?? 0, previous_reading: previousMeter,
        power_meter_reading: val, recorded_by: userId,
        reading_datetime: new Date(customDt).toISOString(),
      } as any);
      setSavingPower(false);
      if (error) { toast.error(error.message); return; }
    }
    toast.success(`${well.name}: power saved`);
    setPowerReading(''); onSaved();
  };

  // ── TDS save (updates today's record or inserts new) ──
  const saveTds = async () => {
    if (!tdsReading) { toast.error(`${well.name}: enter a TDS value`); return; }
    setSavingTds(true);
    const val = +tdsReading;
    try {
      let error: any;
      if (lastToday) {
        ({ error } = await (supabase.from('well_readings') as any).update({ tds_ppm: val }).eq('id', lastToday.id));
      } else {
        ({ error } = await (supabase.from('well_readings') as any).insert({
          well_id: well.id, plant_id: plantId,
          current_reading: previousMeter ?? 0, previous_reading: previousMeter,
          tds_ppm: val, recorded_by: userId,
          reading_datetime: new Date(customDt).toISOString(),
        }));
      }
      if (error) throw new Error(error.message);
      toast.success(`${well.name}: TDS saved`);
      setTdsReading(''); onSaved();
    } catch (e: any) {
      toast.error(`TDS save failed: ${e.message}`);
      console.error('saveTds error:', e);
    } finally { setSavingTds(false); }
  };

  // ── NTU save (updates today's record or inserts new) ──
  const saveNtu = async () => {
    if (!ntuReading) { toast.error(`${well.name}: enter a turbidity value`); return; }
    setSavingNtu(true);
    const val = +ntuReading;
    try {
      let error: any;
      if (lastToday) {
        ({ error } = await (supabase.from('well_readings') as any).update({ turbidity_ntu: val }).eq('id', lastToday.id));
      } else {
        ({ error } = await (supabase.from('well_readings') as any).insert({
          well_id: well.id, plant_id: plantId,
          current_reading: previousMeter ?? 0, previous_reading: previousMeter,
          turbidity_ntu: val, recorded_by: userId,
          reading_datetime: new Date(customDt).toISOString(),
        }));
      }
      if (error) throw new Error(error.message);
      toast.success(`${well.name}: NTU saved`);
      setNtuReading(''); onSaved();
    } catch (e: any) {
      toast.error(`NTU save failed: ${e.message}`);
      console.error('saveNtu error:', e);
    } finally { setSavingNtu(false); }
  };

  // ── Pressure save (updates today's record or inserts new) ──
  const savePressure = async () => {
    if (!pressureReading) { toast.error(`${well.name}: enter a pressure value`); return; }
    setSavingPressure(true);
    const val = +pressureReading;
    try {
      let error: any;
      if (lastToday) {
        ({ error } = await (supabase.from('well_readings') as any).update({ pressure_psi: val }).eq('id', lastToday.id));
      } else {
        ({ error } = await (supabase.from('well_readings') as any).insert({
          well_id: well.id, plant_id: plantId,
          current_reading: previousMeter ?? 0, previous_reading: previousMeter,
          pressure_psi: val, recorded_by: userId,
          reading_datetime: new Date(customDt).toISOString(),
        }));
      }
      if (error) throw new Error(error.message);
      toast.success(`${well.name}: pressure saved`);
      setPressureReading(''); onSaved();
    } catch (e: any) {
      toast.error(`Pressure save failed: ${e.message}`);
      console.error('savePressure error:', e);
    } finally { setSavingPressure(false); }
  };

  // ── Shared group power save — attaches to primaryWellId's record ──
  const saveSharedPower = async () => {
    if (!sharedPower || !sharedPowerReading) { toast.error(`${sharedPower?.groupName ?? 'Group'}: enter a power meter reading`); return; }
    setSavingSharedPower(true);
    const val = +sharedPowerReading;
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const { data: todayRecs } = await supabase
      .from('well_readings').select('id')
      .eq('well_id', sharedPower.primaryWellId)
      .gte('reading_datetime', startOfDay.toISOString())
      .order('reading_datetime', { ascending: false }).limit(1);
    if (todayRecs?.length) {
      const { error } = await supabase.from('well_readings')
        .update({ power_meter_reading: val }).eq('id', (todayRecs[0] as any).id);
      setSavingSharedPower(false);
      if (error) { toast.error(error.message); return; }
    } else {
      const { error } = await supabase.from('well_readings').insert({
        well_id: sharedPower.primaryWellId, plant_id: plantId,
        current_reading: sharedPower.previousPower ?? 0,
        power_meter_reading: val, recorded_by: userId,
        reading_datetime: new Date(customDt).toISOString(),
      } as any);
      setSavingSharedPower(false);
      if (error) { toast.error(error.message); return; }
    }
    toast.success(`${sharedPower.groupName}: power meter saved`);
    setSharedPowerReading(''); onSaved();
  };

  const saveGapReason = async (category: string, detail: string) => {
    setGapSaving(true);
    const todayDateStr = format(new Date(), 'yyyy-MM-dd');
    const { error } = await supabase.from('reading_gap_reasons' as any).upsert(
      [{
        entity_type: 'well', entity_id: well.id, plant_id: plantId,
        gap_date: todayDateStr, reason_category: category, reason_detail: detail || null,
        logged_by: userId ?? null,
      }] as any,
      { onConflict: 'entity_type,entity_id,gap_date' },
    );
    setGapSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${well.name}: reason logged`);
    setGapDialogOpen(false);
    onGapReasonSaved?.();
  };

  return (
    <div className="border border-border/70 rounded-lg overflow-hidden bg-card" data-testid={`well-row-${well.id}`}>

      {/* ── Header: name + badges left | status + date + actions right ── */}
      <div className="flex items-start justify-between flex-wrap gap-2 px-3 py-2 bg-muted/30 border-b border-border/60">
        {/* Left: name + badges — allow wrap so name is never hidden */}
        <div className="flex items-center gap-1.5 flex-wrap min-w-0 flex-1">
          <span className="text-sm font-semibold text-foreground break-words">{well.name}</span>
          {isBlending && (
            <span className="shrink-0 text-[10px] font-semibold text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/40 border border-teal-200/60 dark:border-teal-800/40 px-1.5 py-0.5 rounded-full" data-testid={`blending-badge-${well.id}`}>Blending</span>
          )}
          {well.has_power_meter && isInSharedPowerGroup && (
            <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-100/80 dark:bg-amber-900/30 border border-amber-200/60 dark:border-amber-800/40 px-1.5 py-0.5 rounded-full">
              <Zap className="h-2.5 w-2.5" />Shared
            </span>
          )}
          {editingId && (
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/40 px-1.5 py-0.5 rounded">Editing</span>
          )}
        </div>

        {/* Right: count · delta · date · icons */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-[10px] tabular-nums font-medium px-1.5 py-0.5 rounded-full border ${atLimit ? 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-950/30 dark:border-amber-800/50' : 'text-muted-foreground bg-muted border-transparent'}`}>
            {todayCount}/{WELL_MAX_READINGS_PER_DAY}
          </span>
          {todayCount === 0 && !editingId && (
            gapReason ? (
              <button
                type="button"
                onClick={() => setGapDialogOpen(true)}
                title={`No reading — ${reasonCategoryLabel(gapReason.reason_category)}${gapReason.reason_detail ? ': ' + gapReason.reason_detail : ''} (click to edit)`}
                className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 px-1.5 py-0.5 rounded-full hover:bg-amber-100 transition-colors"
                data-testid={`well-gap-reason-badge-${well.id}`}
              >
                <MessageCircleOff className="h-2.5 w-2.5" />
                {reasonCategoryLabel(gapReason.reason_category)}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setGapDialogOpen(true)}
                title="No reading today — log why"
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                data-testid={`well-gap-reason-btn-${well.id}`}
              >
                <MessageCircleOff className="h-3.5 w-3.5" />
              </button>
            )
          )}
          {dailyVol != null && (
            <span className="text-[10px] font-semibold text-teal-700 dark:text-teal-400 tabular-nums">Δ{fmtNum(dailyVol)}</span>
          )}
          {/* Date picker — hidden native input behind styled label */}
          <label className="cursor-pointer relative shrink-0">
            <span className="text-[11px] text-muted-foreground bg-background border border-border/70 rounded px-2 py-1 font-mono-num whitespace-nowrap hover:bg-muted/50 transition-colors">
              {new Date(customDt).toLocaleString([], { month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span>
            <input type="datetime-local" value={customDt} onChange={e => setCustomDt(e.target.value)}
              className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10" title="Reading date & time" />
          </label>
          {/* Edit today's record */}
          {lastToday && !editingId && (
            <button
              onClick={() => {
                setEditingId(lastToday.id);
                setReading(String(lastToday.current_reading ?? ''));
                setPowerReading(lastToday.power_meter_reading != null ? String(lastToday.power_meter_reading) : '');
                setTdsReading(lastToday.tds_ppm != null ? String(lastToday.tds_ppm) : '');
                setNtuReading((lastToday as any).turbidity_ntu != null ? String((lastToday as any).turbidity_ntu) : '');
                setPressureReading(lastToday.pressure_psi != null ? String(lastToday.pressure_psi) : '');
              }}
              title={`Edit last today reading (${fmtNum(lastToday.current_reading)})`}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {editingId && (
            <button onClick={() => { setEditingId(null); setReading(''); setPowerReading(''); setTdsReading(''); setNtuReading(''); setPressureReading(''); }}
              title="Cancel edit"
              className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          {isManagerOrAdmin && (
            <button onClick={() => setShowHistory(true)} title="View reading history"
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <History className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── Body: two-column grid ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2">

        {/* LEFT column: Water Meter + optional Grid/Power Meter */}
        <div className="px-3 py-2 space-y-2 border-b border-border/40 sm:border-b-0">

          {/* Water Meter Reading — odometer drum on mobile, compact input on desktop */}
          {isMobile ? (
            <div className="space-y-1.5">
              <p className="text-[10px] font-medium text-muted-foreground">Water Meter</p>
              <OdometerRollerInput
                value={reading}
                onChange={(v) => { setReading(v); setDraftWell({ value: v }); }}
                alertState={wellOdometerAlert}
                disabled={saving || atLimit}
                testId={`well-meter-input-${well.id}`}
              />
              {/* prev + delta info row */}
              <div className="flex items-center justify-between text-[11px] px-0.5">
                <span className="text-muted-foreground">
                  prev: <span className="font-mono-num text-foreground/80">
                    {previousMeter != null ? fmtNum(previousMeter) : '—'}
                  </span>
                </span>
                {dailyVol != null && (
                  <span className="font-mono-num font-semibold text-teal-700 dark:text-teal-400">
                    Δ {fmtNum(dailyVol)} m³
                  </span>
                )}
              </div>
              <Button
                onClick={save} disabled={saving || !meterChanged || atLimit}
                className="w-full h-10 text-sm bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white shadow-sm"
                title="Save water meter reading">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId ? 'Update' : 'Save'}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] font-medium text-muted-foreground w-24 shrink-0">Water Meter</p>
              <Input
                type="number" step="any" inputMode="decimal"
                value={reading} onChange={e => setReading(e.target.value)}
                placeholder={previousMeter != null ? `Prev: ${fmtNum(previousMeter)}` : 'Enter reading'}
                className="h-7 flex-1 min-w-0 text-xs border-border/70 bg-background focus-visible:ring-teal-500/30 placeholder:text-muted-foreground/50"
                data-testid={`well-meter-input-${well.id}`}
              />
              <Button
                onClick={save} disabled={saving || !meterChanged || atLimit}
                size="sm"
                className="h-7 px-2.5 shrink-0 bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white text-xs shadow-sm"
                title="Save water meter reading">
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : editingId ? 'Update' : 'Save'}
              </Button>
            </div>
          )}

          {/* Grid / Dedicated Power Meter — only for wells with a power meter not in a shared group */}
          {showDedicatedPower && (
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] font-medium text-muted-foreground w-24 shrink-0 flex items-center gap-0.5">
                <Zap className="h-2.5 w-2.5 text-amber-500" />Grid Meter
              </p>
              <Input
                type="number" step="any" inputMode="decimal"
                value={powerReading} onChange={e => setPowerReading(e.target.value)}
                placeholder={previousPower != null ? `Prev: ${fmtNum(previousPower)}` : 'kWh reading'}
                className="h-7 flex-1 min-w-0 text-xs border-amber-200/80 dark:border-amber-800/50 bg-amber-50/30 dark:bg-amber-950/10 focus-visible:ring-amber-400/30 placeholder:text-muted-foreground/50"
                data-testid={`well-power-input-${well.id}`}
              />
              <Button
                onClick={savePower} disabled={savingPower || !powerReading}
                size="sm"
                className="h-7 px-2.5 shrink-0 bg-amber-600 hover:bg-amber-700 text-white text-xs shadow-sm border-0"
                title="Save power meter reading">
                {savingPower ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
              </Button>
            </div>
          )}

          {/* Shared Power Meter — shown only on the last well of the group */}
          {sharedPower && (
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] font-medium text-muted-foreground w-24 shrink-0 flex items-center gap-0.5">
                <Zap className="h-2.5 w-2.5 text-amber-500" />Shared Power
              </p>
              <Input
                type="number" step="any" inputMode="decimal"
                value={sharedPowerReading} onChange={e => setSharedPowerReading(e.target.value)}
                placeholder={sharedPower.previousPower != null ? `Prev: ${fmtNum(sharedPower.previousPower)}` : 'kWh reading'}
                className="h-7 flex-1 min-w-0 text-xs border-amber-200/80 dark:border-amber-800/50 bg-amber-50/30 dark:bg-amber-950/10 focus-visible:ring-amber-400/30 placeholder:text-muted-foreground/50"
                data-testid={`shared-power-input-${sharedPower.primaryWellId}`}
              />
              <Button
                onClick={saveSharedPower} disabled={savingSharedPower || !sharedPowerReading}
                size="sm"
                className="h-7 px-2.5 shrink-0 bg-amber-600 hover:bg-amber-700 text-white text-xs shadow-sm border-0"
                title="Save shared power meter reading">
                {savingSharedPower ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
              </Button>
            </div>
          )}
        </div>

        {/* RIGHT column: TDS + Pressure */}
        <div className="px-3 py-2 space-y-2">

          {/* TDS */}
          <div className="flex items-center gap-1.5">
            <p className="text-[10px] font-medium text-muted-foreground w-16 shrink-0">TDS</p>
            <Input
              type="number" step="any" inputMode="decimal"
              value={tdsReading} onChange={e => setTdsReading(e.target.value)}
              placeholder="ppm"
              className="h-7 flex-1 min-w-0 text-xs border-border/70 bg-background focus-visible:ring-teal-500/20 placeholder:text-muted-foreground/40"
              data-testid={`well-tds-input-${well.id}`}
            />
            <Button
              onClick={saveTds} disabled={savingTds || !tdsReading}
              size="sm" variant="outline"
              className="h-7 px-2.5 shrink-0 text-xs border-border/70"
              title="Save TDS reading">
              {savingTds ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
            </Button>
          </div>

          {/* Turbidity (NTU) */}
          <div className="flex items-center gap-1.5">
            <p className="text-[10px] font-medium text-muted-foreground w-16 shrink-0">NTU</p>
            <Input
              type="number" step="any" inputMode="decimal"
              value={ntuReading} onChange={e => setNtuReading(e.target.value)}
              placeholder="NTU"
              className="h-7 flex-1 min-w-0 text-xs border-border/70 bg-background focus-visible:ring-teal-500/20 placeholder:text-muted-foreground/40"
              data-testid={`well-ntu-input-${well.id}`}
            />
            <Button
              onClick={saveNtu} disabled={savingNtu || !ntuReading}
              size="sm" variant="outline"
              className="h-7 px-2.5 shrink-0 text-xs border-border/70"
              title="Save turbidity (NTU) reading">
              {savingNtu ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
            </Button>
          </div>

          {/* Pressure */}
          <div className="flex items-center gap-1.5">
            <p className="text-[10px] font-medium text-muted-foreground w-16 shrink-0">Pressure</p>
            <Input
              type="number" step="any" inputMode="decimal"
              value={pressureReading} onChange={e => setPressureReading(e.target.value)}
              placeholder="psi"
              className="h-7 flex-1 min-w-0 text-xs border-border/70 bg-background focus-visible:ring-teal-500/20 placeholder:text-muted-foreground/40"
              data-testid={`well-pressure-input-${well.id}`}
            />
            <Button
              onClick={savePressure} disabled={savingPressure || !pressureReading}
              size="sm" variant="outline"
              className="h-7 px-2.5 shrink-0 text-xs border-border/70"
              title="Save pressure reading">
              {savingPressure ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
            </Button>
          </div>
        </div>
      </div>

      {/* ── Warning banners ── */}
      {reading && (belowPrev || highVol) && (
        <div className="flex flex-col gap-1 text-xs bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 px-3 py-2 rounded-lg">
          <span className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            Verify before saving
          </span>
          {belowPrev && (
            <span className="text-amber-700 dark:text-amber-400 pl-5">
              Meter reading is below the previous value — possible meter rollback or data entry error.
            </span>
          )}
          {belowPrev && (
            <div className="pl-5 flex flex-wrap items-center gap-2 pt-1">
              <label className="flex items-center gap-1.5 text-amber-800 dark:text-amber-300 cursor-pointer">
                <Checkbox checked={isRollover} onCheckedChange={(v) => setIsRollover(v === true)} />
                This is a meter rollover (odometer wrapped around), not an error
              </label>
              {isRollover && (
                <span className="flex items-center gap-1.5">
                  <span className="text-amber-700 dark:text-amber-400">Wrap point:</span>
                  <Input
                    value={rolloverMax}
                    onChange={(e) => setRolloverMax(e.target.value)}
                    className="h-6 w-24 text-xs"
                    inputMode="numeric"
                  />
                </span>
              )}
            </div>
          )}
          {highVol && (
            <span className="text-amber-700 dark:text-amber-400 pl-5">
              Flow rate is more than {Math.round(ALERTS.avg_multiplier_warn * 100 - 100)}% above the 10-day average — unusually high.
            </span>
          )}
        </div>
      )}

      {showHistory && (
        <ReadingHistoryDialog
          entityName={well.name}
          module="well"
          entityId={well.id}
          onClose={() => setShowHistory(false)}
        />
      )}

      <ReasonDialog
        open={gapDialogOpen}
        onOpenChange={setGapDialogOpen}
        title={`No reading today for "${well.name}" — why?`}
        description="This explains the gap in Data Summary for today. If a reading comes in later today, it takes priority over this note."
        confirmLabel="Log reason"
        busy={gapSaving}
        onConfirm={(category, detail) => saveGapReason(category, detail)}
      />
    </div>
  );
}


