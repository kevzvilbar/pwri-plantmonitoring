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
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { StatusPill } from '@/components/StatusPill';
import { fmtNum, getCurrentPosition, isOffLocation, ALERTS } from '@/lib/calculations';
import { fmtSaveToast, lastReadingFreshness } from '@/lib/format';
import { findExistingReading } from '@/lib/duplicateCheck';
import { downloadCSV } from '@/lib/csv';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';
import { MapPin, Pencil, X, Droplet, Zap, Upload, Download, FileText, AlertCircle, Loader2, History, Gauge, FlaskConical, Keyboard, CalendarClock, ArrowUpRight, Lock, SquarePen, MessageCircleOff } from 'lucide-react';
import { MetaStrip } from '@/components/operations/MetaStrip';
import { ControlCluster } from '@/components/operations/ControlCluster';
import { ProductMeterRow } from '@/components/operations/ProductMeterRow';
import { cn } from '@/lib/utils';
import { ReasonDialog } from '@/components/ReasonDialog';
import { reasonCategoryLabel } from '@/lib/reasonCodes';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// High-voltage transmission tower icon — matches Plants.tsx grid icon exactly.

import { OdometerRollerInput, MobileCarousel } from '@/components/OdometerRollerInput';
import { computeRate, computeRollingAverageRateFromDeltas, classifyDeviation, type VolumePoint } from '@/lib/flowRateGuards';
import { AnomalyRemarkBanner } from '@/components/AnomalyRemarkBanner';
import { submitAnomalyRemark, isAnomalyRemarkValid } from '@/lib/anomalyRemarks';
import {
  parseCSVText, triggerTemplateDownload, normalizeDatetime,
  clearDupDecisions, clearBulkDupDecision, ImportReadingsDialog, resolveImportDuplicate,
} from '@/components/ReadingImportDialog';
import { ReadingHistoryDialog } from '@/components/ReadingHistoryDialog';
import { ReplaceMeterDialog } from '@/pages/plants/locators/LocatorDialogs';
import {
  GridPylonIcon, WELL_MAX_READINGS_PER_DAY,
  formatCooldown, invalidateLocatorDash, invalidateWellDash, invalidateDashboard,
  invalidateProductMeterDash, invalidatePowerDash, invalidateRODash, invalidateChemDash,
} from '../shared';

export function ProductForm({ highlightId }: { highlightId?: string | null } = {}) {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const { user, isAdmin, isManager, isDataAnalyst } = useAuth();
  const { data: plants } = usePlants();
  const [plantId, setPlantId] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const canEdit = isAdmin || isManager || isDataAnalyst;
  const navigate = useNavigate();

  // Scroll to and briefly highlight the row linked to from Plant detail.
  // Desktop only — same MobileCarousel limitation noted in LocatorSection.tsx.
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [pulseId, setPulseId] = useState<string | null>(null);

  // Product meters for the selected plant
  // NOTE: uses 'op-product-meters' key (NOT 'product-meters') to avoid colliding with
  // the Plants.tsx cache, which uses a different select projection and placeholderData
  // strategy — a shared key causes stale/incomplete data (blank meter names) to appear.
  const { data: meters, isLoading: metersLoading } = useQuery({
    queryKey: ['op-product-meters', plantId],
    queryFn: async () => {
      if (!plantId) return [];
      let { data, error } = await supabase
        .from('product_meters' as any)
        .select('id, name, status, sort_order, meter_serial, is_derived, derived_from_locator_id, created_at')
        .eq('plant_id', plantId)
        .order('sort_order', { ascending: true });
      // is_derived / derived_from_locator_id missing (pre-2026-07-22 migration DB) → retry without them.
      // Needed so ProductMeterRow can tell a mirrored meter (e.g. Mambaling's HAMAS, mirrored
      // from SRP's derived HAMAS locator) apart from a normally-read meter and hide the editable
      // reading input for it — see the is_derived branch in ProductMeterRow below.
      if (error?.message?.includes('is_derived') || error?.message?.includes('derived_from_locator_id')) {
        ({ data, error } = await supabase
          .from('product_meters' as any)
          .select('id, name, status, sort_order, meter_serial, created_at')
          .eq('plant_id', plantId)
          .order('sort_order', { ascending: true }));
      }
      // meter_serial missing (pre-2026-07-27 migration DB) → retry without it
      if (error?.message?.includes('meter_serial')) {
        ({ data, error } = await supabase
          .from('product_meters' as any)
          .select('id, name, status, sort_order, created_at')
          .eq('plant_id', plantId)
          .order('sort_order', { ascending: true }));
      }
      if (error?.message?.includes('sort_order')) {
        ({ data, error } = await supabase
          .from('product_meters' as any)
          .select('id, name, status, meter_serial, created_at')
          .eq('plant_id', plantId)
          .order('created_at', { ascending: true }));
        if (error?.message?.includes('meter_serial')) {
          ({ data, error } = await supabase
            .from('product_meters' as any)
            .select('id, name, status, created_at')
            .eq('plant_id', plantId)
            .order('created_at', { ascending: true }));
        }
      }
      if (error?.message?.includes('status')) {
        const { data: fallback, error: fallbackErr } = await supabase
          .from('product_meters' as any)
          .select('id, name, created_at')
          .eq('plant_id', plantId)
          .order('created_at', { ascending: true });
        // Was: fallback's own error discarded too — if this terminal tier
        // also failed, `meters` (which nearly everything else on this page
        // derives from) would silently resolve to [].
        if (fallbackErr) throw fallbackErr;
        return ((fallback ?? []) as any[]).map((m: any) => ({ ...m, status: 'Active' }));
      }
      // Any error not matching one of the known missing-column messages
      // above is a real, unhandled failure — was falling through to `data
      // ?? []` silently instead of surfacing.
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!plantId,
  });

  useEffect(() => {
    if (!highlightId || isMobile) return;
    const el = rowRefs.current[highlightId];
    if (!el) return; // row not rendered yet — next render (once meters load) will retry
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setPulseId(highlightId);
    const t = setTimeout(() => setPulseId(null), 2200);
    return () => clearTimeout(t);
  }, [highlightId, isMobile, meters]);

  // Latest reading per meter — sourced from product_meter_readings_latest
  // (DISTINCT ON meter_id in Postgres), not a client-side "last 200 rows,
  // keep first seen per meter_id" reduction. That older approach silently
  // drops a rarely-read meter from the map entirely once frequently-read
  // meters fill the 200-row window — see the migration for detail.
  const { data: latestReadings } = useQuery({
    queryKey: ['product-readings-latest-v2', plantId],
    queryFn: async () => {
      if (!plantId) return [];
      const { data, error } = await (supabase.from('product_meter_readings_latest' as any) as any)
        .select('*')
        .eq('plant_id', plantId);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!plantId,
  });

  const latestByMeter = useMemo(() => {
    const m: Record<string, any> = {};
    for (const r of latestReadings ?? []) m[r.meter_id] = r;
    return m;
  }, [latestReadings]);

  // 10-day average daily_volume per meter — used for the high-volume warning in ProductMeterRow
  const { data: recentProductReadings } = useQuery({
    queryKey: ['product-readings-10day', plantId],
    queryFn: async () => {
      if (!plantId) return [];
      const since = new Date(); since.setDate(since.getDate() - 10);
      const { data, error } = await supabase
        .from('product_meter_readings' as any)
        .select('meter_id, daily_volume, reading_datetime')
        .eq('plant_id', plantId)
        .gte('reading_datetime', since.toISOString())
        .order('reading_datetime', { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!plantId,
  });

  // 10-day average flow rate (m³/hr) per meter — used for the anomaly
  // banner in ProductMeterRow. Was: a plain average of stored daily_volume
  // values, silently assuming every reading was exactly one day apart — the
  // exact bug flowRateGuards.ts exists to fix. Now built from each entry's
  // volume ÷ the actual gap since the PREVIOUS entry for that meter.
  const avgByMeter = useMemo(() => {
    const byMeter: Record<string, VolumePoint[]> = {};
    for (const r of recentProductReadings ?? []) {
      if (r.daily_volume != null && r.daily_volume > 0 && r.reading_datetime) {
        (byMeter[r.meter_id] ||= []).push({ volume: r.daily_volume, at: new Date(r.reading_datetime) });
      }
    }
    const result: Record<string, number | null> = {};
    for (const [id, points] of Object.entries(byMeter))
      result[id] = computeRollingAverageRateFromDeltas(points, 10);
    return result;
  }, [recentProductReadings]);

  // Source locator for any mirrored (is_derived) product meters in this plant —
  // e.g. Mambaling's "HAMAS" meter mirrors SRP's derived "HAMAS (Mambaling)" locator
  // (product_meters.derived_from_locator_id → locators.id, possibly cross-plant).
  // Resolved here (not per-row) to avoid an N+1 query per meter.
  const derivedLocatorIds = useMemo(
    () => [...new Set((meters ?? []).map((m: any) => m.derived_from_locator_id).filter(Boolean))],
    [meters],
  );
  const { data: mirrorSourceLocators } = useQuery({
    queryKey: ['product-meter-mirror-sources', derivedLocatorIds.join(',')],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('locators').select('id, name, plant_id').in('id', derivedLocatorIds as string[]);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: derivedLocatorIds.length > 0,
  });
  const mirrorSourceById = useMemo(() => {
    const plantNameById: Record<string, string> = {};
    for (const p of plants ?? []) plantNameById[p.id] = p.name;
    const m: Record<string, { locatorName: string; plantName: string }> = {};
    for (const l of mirrorSourceLocators ?? []) {
      m[l.id] = { locatorName: l.name, plantName: plantNameById[l.plant_id] ?? 'another plant' };
    }
    return m;
  }, [mirrorSourceLocators, plants]);

  // "No reading — why?" gap reasons logged for today, keyed by product meter ID
  const todayDateStr = format(new Date(), 'yyyy-MM-dd');
  const { data: gapReasons } = useQuery({
    queryKey: ['product-gap-reasons', plantId, todayDateStr],
    enabled: !!plantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reading_gap_reasons' as any)
        .select('*')
        .eq('plant_id', plantId)
        .eq('entity_type', 'product')
        .eq('gap_date', todayDateStr);
      if (error) return [];
      return (data ?? []) as any[];
    },
  });
  const gapReasonsByMeter = useMemo(() => {
    const m: Record<string, any> = {};
    (gapReasons ?? []).forEach((g: any) => { m[g.entity_id] = g; });
    return m;
  }, [gapReasons]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['op-product-meters', plantId] });
    qc.invalidateQueries({ queryKey: ['product-readings-latest-v2', plantId] });
    qc.invalidateQueries({ queryKey: ['product-gap-reasons', plantId] });
    // Targeted Dashboard stat-card keys so new readings appear immediately
    qc.invalidateQueries({ queryKey: ['dash-product-meters-today'] });
    qc.invalidateQueries({ queryKey: ['dash-product-meters-yest'] });
    qc.invalidateQueries({ queryKey: ['dash-ro-permeate-today'] });
    qc.invalidateQueries({ queryKey: ['dash-ro-permeate-yest'] });
    qc.invalidateQueries({ queryKey: ['dash-loc-today'] });
    qc.invalidateQueries({ queryKey: ['dash-loc-yest'] });
    qc.invalidateQueries({ queryKey: ['dash-wells-today'] });
    qc.invalidateQueries({ queryKey: ['dash-wells-yest'] });
    qc.invalidateQueries({ queryKey: ['dash-costs-today'] });
    qc.invalidateQueries({ queryKey: ['dash-summary-recent'] });
    qc.invalidateQueries({ queryKey: ['dash-chem'] });
    qc.invalidateQueries({ queryKey: ['alerts-feed'] });
    // Targeted TrendChart keys so charts refresh immediately
    qc.invalidateQueries({ queryKey: ['trend-loc'] });
    qc.invalidateQueries({ queryKey: ['trend-product'] });
    qc.invalidateQueries({ queryKey: ['trend-well'] });
    qc.invalidateQueries({ queryKey: ['trend-power'] });
    qc.invalidateQueries({ queryKey: ['trend-cost'] });
    qc.invalidateQueries({ queryKey: ['trend-ro'] });
    // ⚠ nuclear qc.invalidateQueries() removed — use typed invalidator instead
    invalidateProductMeterDash(qc);
  };

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="productsection-plant" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Plant</Label>
            <PlantSelector value={plantId} onChange={setPlantId} id="productsection-plant" />
          </div>
          {canEdit && plantId && (
            <Button
              size="sm" variant="outline"
              className="shrink-0 gap-1.5 h-10 border-primary/60 text-primary hover:bg-primary-soft hover:border-primary/90"
              onClick={() => setImportOpen(true)}
              data-testid="import-product-readings-btn"
            >
              <Upload className="h-3.5 w-3.5" />
              Import
            </Button>
          )}
        </div>
      </Card>

      {plantId && (
        <>
          {/* Product Meter list */}
          <Card className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Gauge className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-semibold text-foreground/80 tracking-tight">Product Meters</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground tabular-nums bg-muted px-2 py-0.5 rounded-full">{meters?.length ?? 0} configured</span>
              </div>
            </div>

            {metersLoading ? (
              <div className="px-4 py-5 flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading meters…
              </div>
            ) : meters?.length ? (
              <MobileCarousel
                isMobile={isMobile}
                items={meters ?? []}
                renderItem={(m: any) => (
                  <ProductMeterRow
                    key={m.id}
                    meter={m}
                    plantId={plantId}
                    latest={latestByMeter[m.id] ?? null}
                    gapReason={gapReasonsByMeter[m.id] ?? null}
                    avgVol={avgByMeter[m.id] ?? null}
                    userId={user?.id ?? null}
                    canEdit={canEdit}
                    onSaved={invalidate}
                    onGapReasonSaved={() => qc.invalidateQueries({ queryKey: ['product-gap-reasons', plantId] })}
                    mirrorSource={m.derived_from_locator_id ? mirrorSourceById[m.derived_from_locator_id] : null}
                    rowRef={(el) => { rowRefs.current[m.id] = el; }}
                    pulsing={pulseId === m.id}
                  />
                )}
              />
            ) : (
              <div className="px-4 py-6 text-xs text-muted-foreground text-center">
                No product meters configured for this plant.{' '}
                {canEdit && <span className="text-foreground/70 font-medium">Go to the plant detail page to add product meters.</span>}
              </div>
            )}
          </Card>

          {/* CSV import dialog */}
          {importOpen && (
            <ImportReadingsDialog
              title="Import Product Meter Readings from CSV"
              module="Product Meter Readings"
              plantId={plantId}
              userId={user?.id ?? null}
              schemaHint="meter_name*, current_reading*, reading_datetime (YYYY-MM-DDTHH:mm), previous_reading"
              templateFilename="product_meter_readings_template.csv"
              templateRow={{
                meter_name: 'Main Line',
                current_reading: '12345.67',
                reading_datetime: '2024-06-15T08:30',
                previous_reading: '12200.00',
              }}
              validateRow={(r, i) => {
                const e: string[] = [];
                if (!r.meter_name?.trim()) e.push(`Row ${i}: meter_name is required`);
                if (!r.current_reading?.trim() || isNaN(Number(r.current_reading)))
                  e.push(`Row ${i}: current_reading must be a number`);
                if (r.previous_reading && isNaN(Number(r.previous_reading)))
                  e.push(`Row ${i}: previous_reading must be a number`);
                if (r.reading_datetime && isNaN(Date.parse(normalizeDatetime(r.reading_datetime))))
                  e.push(`Row ${i}: reading_datetime is not a valid date`);
                return e;
              }}
              insertRows={async (rows, pid) => {
                // Resolve meter names → IDs
                const { data: meterList, error: meterListErr } = await supabase
                  .from('product_meters' as any)
                  .select('id, name')
                  .eq('plant_id', pid);
                if (meterListErr) throw meterListErr;
                const nameToId: Record<string, string> = {};
                ((meterList ?? []) as any[]).forEach((m: any) => {
                  nameToId[m.name.trim().toLowerCase()] = m.id;
                });
                let count = 0;
                const errors: string[] = [];
                for (const r of rows) {
                  const meterId = nameToId[r.meter_name?.trim().toLowerCase()];
                  if (!meterId) { errors.push(`Meter not found: "${r.meter_name}"`); continue; }
                  const dt = r.reading_datetime ? new Date(normalizeDatetime(r.reading_datetime)).toISOString() : new Date().toISOString();
                  const dtMin = dt.slice(0, 16);

                  // Duplicate check
                  const { data: existing, error: dupCheckErr } = await supabase.from('product_meter_readings' as any)
                    .select('id').eq('meter_id', meterId)
                    .gte('reading_datetime', `${dtMin}:00`)
                    .lte('reading_datetime', `${dtMin}:59`).limit(1);
                  // Was: error discarded — same duplicate-row risk as
                  // elsewhere this session, just scoped to one row instead
                  // of a whole batch: a failed check made `existing` falsy,
                  // skipping the "duplicate found, resolve" path and falling
                  // through to a plain INSERT even if a reading for this
                  // meter+time already existed. Skip the row instead of
                  // guessing.
                  if (dupCheckErr) {
                    errors.push(`Meter "${r.meter_name}" @ ${dtMin}: couldn't verify duplicates (${dupCheckErr.message}) — row skipped, retry the import.`);
                    continue;
                  }

                  if (existing && existing.length > 0) {
                    const decision = await resolveImportDuplicate(`${meterId}|${dtMin}`, `${r.meter_name} @ ${dtMin}`);
                    if (decision === 'skip') continue;
                    const csvCur = +r.current_reading;
                    const csvPrev = r.previous_reading ? +r.previous_reading : null;
                    const rawOvwDelta = csvPrev != null ? csvCur - csvPrev : null;
                    if (rawOvwDelta != null && rawOvwDelta < 0)
                      errors.push(`Meter "${r.meter_name}" @ ${dtMin}: negative delta (${rawOvwDelta.toFixed(2)}) — meter drop detected and preserved.`);
                    const csvDailyVol = rawOvwDelta != null ? rawOvwDelta : null;
                    const { error } = await supabase.from('product_meter_readings' as any).update({
                      current_reading: csvCur,
                      previous_reading: csvPrev,
                      reading_datetime: dt,
                      recorded_by: user?.id ?? null,
                      daily_volume: csvDailyVol,   // Bug fix: persist computed delta
                    } as any).eq('id', (existing as any[])[0].id);
                    if (error) errors.push(error.message); else count++;
                    continue;
                  }

                  const csvCur2 = +r.current_reading;
                  const csvPrev2 = r.previous_reading ? +r.previous_reading : null;
                  const rawDelta2 = csvPrev2 != null ? csvCur2 - csvPrev2 : null;
                  if (rawDelta2 != null && rawDelta2 < 0) {
                    errors.push(`Row for "${r.meter_name}" @ ${dt.slice(0, 10)}: negative delta (${rawDelta2.toFixed(2)}) — negative delta preserved.`);
                  }
                  const csvDailyVol2 = rawDelta2 != null ? rawDelta2 : null;
                  const { error } = await supabase.from('product_meter_readings' as any).insert({
                    meter_id: meterId,
                    plant_id: pid,
                    current_reading: csvCur2,
                    previous_reading: csvPrev2,
                    reading_datetime: dt,
                    recorded_by: user?.id ?? null,
                    daily_volume: csvDailyVol2,   // Bug fix: always persist computed delta
                  } as any);
                  if (error) errors.push(error.message);
                  else count++;
                }
                return { count, errors };
              }}
              onClose={() => setImportOpen(false)}
              onImported={() => { setImportOpen(false); invalidate(); }}
            />
          )}
        </>
      )}
    </div>
  );
}

// ── Add product meter button (Manager/Admin only) ─────────────────────────────

function AddProductMeterButton({ plantId, onAdded }: { plantId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) { toast.error('Enter a meter name'); return; }
    setBusy(true);
    let { error } = await supabase.from('product_meters' as any).insert({
      plant_id: plantId, name: name.trim(), status: 'Active', sort_order: 0,
    } as any);
    if (error?.message?.includes('status')) {
      ({ error } = await supabase.from('product_meters' as any).insert({
        plant_id: plantId, name: name.trim(), sort_order: 0,
      } as any));
    }
    setBusy(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success(`"${name.trim()}" added`);
    setName(''); setOpen(false); onAdded();
  };

  return (
    <>
      <Button size="sm" variant="outline" className="h-6 text-xs px-2 gap-1" onClick={() => setOpen(true)}>
        <span className="text-base leading-none">+</span> Add meter
      </Button>
      <Dialog open={open} onOpenChange={(o) => { if (!o) { setName(''); } setOpen(o); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add product meter</DialogTitle></DialogHeader>
          <div className="space-y-2 py-1">
            <Label htmlFor="productsection-meter-name">Meter name *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Main Line, Secondary Line…"
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              autoFocus
            id="productsection-meter-name"/>
            <p className="text-xs text-muted-foreground">
              This name appears in Operations → Product and in all audit logs.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={submit} disabled={busy || !name.trim()}>
              {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── MeterNameList ────────────────────────────────────────────────────────────
// Per-meter name chips with inline edit + delete (with confirmation).
// Manager/Admin only — rendered conditionally by the caller.

function MeterNameList({
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
  const ring   = isYellow ? 'focus-visible:ring-warn' : 'focus-visible:ring-info';
  const border = isYellow ? 'border-warn' : 'border-info';
  const chip   = isYellow
    ? 'bg-warn-soft border-warn text-warn'
    : 'bg-info-soft border-info text-info';

  // editingIdx: which chip is in edit mode (-1 = none)
  const [editingIdx, setEditingIdx] = useState<number>(-1);
  const [editVal, setEditVal]       = useState('');
  // confirmDeleteIdx: which chip is showing delete confirmation
  const [confirmDeleteIdx, setConfirmDeleteIdx] = useState<number>(-1);

  const startEdit = (i: number) => {
    setConfirmDeleteIdx(-1);
    setEditingIdx(i);
    setEditVal(names[i] ?? `${defaultPrefix} ${i + 1}`);
  };

  const commitEdit = () => {
    if (editingIdx < 0) return;
    const trimmed = editVal.trim() || `${defaultPrefix} ${editingIdx + 1}`;
    const next = [...names];
    next[editingIdx] = trimmed;
    onSave(next);
    setEditingIdx(-1);
  };

  const cancelEdit = () => { setEditingIdx(-1); };

  const askDelete = (i: number) => {
    setEditingIdx(-1);
    setConfirmDeleteIdx(i);
  };

  const confirmDelete = (i: number) => {
    // Remove this entry by shifting names down; decrement count via onRemoveLast
    const next = [...names];
    next.splice(i, 1);
    onSave(next);
    onRemoveLast();
    setConfirmDeleteIdx(-1);
  };

  const cancelDelete = () => setConfirmDeleteIdx(-1);

  return (
    <div className="flex gap-1 flex-wrap mt-0.5">
      {Array.from({ length: count }).map((_, i) => {
        const name = names[i] ?? `${defaultPrefix} ${i + 1}`;
        const isEditing  = editingIdx === i;
        const isDeleting = confirmDeleteIdx === i;

        if (isEditing) {
          return (
            <div key={i} className={`flex items-center gap-0.5 rounded border ${border} bg-background px-1 py-0.5`}>
              <input
                autoFocus
                value={editVal}
                onChange={e => setEditVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
                className={`h-5 w-20 text-xs bg-transparent focus:outline-none focus-visible:ring-1 ${ring} rounded px-0.5`}
              />
              <button
                onClick={commitEdit}
                className="text-3xs font-semibold text-accent hover:text-accent/90 px-0.5 leading-none"
                title="Save name"
              >✓</button>
              <button
                onClick={cancelEdit}
                className="text-3xs text-muted-foreground hover:text-foreground px-0.5 leading-none"
                title="Cancel"
              >✕</button>
            </div>
          );
        }

        if (isDeleting) {
          return (
            <div key={i} className="flex items-center gap-0.5 rounded border border-destructive/40 bg-destructive/5 px-1.5 py-0.5">
              <span className="text-2xs text-destructive font-medium">Delete "{name}"?</span>
              <button
                onClick={() => confirmDelete(i)}
                className="text-3xs font-bold text-destructive hover:text-destructive/80 ml-1 px-0.5"
                title="Confirm delete"
              >Yes</button>
              <button
                onClick={cancelDelete}
                className="text-3xs text-muted-foreground hover:text-foreground px-0.5"
                title="Cancel"
              >No</button>
            </div>
          );
        }

        return (
          <div key={i} className={`flex items-center gap-0.5 rounded border ${chip} px-1.5 py-0.5 text-xs`}>
            <span className="leading-none">{name}</span>
            <button
              onClick={() => startEdit(i)}
              className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
              title={`Rename "${name}"`}
              aria-label={`Rename "${name}"`}
            >
              <Pencil className="h-2.5 w-2.5" />
            </button>
            <button
              onClick={() => askDelete(i)}
              className="opacity-60 hover:opacity-100 hover:text-destructive transition-opacity"
              title={`Remove "${name}"`}
              aria-label={`Remove "${name}"`}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}


