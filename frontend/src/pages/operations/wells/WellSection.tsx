import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { PlantSelector } from '@/components/PlantSelector';
import { useBlendingWells } from '../shared';
import { useSearchParams, useNavigate } from 'react-router-dom';
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
import { ReplaceMeterDialog } from '@/pages/plants/locators/LocatorDialogs';
import { fmtNum, getCurrentPosition, isOffLocation, ALERTS } from '@/lib/calculations';
import { fmtSaveToast, lastReadingFreshness } from '@/lib/format';
import { findExistingReading } from '@/lib/duplicateCheck';
import { downloadCSV } from '@/lib/csv';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';
import { MapPin, Pencil, X, Droplet, Zap, Upload, Download, FileText, AlertCircle, Loader2, History, Gauge, FlaskConical, Keyboard, MessageCircleOff, CalendarClock, ArrowUpRight, Lock, SquarePen, Activity } from 'lucide-react';
import { MetaStrip } from '@/components/operations/MetaStrip';
import { ControlCluster } from '@/components/operations/ControlCluster';
import { cn } from '@/lib/utils';

// High-voltage transmission tower icon — matches Plants.tsx grid icon exactly.

import { OdometerRollerInput, MobileCarousel, type OdometerAlertState } from '@/components/OdometerRollerInput';
import { evaluateReadingGuard, SPIKE_MULTIPLIER } from '@/lib/readingGuards';
import { computeRate, classifyDeviation } from '@/lib/flowRateGuards';
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
import { ReasonDialog } from '@/components/ReasonDialog';
import { reasonCategoryLabel } from '@/lib/reasonCodes';
import { CorrectionReasonField } from '@/components/CorrectionReasonField';
import { isReasonComplete, resolveReason } from '@/lib/correctionReasons';
import { logReadingEdit, diffFields } from '@/pages/ro-trains/helpers';

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

// PERFORMANCE FIX: a naive version does one SELECT (duplicate check) and
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
      // Fix #5 — overwrite path was missing daily_volume; TrendChart/Dashboard aggregation
      // would silently use the stale delta from the original insert after a CSV overwrite.
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
      // Only include quality fields when non-empty — sending null for a field
      // the user didn't intend to touch would overwrite an existing value.
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
    // Only include quality fields when non-empty — tds_ppm/turbidity_ntu/pressure_psi
    // are all nullable, so an omitted CSV cell should just leave them unset rather
    // than write an explicit 0.
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

export function WellReadingForm({ highlightId }: { highlightId?: string | null } = {}) {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const { user, isAdmin, isManager, isDataAnalyst } = useAuth();
  const [plantId, setPlantId] = useState('');
  const [importOpen, setImportOpen] = useState(false);

  // Scroll to and briefly highlight the row linked to from Plant detail.
  // Desktop only — see the matching note in LocatorSection.tsx's
  // LocatorReadingForm; MobileCarousel doesn't support jumping to an id yet.
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [pulseId, setPulseId] = useState<string | null>(null);

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

  useEffect(() => {
    if (!highlightId || isMobile) return;
    const el = rowRefs.current[highlightId];
    if (!el) return; // row not rendered yet — next render (once wells load) will retry
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setPulseId(highlightId);
    const t = setTimeout(() => setPulseId(null), 2200);
    return () => clearTimeout(t);
  }, [highlightId, isMobile, wells]);

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
    // FIX (egress): this was still on the OLD 30s cadence with staleTime:0
    // (always stale) — the comment claimed it "mirrors op-loc-recent" but
    // that query was bumped to 120s + staleTime:120_000 in the previous
    // egress pass (see LocatorSection.tsx) and this one was missed. Same
    // 30-day, unbounded select('*') shape as op-loc-recent, so it deserves
    // the same treatment: staleTime matched to refetchInterval so the
    // app-wide background-sync sweep doesn't re-fetch it every ~60s on top
    // of its own timer.
    staleTime: 120_000,
    refetchInterval: 120_000, // poll every 2 min — now actually mirrors op-loc-recent
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

  // "Last reading" freshness — display-only, deliberately NOT fed into
  // latestByWell above. recentReadings is windowed to 30 days (kept as-is:
  // previousMeter/previousPower/hoursElapsedWell derive from it and feed the
  // save-time delta + flow-rate deviation check, which isn't something to
  // change as a side effect of a badge). A well last read 45 days ago would
  // otherwise show "No reading yet" here instead of "45 days ago" — this
  // query, sourced from the unbounded well_readings_latest view, is only
  // to get that specific message right.
  const { data: freshWellReadings } = useQuery({
    queryKey: ['op-well-latest-fresh', plantId],
    meta: { silent: true },
    queryFn: async () => {
      if (!plantId) return [];
      const { data, error } = await (supabase.from('well_readings_latest' as any) as any)
        .select('well_id, reading_datetime')
        .eq('plant_id', plantId);
      if (error) { console.warn('[op-well-latest-fresh] query failed:', error.message); return []; }
      return (data ?? []) as { well_id: string; reading_datetime: string }[];
    },
    enabled: !!plantId,
    staleTime: 120_000, // FIX (egress): was relying on the 30s global default, so the
    // background-sync sweep force-refetched it well before its own interval fired.
    refetchInterval: 120_000,
  });
  const freshDtByWell = useMemo(() => {
    const map: Record<string, string> = {};
    freshWellReadings?.forEach(r => { map[r.well_id] = r.reading_datetime; });
    return map;
  }, [freshWellReadings]);

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
            <Label htmlFor="wellsection-plant" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Plant</Label>
            <PlantSelector value={plantId} onChange={setPlantId} id="wellsection-plant" />
          </div>
          {(isAdmin || isManager || isDataAnalyst) && plantId && (
            <Button
              size="sm" variant="outline"
              className="shrink-0 gap-1.5 h-10 border-primary/60 text-primary hover:bg-primary-soft hover:border-primary/90"
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
              <Droplet className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold text-foreground/80 tracking-tight">Active Wells</span>
            </div>
            <span className="text-xs text-muted-foreground tabular-nums bg-muted px-2 py-0.5 rounded-full">
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
                      freshDt={freshDtByWell[item.w.id] ?? null}
                      avgVol={avgByWell[item.w.id] ?? null}
                      todayReadings={todayByWell[item.w.id] ?? []}
                      userId={user?.id}
                      isBlending={blendingSet.has(item.w.id)}
                      onSaved={onSaved}
                      isManagerOrAdmin={isAdmin || isManager || isDataAnalyst}
                      canAutoApprove={isManager}
                      isInSharedPowerGroup={item.isInSharedPowerGroup}
                      sharedPower={item.sharedPower}
                      gapReason={gapReasonsByWell[item.w.id] ?? null}
                      onGapReasonSaved={() => qc.invalidateQueries({ queryKey: ['well-gap-reasons', plantId, todayDateStr] })}
                      rowRef={(el) => { rowRefs.current[item.w.id] = el; }}
                      pulsing={pulseId === item.w.id}
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
  well, plantId, previousMeter, previousPower, previousDt, freshDt, avgVol, todayReadings, userId, isBlending, onSaved, isManagerOrAdmin, canAutoApprove, isInSharedPowerGroup,
  sharedPower, gapReason, onGapReasonSaved, rowRef, pulsing,
}: {
  well: any; plantId: string;
  previousMeter: number | null; previousPower: number | null;
  previousDt: string | null; avgVol: number | null;
  /** Latest reading time from the unbounded well_readings_latest view —
   *  display-only, for the freshness badge. See the note where the query
   *  that produces this lives, in WellReadingForm above. */
  freshDt?: string | null;
  todayReadings: any[]; userId: string | undefined;
  isBlending: boolean; onSaved: () => void;
  isManagerOrAdmin: boolean;
  /** Manager or Admin — see the matching prop on LocatorSection.tsx's LocatorRow. */
  canAutoApprove: boolean;
  isInSharedPowerGroup: boolean;
  sharedPower?: { groupName: string; primaryWellId: string; previousPower: number | null };
  gapReason?: any | null;
  onGapReasonSaved?: () => void;
  rowRef?: (el: HTMLDivElement | null) => void;
  pulsing?: boolean;
}) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  // activeOperator: display name for the quick-edit audit entry (actor_label),
  // mirroring ReadingHistoryDialog's actorLabel().
  const { activeOperator } = useAuth();

  const [reading, setReading]                   = useState('');
  const lastPrefilledMeter = useRef<string | null>(null);
  const [powerReading, setPowerReading]           = useState('');
  const [tdsReading, setTdsReading]               = useState('');
  const [ntuReading, setNtuReading]               = useState('');
  const [pressureReading, setPressureReading]     = useState('');
  const [editingId, setEditingId]               = useState<string | null>(null);
  // Quick-edit audit trail (pencil icon): the pencil reuses this form's Save
  // button as an UPDATE on lastToday. Snapshot the row's pre-edit values so
  // save() can log a field-level diff + the required reason to
  // reading_edit_audit_log — without this, Data Corrections has no edit
  // reason and no "Value Before Correction" to show for pencil edits.
  const [editBefore, setEditBefore]             = useState<Record<string, any> | null>(null);
  const [editReason, setEditReason]             = useState('');
  const [editCustomReason, setEditCustomReason] = useState('');
  const [saving, setSaving]                     = useState(false);
  const [savingTds, setSavingTds]               = useState(false);
  const [savingNtu, setSavingNtu]               = useState(false);
  const [savingPressure, setSavingPressure]     = useState(false);
  const [savingPower, setSavingPower]           = useState(false);
  // Required whenever the flow rate falls outside ±75% of the 10-day average
  // (see flowRateGuards.ts) — cleared after every successful save.
  const [anomalyRemark, setAnomalyRemark] = useState('');
  const [showAnomalyBanner, setShowAnomalyBanner] = useState(false);
  const [sharedPowerReading, setSharedPowerReading] = useState('');
  const [savingSharedPower, setSavingSharedPower]   = useState(false);
  const [showHistory, setShowHistory]           = useState(false);
  const [customDt, setCustomDt]                 = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const dtInputRef = useRef<HTMLInputElement>(null);
  const [gapDialogOpen, setGapDialogOpen]       = useState(false);
  const [gapSaving, setGapSaving]               = useState(false);
  const defaultRolloverMax = well.meter_rollover_max != null ? String(well.meter_rollover_max) : '99999';
  const [isRollover, setIsRollover]             = useState(false);
  const [rolloverMax, setRolloverMax]           = useState(defaultRolloverMax);
  const [showReplaceMeter, setShowReplaceMeter] = useState(false);
  const [meterReplacePending, setMeterReplacePending] = useState<{ newInitialReading: number | null; replacementId: string | null } | null>(null);

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
  const hoursElapsedWell = previousDt && reading
    ? (new Date(customDt).getTime() - new Date(previousDt).getTime()) / 3_600_000
    : null;
  const wellFlowRate = computeRate(dailyVol, hoursElapsedWell, undefined, true);
  const deviationWell = classifyDeviation(wellFlowRate, avgVol, SPIKE_MULTIPLIER);
  const highVol = deviationWell.tier !== 'ok';
  const anomalyRemarkRequired = deviationWell.tier !== 'ok' && !isAnomalyRemarkValid(anomalyRemark);
  const todayCount = todayReadings.length;
  const lastToday  = todayReadings[0] ?? null;
  const atLimit    = !editingId && todayCount >= WELL_MAX_READINGS_PER_DAY;
  const showDedicatedPower = well.has_power_meter && !isInSharedPowerGroup;

  // ── Alert state for water-meter odometer drum (mobile) ───────────────────
  const odometerAlert: OdometerAlertState =
    !meterChanged ? 'neutral' :
    belowPrev     ? 'warn'    :
    highVol       ? 'warn'    :
    (+reading < 0) ? 'error'  :
    'ok';

  // ── Main water (+ optional dedicated power) save ──
  const [wellLastSavePending, setWellLastSavePending] = useState(false);

  const save = async () => {
    // Re-entrancy guard: ignore a second call while the first is still
    // in-flight (double-tap, slow network + impatient re-tap, etc.).
    if (saving) return;
    if (!reading) { toast.error(`${well.name}: enter a meter reading`); return; }
    if (atLimit) { toast.error(`${well.name}: max ${WELL_MAX_READINGS_PER_DAY} readings/day reached`); return; }

    // Quick-edit (pencil icon) requires a reason — same gate as
    // ReadingHistoryDialog.saveEdit(). The reason + field-level diff are
    // written to reading_edit_audit_log after the UPDATE below, which is
    // what lets Data Corrections render the pre-edit value.
    if (editingId && !isReasonComplete(editReason, editCustomReason)) {
      toast.error(`${well.name}: select a reason for this edit`);
      return;
    }

    // Redundancy Guard (12 hours): identical odometer reading within 12h cannot be saved
    if (!editingId && previousMeter != null && cur === previousMeter && !meterReplacePending) {
      if (hoursElapsedWell != null && hoursElapsedWell < 12) {
        toast.error(`${well.name}: this odometer reading (${fmtNum(cur, 1)}) was already recorded within the last 12 hours.`);
        return;
      }
    }

    if (anomalyRemarkRequired) {
      setShowAnomalyBanner(true);
      toast.error(`${well.name}: this reading is outside the normal range (±75%) — add a remark before saving.`);
      return;
    }

    let guardReason: 'backward' | 'spike' | null = null;

    // Pre-flight guard: cooldown + backward/spike detection
    if (!editingId && userId) {
      setSaving(true);
      const guard = await evaluateReadingGuard(
        'well', well.id, plantId, userId, cur, new Date(customDt),
        !!meterReplacePending, false, avgVol, isRollover,
      );
      setSaving(false);

      if (guard.status === 'blocked' && guard.reason === 'cooldown') {
        toast.error(
          `${well.name}: cooldown — next reading available in ${formatCooldown(guard.minutesLeft)}.`,
          { duration: 6000 },
        );
        return;
      }
      if (guard.status === 'blocked' && guard.reason === 'duplicate') {
        toast.error(`${well.name}: ${guard.detail}`, { duration: 8000 });
        return;
      }
      if (guard.status === 'pending_review') {
        guardReason = guard.reason;
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
      is_meter_replacement: !!meterReplacePending,
      power_meter_reading: showDedicatedPower && powerReading ? +powerReading : null,
      gps_lat, gps_lng, off_location_flag: false, recorded_by: userId,
      reading_datetime: new Date(customDt).toISOString(),
    };
    if (tdsReading) payload.tds_ppm = +tdsReading;
    if (ntuReading) payload.turbidity_ntu = +ntuReading;
    if (pressureReading) payload.pressure_psi = +pressureReading;

    const { data: savedRow, error } = editingId
      ? await (supabase.from('well_readings').update(payload).eq('id', editingId).select('id,norm_status,current_reading,previous_reading,daily_volume').single() as any)
      : await (supabase.from('well_readings').insert(payload).select('id,norm_status,current_reading,previous_reading,daily_volume').single() as any);

    setSaving(false);

    if (error) {
      if (error.code === '23505') {
        toast.error(
          `${well.name}: a reading was already submitted for this time. Check the log before resubmitting.`,
          { duration: 8000 },
        );
      } else {
        toast.error(friendlyError(error));
      }
      return;
    }

    // Audit trail for the quick-edit path (pencil icon → editingId). This
    // UPDATE previously saved with no reason and no logReadingEdit() call,
    // so Data Corrections had nothing to show — no edit reason, no
    // "Value Before Correction". Mirror ReadingHistoryDialog.saveEdit():
    // log the field-level diff + the required reason (gated above).
    // Best-effort, same convention as every other logReadingEdit() caller —
    // a failed insert here never rolls back the reading itself.
    if (editingId && editBefore) {
      // "after" mirrors exactly what this UPDATE writes: tds/ntu/pressure are
      // conditional keys on the payload (absent = column untouched), so they
      // only enter the diff when they were actually sent.
      const after: Record<string, any> = {
        current_reading: payload.current_reading,
        reading_datetime: payload.reading_datetime,
        daily_volume: payload.daily_volume ?? null,
        power_meter_reading: payload.power_meter_reading ?? null,
        is_meter_rollover: !!payload.is_meter_rollover,
        meter_rollover_max: payload.meter_rollover_max ?? null,
        is_meter_replacement: !!payload.is_meter_replacement,
      };
      if (payload.tds_ppm !== undefined) after.tds_ppm = payload.tds_ppm;
      if (payload.turbidity_ntu !== undefined) after.turbidity_ntu = payload.turbidity_ntu;
      if (payload.pressure_psi !== undefined) after.pressure_psi = payload.pressure_psi;
      await logReadingEdit({
        table_name: 'well_readings',
        record_id: editingId,
        plant_id: plantId,
        action: 'update',
        actor_user_id: userId ?? null,
        actor_label: `${activeOperator?.first_name ?? ''} ${activeOperator?.last_name ?? ''}`.trim()
          || activeOperator?.username || null,
        changes: diffFields(editBefore, after),
        reason: resolveReason(editReason, editCustomReason),
      });
    }

    // Link the replacement record (old final / new initial / date) back to the
    // reading it produced. Best-effort — the reading itself already saved with
    // is_meter_replacement=true above, so a failure here just leaves the audit
    // record's reading_id blank rather than losing any data.
    if (meterReplacePending?.replacementId && savedRow?.id) {
      await (supabase.from('well_meter_replacements' as any) as any)
        .update({ reading_id: savedRow.id })
        .eq('id', meterReplacePending.replacementId);
    }

    // Best-effort — the reading itself already saved successfully above,
    // this never blocks or rolls it back. See flowRateGuards.ts.
    if (deviationWell.tier !== 'ok' && savedRow?.id) {
      void submitAnomalyRemark({
        table_name: 'well_readings',
        record_id: savedRow.id,
        plant_id: plantId,
        tier: deviationWell.tier,
        direction: deviationWell.direction!,
        deviation_pct: deviationWell.deviationPct!,
        flow_rate: deviationWell.rate,
        avg_flow_rate: deviationWell.avgRate,
        rate_unit: 'm3/hr',
        remark_text: anomalyRemark,
      });
    }
    setAnomalyRemark('');

    let isPending = savedRow?.norm_status === 'pending_review';

    let autoApproved = false;
    if (isPending && canAutoApprove && savedRow?.id) {
      const { error: autoErr } = await (supabase.rpc('fn_cascade_reading_correction', {
        p_table:       'well_readings',
        p_row_id:      savedRow.id,
        p_new_current: savedRow.current_reading,
        p_admin_id:    userId ?? null,
        p_reason:      `Auto-approved on entry — ${guardReason ?? 'flagged'} check bypassed for Manager/Admin, logged for tracing`,
      }) as any);
      if (!autoErr) { isPending = false; autoApproved = true; }
    }
    setWellLastSavePending(isPending);

    if (isPending) {
      toast.info(`${well.name}: reading saved and sent to supervisor for review.`, { duration: 6000 });
    } else if (autoApproved) {
      toast.success(`${well.name}: saved — auto-approved (Manager/Admin), logged for tracing.`, { duration: 6000 });
    } else {
      const curr = savedRow?.current_reading;
      const prev = savedRow?.previous_reading;
      const vol  = savedRow?.daily_volume;
      toast.success(fmtSaveToast(well.name, editingId ? 'updated' : 'saved', curr, prev, vol), { duration: 5000 });
    }
    setReading(''); clearDraftWell(); setPowerReading(''); setTdsReading(''); setNtuReading(''); setPressureReading('');
    setIsRollover(false); setRolloverMax(defaultRolloverMax);
    setMeterReplacePending(null); setShowReplaceMeter(false);
    if (editingId) {
      setEditBefore(null); setEditReason(''); setEditCustomReason('');
      // Restore the datetime picker to "now" — it was prefilled with the
      // edited row's original timestamp when the pencil fired.
      setCustomDt(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
    }
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
      if (error) { toast.error(friendlyError(error)); return; }
    } else {
      const { error } = await supabase.from('well_readings').insert({
        well_id: well.id, plant_id: plantId,
        current_reading: previousMeter ?? 0, previous_reading: previousMeter,
        power_meter_reading: val, recorded_by: userId,
        reading_datetime: new Date(customDt).toISOString(),
      } as any);
      setSavingPower(false);
      if (error) { toast.error(friendlyError(error)); return; }
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
    } catch (e) {
      toast.error(friendlyError(e));
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
    } catch (e) {
      toast.error(friendlyError(e));
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
    } catch (e) {
      toast.error(`Pressure save failed: ${friendlyError(e)}`);
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
      if (error) { toast.error(friendlyError(error)); return; }
    } else {
      const { error } = await supabase.from('well_readings').insert({
        well_id: sharedPower.primaryWellId, plant_id: plantId,
        current_reading: sharedPower.previousPower ?? 0,
        power_meter_reading: val, recorded_by: userId,
        reading_datetime: new Date(customDt).toISOString(),
      } as any);
      setSavingSharedPower(false);
      if (error) { toast.error(friendlyError(error)); return; }
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
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success(`${well.name}: reason logged`);
    setGapDialogOpen(false);
    onGapReasonSaved?.();
  };

  return (
    <div
      ref={rowRef}
      className={cn(
        'instrument-housing overflow-hidden shadow-xs transition-all border border-border/80 rounded-2xl mb-3',
        pulsing ? 'ring-2 ring-accent ring-inset' : '',
      )}
      data-testid={`well-row-${well.id}`}
    >

      {/* ── Header: name + Prioritized MetaStrip | Date + ControlCluster ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 px-4 py-3 bg-muted/20 border-b border-border/60">
        {/* Left: Name + MetaStrip */}
        <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
          <span className="text-sm font-bold text-foreground break-words">{well.name}</span>
          <MetaStrip
            primary={
              (() => {
                const fresh = lastReadingFreshness(freshDt);
                return (
                  <StatusPill tone={fresh.tone}>
                    <CalendarClock className="h-2.5 w-2.5" />
                    {fresh.label}
                  </StatusPill>
                );
              })()
            }
            alerts={[
              todayCount === 0 && !editingId && {
                tone: 'warn',
                icon: MessageCircleOff,
                label: gapReason ? reasonCategoryLabel(gapReason.reason_category) : 'Log gap reason',
                onClick: () => setGapDialogOpen(true),
                testId: `well-gap-reason-btn-${well.id}`,
              },
              lastToday?.is_estimated && {
                tone: 'warn',
                label: 'Estimated',
                title: 'Auto-backfilled reading — no manual operator entry on file.',
              },
              editingId && {
                tone: 'primary',
                label: 'Editing',
              },
              isBlending && {
                tone: 'accent',
                label: 'Blending',
              },
              well.has_power_meter && isInSharedPowerGroup && {
                tone: 'warn',
                icon: Zap,
                label: 'Shared Power',
              },
              dailyVol != null && {
                tone: 'default',
                label: `Δ ${fmtNum(dailyVol)} m³`,
              },
            ].filter(Boolean)}
            overflow={[
              {
                icon: ArrowUpRight,
                label: 'Plant detail',
                onClick: () => navigate(`/plants/${plantId}?tab=wells&highlight=${well.id}`),
              },
            ].filter(Boolean)}
            maxVisible={4}
          />
        </div>

        {/* Right: Date Picker & ControlCluster */}
        <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
          <span className={cn('text-2xs font-mono-num font-semibold px-2 py-0.5 rounded-full border', atLimit ? 'text-warn bg-warn-soft border-warn/40' : 'text-muted-foreground bg-muted/60 border-border/50')}>
            {todayCount}/{WELL_MAX_READINGS_PER_DAY} today
          </span>

          <label className="cursor-pointer relative shrink-0">
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
              {new Date(customDt).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
              <CalendarClock className="h-3 w-3 shrink-0 opacity-70" />
            </span>
            <input ref={dtInputRef} type="datetime-local" value={customDt} onChange={e => setCustomDt(e.target.value)}
              className="peer absolute inset-0 opacity-0 w-full h-full pointer-events-none" title="Reading date & time" />
          </label>

          <ControlCluster
            actions={[
              lastToday && !editingId && {
                icon: Pencil,
                title: `Edit last today reading (${fmtNum(lastToday.current_reading)})`,
                onClick: () => {
                  setEditingId(lastToday.id);
                  setReading(String(lastToday.current_reading ?? ''));
                  setPowerReading(lastToday.power_meter_reading != null ? String(lastToday.power_meter_reading) : '');
                  setTdsReading(lastToday.tds_ppm != null ? String(lastToday.tds_ppm) : '');
                  setNtuReading((lastToday as any).turbidity_ntu != null ? String((lastToday as any).turbidity_ntu) : '');
                  setPressureReading(lastToday.pressure_psi != null ? String(lastToday.pressure_psi) : '');
                  // Keep the reading's original timestamp: without this, the
                  // UPDATE would silently move reading_datetime to "now"
                  // (customDt's default) on every quick-edit.
                  setCustomDt(format(new Date(lastToday.reading_datetime), "yyyy-MM-dd'T'HH:mm"));
                  // Pre-edit snapshot for the reading_edit_audit_log diff —
                  // this is what makes the old value visible in Data
                  // Corrections ("Value Before Correction").
                  setEditBefore({
                    current_reading: lastToday.current_reading ?? null,
                    reading_datetime: lastToday.reading_datetime ?? null,
                    daily_volume: lastToday.daily_volume ?? null,
                    power_meter_reading: lastToday.power_meter_reading ?? null,
                    tds_ppm: (lastToday as any).tds_ppm ?? null,
                    turbidity_ntu: (lastToday as any).turbidity_ntu ?? null,
                    pressure_psi: lastToday.pressure_psi ?? null,
                    is_meter_rollover: !!lastToday.is_meter_rollover,
                    meter_rollover_max: (lastToday as any).meter_rollover_max ?? null,
                    is_meter_replacement: !!lastToday.is_meter_replacement,
                  });
                },
              },
              editingId && {
                icon: X,
                title: 'Cancel edit',
                variant: 'danger',
                onClick: () => { setEditingId(null); setReading(''); setPowerReading(''); setTdsReading(''); setNtuReading(''); setPressureReading(''); setEditBefore(null); setEditReason(''); setEditCustomReason(''); setCustomDt(format(new Date(), "yyyy-MM-dd'T'HH:mm")); },
              },
              isManagerOrAdmin && {
                icon: History,
                title: 'View reading history',
                onClick: () => setShowHistory(true),
              },
            ]}
          />
        </div>
      </div>

      {/* ── Body: two-column grid ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border/50">

        {/* LEFT column: Water Meter + optional Grid/Power Meter */}
        <div className="px-3.5 py-3 space-y-2.5">

          {/* Water Meter Reading — odometer drum on mobile, compact input on desktop */}
          {isMobile ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-foreground">Water Meter</p>
                <span className="text-3xs text-muted-foreground">Swipe digits or tap Type</span>
              </div>
              <OdometerRollerInput
                value={reading}
                onChange={(v) => { setReading(v); setDraftWell({ value: v }); }}
                alertState={odometerAlert}
                disabled={saving || atLimit}
                testId={`well-meter-input-${well.id}`}
              />
              {/* prev + delta info row */}
              <div className="flex items-center justify-between text-xs px-1 py-0.5 rounded-md bg-muted/40 border border-border/40">
                <span className="text-muted-foreground text-2xs">
                  prev: <span className="font-mono-num font-semibold text-foreground">
                    {previousMeter != null ? fmtNum(previousMeter) : '—'}
                  </span>
                </span>
                {dailyVol != null && (
                  <span className="font-mono-num font-bold text-primary text-2xs">
                    Δ {fmtNum(dailyVol)} m³
                  </span>
                )}
              </div>
              <Button
                onClick={save} disabled={saving || !meterChanged || atLimit || (showAnomalyBanner && anomalyRemarkRequired) || (editingId && !isReasonComplete(editReason, editCustomReason))}
                className={cn(
                  'w-full h-11 text-sm font-bold shadow-sm rounded-xl transition-all',
                  meterChanged
                    ? 'bg-primary hover:bg-primary/90 active:bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground/60 border border-border/40 hover:bg-muted cursor-not-allowed',
                )}
                title="Save water meter reading">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId ? 'Update Meter' : 'Save Water Meter'}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <p className="text-2xs font-bold text-muted-foreground w-24 shrink-0">Water Meter</p>
              <Input
                type="number" step="any" inputMode="decimal"
                value={reading} onChange={e => { setReading(e.target.value); setShowAnomalyBanner(false); }}
                placeholder={previousMeter != null ? `Prev: ${fmtNum(previousMeter)}` : 'Enter reading'}
                className="h-8 flex-1 min-w-0 text-xs border-border/70 bg-background focus-visible:ring-ring/30 font-mono-num placeholder:text-muted-foreground/50"
                data-testid={`well-meter-input-${well.id}`}
              />
              <Button
                onClick={save} disabled={saving || !meterChanged || atLimit || (showAnomalyBanner && anomalyRemarkRequired) || (editingId && !isReasonComplete(editReason, editCustomReason))}
                size="sm"
                className={cn(
                  'h-8 px-3.5 shrink-0 text-xs font-semibold shadow-sm transition-all',
                  meterChanged
                    ? 'bg-primary hover:bg-primary/90 active:bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground/60 border border-border/40 hover:bg-muted cursor-not-allowed',
                )}
                title="Save water meter reading">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : editingId ? 'Update' : 'Save'}
              </Button>
            </div>
          )}

          {/* Quick-edit reason — the pencil button reuses this form's Save
              button as an UPDATE, so an edit reason is mandatory here and is
              written (with the field-level diff) to reading_edit_audit_log,
              exactly like the History dialog's edit flow. Data Corrections
              reads that log to render the "Value Before Correction" box. */}
          {editingId && (
            <div className="pt-1">
              <CorrectionReasonField
                reason={editReason} onReasonChange={setEditReason}
                customReason={editCustomReason} onCustomReasonChange={setEditCustomReason}
                label="Reason for this edit"
              />
            </div>
          )}

          {/* Meter replaced */}
          <label className="flex items-center gap-2 text-2xs text-muted-foreground cursor-pointer select-none pt-1">
            <Checkbox
              checked={!!meterReplacePending}
              onCheckedChange={(v) => {
                if (v === true) setShowReplaceMeter(true);
                else setMeterReplacePending(null);
              }}
            />
            <span>Meter replaced</span>
            {meterReplacePending && <span className="text-primary font-bold">— logged</span>}
          </label>

          {/* Grid / Dedicated Power Meter */}
          {showDedicatedPower && (
            <div className="flex items-center gap-2 pt-1 border-t border-border/40">
              <p className="text-2xs font-bold text-muted-foreground w-24 shrink-0 flex items-center gap-1">
                <Zap className="h-3 w-3 text-warn" />Grid Meter
              </p>
              <Input
                type="number" step="any" inputMode="decimal"
                value={powerReading} onChange={e => setPowerReading(e.target.value)}
                placeholder={previousPower != null ? `Prev: ${fmtNum(previousPower)}` : 'kWh reading'}
                className="h-8 sm:h-7 flex-1 min-w-0 text-xs border-warn/60 bg-warn-soft/30 font-mono-num focus-visible:ring-warn/30 placeholder:text-muted-foreground/50"
                data-testid={`well-power-input-${well.id}`}
              />
              <Button
                onClick={savePower} disabled={savingPower || !powerReading}
                size="sm"
                className="h-8 sm:h-7 px-3 shrink-0 bg-warn hover:bg-warn/90 text-white text-xs font-semibold shadow-sm border-0"
                title="Save power meter reading">
                {savingPower ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
              </Button>
            </div>
          )}

          {/* Shared Power Meter */}
          {sharedPower && (
            <div className="flex items-center gap-2 pt-1 border-t border-border/40">
              <p className="text-2xs font-bold text-muted-foreground w-24 shrink-0 flex items-center gap-1">
                <Zap className="h-3 w-3 text-warn" />Shared Power
              </p>
              <Input
                type="number" step="any" inputMode="decimal"
                value={sharedPowerReading} onChange={e => setSharedPowerReading(e.target.value)}
                placeholder={sharedPower.previousPower != null ? `Prev: ${fmtNum(sharedPower.previousPower)}` : 'kWh reading'}
                className="h-8 sm:h-7 flex-1 min-w-0 text-xs border-warn/60 bg-warn-soft/30 font-mono-num focus-visible:ring-warn/30 placeholder:text-muted-foreground/50"
                data-testid={`shared-power-input-${sharedPower.primaryWellId}`}
              />
              <Button
                onClick={saveSharedPower} disabled={savingSharedPower || !sharedPowerReading}
                size="sm"
                className="h-8 sm:h-7 px-3 shrink-0 bg-warn hover:bg-warn/90 text-white text-xs font-semibold shadow-sm border-0"
                title="Save shared power meter reading">
                {savingSharedPower ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
              </Button>
            </div>
          )}
        </div>

        {/* RIGHT column: TDS + Turbidity (NTU) + Pressure */}
        <div className="px-3.5 py-3 space-y-2.5 bg-muted/10 sm:bg-transparent">
          <p className="text-3xs font-bold uppercase tracking-wider text-muted-foreground sm:hidden">
            Water Quality &amp; Pressure Telemetry
          </p>

          {/* TDS */}
          <div className="flex items-center gap-2">
            <p className="text-2xs font-bold text-muted-foreground w-16 shrink-0">TDS</p>
            <div className="relative flex-1 min-w-0">
              <Input
                type="number" step="any" inputMode="decimal"
                value={tdsReading} onChange={e => setTdsReading(e.target.value)}
                placeholder="Enter TDS"
                className="h-8 sm:h-7 text-xs pr-10 border-border/70 bg-background focus-visible:ring-ring/20 font-mono-num placeholder:text-muted-foreground/40"
                data-testid={`well-tds-input-${well.id}`}
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-3xs font-semibold text-muted-foreground pointer-events-none">ppm</span>
            </div>
            <Button
              onClick={saveTds} disabled={savingTds || !tdsReading}
              size="sm" variant="outline"
              className="h-8 sm:h-7 px-3 text-xs shrink-0 font-semibold border-border/70"
              title="Save TDS reading">
              {savingTds ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
            </Button>
          </div>

          {/* Turbidity (NTU) */}
          <div className="flex items-center gap-2">
            <p className="text-2xs font-bold text-muted-foreground w-16 shrink-0">NTU</p>
            <div className="relative flex-1 min-w-0">
              <Input
                type="number" step="any" inputMode="decimal"
                value={ntuReading} onChange={e => setNtuReading(e.target.value)}
                placeholder="Enter NTU"
                className="h-8 sm:h-7 text-xs pr-10 border-border/70 bg-background focus-visible:ring-ring/20 font-mono-num placeholder:text-muted-foreground/40"
                data-testid={`well-ntu-input-${well.id}`}
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-3xs font-semibold text-muted-foreground pointer-events-none">NTU</span>
            </div>
            <Button
              onClick={saveNtu} disabled={savingNtu || !ntuReading}
              size="sm" variant="outline"
              className="h-8 sm:h-7 px-3 text-xs shrink-0 font-semibold border-border/70"
              title="Save turbidity (NTU) reading">
              {savingNtu ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
            </Button>
          </div>

          {/* Pressure */}
          <div className="flex items-center gap-2">
            <p className="text-2xs font-bold text-muted-foreground w-16 shrink-0">Pressure</p>
            <div className="relative flex-1 min-w-0">
              <Input
                type="number" step="any" inputMode="decimal"
                value={pressureReading} onChange={e => setPressureReading(e.target.value)}
                placeholder="Enter pressure"
                className="h-8 sm:h-7 text-xs pr-10 border-border/70 bg-background focus-visible:ring-ring/20 font-mono-num placeholder:text-muted-foreground/40"
                data-testid={`well-pressure-input-${well.id}`}
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-3xs font-semibold text-muted-foreground pointer-events-none">psi</span>
            </div>
            <Button
              onClick={savePressure} disabled={savingPressure || !pressureReading}
              size="sm" variant="outline"
              className="h-8 sm:h-7 px-3 text-xs shrink-0 font-semibold border-border/70"
              title="Save pressure reading">
              {savingPressure ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
            </Button>
          </div>
        </div>
      </div>

      {/* ── Warning banners ── */}
      {reading && belowPrev && (
        <div className="flex flex-col gap-1 text-xs bg-warn-soft border border-warn px-3 py-2 rounded-lg">
          <span className="flex items-center gap-1.5 font-semibold text-warn">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            Verify before saving
          </span>
          <span className="text-warn pl-5">
            Meter reading is below the previous value — possible meter rollback or data entry error.
            If the meter was replaced, check "Meter replaced" above instead.
          </span>
          <div className="pl-5 flex flex-wrap items-center gap-2 pt-1">
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control --
                Checkbox (Radix) renders a button[role=checkbox], not a
                native input — same false positive as ThemeSelector's
                Switch / MigrationsPanel's "Show applied" checkbox. */}
            <label className="flex items-center gap-1.5 text-warn cursor-pointer">
              <Checkbox checked={isRollover} onCheckedChange={(v) => setIsRollover(v === true)} />
              This is a meter rollover (odometer wrapped around), not an error
            </label>
            {isRollover && (
              <span className="flex items-center gap-1.5">
                <span className="text-warn">Wrap point:</span>
                <Input
                  value={rolloverMax}
                  onChange={(e) => setRolloverMax(e.target.value)}
                  className="h-6 w-24 text-xs"
                  inputMode="numeric"
                />
                {well.meter_rollover_max == null && (
                  <span className="text-warn/70 text-2xs">(guess — confirm against the meter, or set it once in Edit Well)</span>
                )}
              </span>
            )}
          </div>
        </div>
      )}

      {reading && !belowPrev && highVol && (showAnomalyBanner || anomalyRemark.trim().length > 0) && (
        <AnomalyRemarkBanner
          result={deviationWell}
          label={well.name}
          unit="m3/hr"
          windowDays={10}
          remark={anomalyRemark}
          onRemarkChange={setAnomalyRemark}
        />
      )}

      {showHistory && (
        <ReadingHistoryDialog
          entityName={well.name}
          module="well"
          entityId={well.id}
          plantId={plantId}
          assetMeterSerial={well.meter_serial}
          onClose={() => setShowHistory(false)}
        />
      )}

      {showReplaceMeter && (
        <ReplaceMeterDialog
          kind="well"
          assetId={well.id}
          plantId={plantId}
          oldSerial={well.meter_serial}
          onSuccess={(info) => {
            setMeterReplacePending(info ?? { newInitialReading: null, replacementId: null });
            // Prefill the reading input with the new meter's starting value so
            // the operator isn't re-typing what they just entered — only when
            // the field is still empty or holding the prefilled previous value.
            if (info?.newInitialReading != null && (reading === '' || reading === previousMeter?.toFixed(2))) {
              setReading(String(info.newInitialReading));
            }
          }}
          onClose={() => setShowReplaceMeter(false)}
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


