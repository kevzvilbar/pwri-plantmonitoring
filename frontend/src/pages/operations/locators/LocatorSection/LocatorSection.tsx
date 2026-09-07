import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { PlantSelector } from '@/components/PlantSelector';
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
import { useLocatorsForPlant } from '@/hooks/useLocators';
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
import { MapPin, Pencil, X, Droplet, Zap, Upload, Download, FileText, AlertCircle, AlertTriangle, Loader2, History, FlaskConical, Keyboard, MessageCircleOff, CalendarClock, RefreshCw, PencilLine, ShieldAlert, ArrowUpRight, Lock, SquarePen } from 'lucide-react';
import { DerivedMeterIcon } from '@/components/icons/water-icons';
import { MetaStrip } from '@/components/operations/MetaStrip';
import { ControlCluster } from '@/components/operations/ControlCluster';
import { cn } from '@/lib/utils';

// High-voltage transmission tower icon — matches Plants.tsx grid icon exactly.

import { OdometerRollerInput, MobileCarousel, type OdometerAlertState } from '@/components/OdometerRollerInput';
import { evaluateReadingGuard, SPIKE_MULTIPLIER } from '@/lib/readingGuards';
import { computeRate, classifyDeviation } from '@/lib/flowRateGuards';
import { AnomalyRemarkBanner } from '@/components/AnomalyRemarkBanner';
import { submitAnomalyRemark, isAnomalyRemarkValid } from '@/lib/anomalyRemarks';
import { parseCSVText, triggerTemplateDownload,
  clearDupDecisions, clearBulkDupDecision, ImportReadingsDialog, resolveImportDuplicate,
} from '@/components/ReadingImportDialog';
import { ReadingHistoryDialog } from '@/components/ReadingHistoryDialog';
import {
  GridPylonIcon, WELL_MAX_READINGS_PER_DAY,
  formatCooldown, invalidateLocatorDash, invalidateWellDash, invalidateDashboard,
  invalidateProductMeterDash, invalidatePowerDash, invalidateRODash, invalidateChemDash,
} from '../../shared';
import { ReasonDialog } from '@/components/ReasonDialog';
import { reasonCategoryLabel } from '@/lib/reasonCodes';
import { DerivedMeterOverrideDialog } from '@/components/DerivedMeterOverrideDialog';
import { CorrectionReasonField } from '@/components/CorrectionReasonField';
import { isReasonComplete, resolveReason } from '@/lib/correctionReasons';
import { validateLocatorReadingRow } from '@/lib/readingValidation';
import { validateDerivedOverrideRow } from '@/lib/readingValidation';
import { insertLocatorReadings, syncDerivedLocatorMirrors, insertDerivedOverrideRows, HAMAS_OVERRIDE_SCHEMA, HAMAS_OVERRIDE_TEMPLATE_ROW } from '@/data/mutations/locators';
import { LocatorRow } from '@/components/operations/LocatorRow';

const LOCATOR_SCHEMA = 'locator_name*, current_reading, reading_datetime (YYYY-MM-DDTHH:mm), previous_reading, input_mode (raw|direct), daily_volume';
const LOCATOR_TEMPLATE_ROW = {
  locator_name: 'MCWD - M1',
  current_reading: '1234.56',
  reading_datetime: '2024-06-15T08:30',
  previous_reading: '1200.00',
  input_mode: 'raw',
  daily_volume: '',
};

// ─── Derived-locator (Hamas-style) bulk override via CSV ─────────────────────
// Bulk sibling of the single-value "Override" dialog (DerivedMeterOverrideDialog
// + saveOverride() in LocatorRow below) — same is_estimated=false + audit-log
// semantics as that dialog, just looped over N (date, value, reason) rows from
// a CSV instead of one value typed into a form. This is what lets a Manager /
// Data Analyst / Admin backfill several days of corrected Hamas values in one
// upload instead of one "Override" click per day.
//
// Scoped to a single locator — the "Import CSV" button lives inside that
// locator's own row (mirroring "Override"), so unlike LOCATOR_SCHEMA above
// there's no locator_name column; the target locator is fixed by the caller
// (see insertRows={(rows, pid) => insertDerivedOverrideRows(rows, pid, locator.id, ...)}).
//
// No new RLS or audit migration is needed: this writes to locator_readings via
// the same supabase-js calls saveOverride() already uses, so it's already
// gated by the Phase 4 RESTRICTIVE policies (is_manager_or_analyst_or_admin),
// and reading_edit_audit_log already accepts table_name='locator_readings'
// (Phase 0). The generic ImportReadingsDialog wrapper also logs file-level
// metadata (file name, row count, schema errors) to import_audit_log for
// every import, this one included.
/**
 * After any override write to locator_readings for a derived locator, sync the
 * same value to every mirror product_meter_readings row (product_meters where
 * derived_from_locator_id = locatorId AND is_derived = true) for the same
 * Asia/Manila calendar day.
 *
 * ROOT CAUSE this guards against: saveOverride and insertDerivedOverrideRows
 * previously only wrote to locator_readings. The sweep's phase12 override-
 * protection guard (CONTINUE when is_estimated = false on the locator row)
 * then permanently skips the mirror update — so any locator override silently
 * leaves the mirror at whatever the sweep last computed (often a completely
 * different value). The locator and mirror diverge and stay diverged forever,
 * because the sweep will never reconcile them as long as the override stands.
 *
 * is_estimated is set to true on the mirror rows: they are still derived values
 * (just synced from a human-override rather than from a sweep run). The locator
 * row's is_estimated = false is the signal the sweep reads for its CONTINUE
 * guard — no need to duplicate that on the mirror side.
 *
 * Errors are non-fatal: the locator write already succeeded, so we warn rather
 * than throw, to avoid misleading the user into thinking the override failed.
 */
// Well readings:
// well_name*, current_reading*, reading_datetime, previous_reading, power_meter_reading, solar_meter_reading

export function LocatorReadingForm({ highlightId }: { highlightId?: string | null } = {}) {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const { user, isAdmin, isManager, isDataAnalyst } = useAuth();
  const [plantId, setPlantId] = useState('');
  const [importOpen, setImportOpen] = useState(false);

  // Scroll to and briefly highlight the row linked to from Plant detail.
  // Desktop only: MobileCarousel (below) shows one locator at a time with
  // no way to jump to a specific id from outside it yet — see the note
  // where it's rendered. Worth fixing, but it's a shared component used by
  // Power/Blending/Product too, so that's a follow-up, not part of this.
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [pulseId, setPulseId] = useState<string | null>(null);

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

  const { data: locators } = useLocatorsForPlant(plantId);

  useEffect(() => {
    if (!highlightId || isMobile) return;
    const el = rowRefs.current[highlightId];
    if (!el) return; // row not rendered yet — next render (once locators load) will retry
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setPulseId(highlightId);
    const t = setTimeout(() => setPulseId(null), 2200);
    return () => clearTimeout(t);
  }, [highlightId, isMobile, locators]);

  // Resolved active locator IDs derived directly from useLocators cache — eliminates redundant query
  const _locatorIds = useMemo(
    () => (locators ?? []).filter(l => l.status === 'Active').map(l => l.id),
    [locators]
  );

  const { data: recentReadings } = useQuery({
    queryKey: ['op-loc-recent', plantId],
    queryFn: async () => {
      const locatorIds = _locatorIds ?? [];
      if (!locatorIds.length) return [];
      const start = new Date(); start.setDate(start.getDate() - 14);
      return (await supabase.from('locator_readings')
        .select('id,locator_id,current_reading,reading_datetime,daily_volume,is_meter_replacement,is_estimated,anomaly_remark')
        .in('locator_id', locatorIds)
        .gte('reading_datetime', start.toISOString())
        .order('reading_datetime', { ascending: false })
        // Safety cap — PostgREST default is 1 000 rows; high-frequency plants
        // (e.g. hourly Mambaling: 24/day × 14d × N locators) can exceed that,
        // causing silent truncation. 3 000 covers even the most aggressive schedule.
        .limit(3000)).data ?? [];
    },
    enabled: !!plantId && (_locatorIds !== undefined),
    // FIX (egress, round 2): staleTime:0 meant this query was ALWAYS "stale",
    // so the app-wide useBackgroundSync sweep (App.tsx: 30s global default +
    // a 60s refetchQueries({stale:true}) tick) was re-fetching this 5000-row
    // select('*') dump almost every 60s regardless of the 120s
    // refetchInterval below — the bump in the previous pass didn't actually
    // reduce the real-world fetch rate. staleTime now matches
    // refetchInterval so both mechanisms agree on the cadence instead of
    // fighting each other.
    staleTime: 120_000,
    refetchInterval: 120_000,
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
    // FIX (egress, round 2): payload is small (1 row per locator) so this
    // one was never the big cost, but staleTime:0 still meant the global
    // background-sync sweep re-ran it every ~60s. Matched to refetchInterval
    // like op-loc-recent above so the two queries stay in lockstep.
    staleTime: 120_000,
    refetchInterval: 120_000,
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

  // "No reading — why?" gap reasons logged for today, keyed by locator ID.
  const todayDateStr = format(new Date(), 'yyyy-MM-dd');
  const { data: gapReasons } = useQuery({
    queryKey: ['locator-gap-reasons', plantId, todayDateStr],
    enabled: !!plantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reading_gap_reasons' as any)
        .select('*')
        .eq('plant_id', plantId)
        .eq('entity_type', 'locator')
        .eq('gap_date', todayDateStr);
      if (error) return [];
      return (data ?? []) as any[];
    },
  });
  const gapReasonsByLocator = useMemo(() => {
    const m: Record<string, any> = {};
    (gapReasons ?? []).forEach((g: any) => { m[g.entity_id] = g; });
    return m;
  }, [gapReasons]);

  return (
    <div className="space-y-3">
      {/* Plant selector card */}
      <Card className="p-4">
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="locatorsection-plant" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Plant</Label>
            <PlantSelector value={plantId} onChange={setPlantId} id="locatorsection-plant" />
          </div>
          {(isAdmin || isManager || isDataAnalyst) && plantId && (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 gap-1.5 h-10 border-kpi-locator/60 text-kpi-locator hover:bg-kpi-locator/10 hover:border-kpi-locator"
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
              <MapPin className="h-3.5 w-3.5 text-kpi-locator" />
              <span className="text-xs font-semibold text-foreground/80 tracking-tight">Active Locators</span>
            </div>
            <span className="text-2xs text-muted-foreground tabular-nums bg-muted px-2 py-0.5 rounded-full">
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
                  latestReading={latestByLocator[l.id] ?? null}
                  todayReadings={todayByLocator[l.id] ?? []}
                  avgVol={avgByLocator[l.id] ?? null}
                  userId={user?.id}
                  onSaved={() => invalidateLocatorDash(qc)}
                  isManagerOrAdmin={isAdmin || isManager || isDataAnalyst}
                  maxReadingsPerDay={maxLocatorReadings}
                  gapReason={gapReasonsByLocator[l.id] ?? null}
                  onGapReasonSaved={() => qc.invalidateQueries({ queryKey: ['locator-gap-reasons', plantId, todayDateStr] })}
                  rowRef={(el) => { rowRefs.current[l.id] = el; }}
                  pulsing={pulseId === l.id}
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
