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
import { useWellsForPlant } from '@/hooks/useWells';
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
import { validateWellReadingRow } from '@/lib/readingValidation';
import { insertWellReadings } from '@/data/mutations/wells';
import { WellRow } from '@/components/operations/WellRow';

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

  const { data: wells } = useWellsForPlant(plantId);

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
      const start = new Date(); start.setDate(start.getDate() - 14);
      const { data, error } = await supabase.from('well_readings')
        .select('id,well_id,current_reading,reading_datetime,power_meter_reading').eq('plant_id', plantId)
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

