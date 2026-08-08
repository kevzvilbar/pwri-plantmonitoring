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
import { Checkbox } from '@/components/ui/checkbox';
import { StatusPill } from '@/components/StatusPill';
import { fmtNum, getCurrentPosition, isOffLocation, ALERTS } from '@/lib/calculations';
import { fmtSaveToast } from '@/lib/format';
import { findExistingReading } from '@/lib/duplicateCheck';
import { downloadCSV } from '@/lib/csv';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';
import { MapPin, Pencil, X, Droplet, Zap, Upload, Download, FileText, AlertCircle, Loader2, History, Gauge, FlaskConical, Keyboard, CalendarClock } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// High-voltage transmission tower icon — matches Plants.tsx grid icon exactly.

import { OdometerRollerInput, MobileCarousel } from '@/components/OdometerRollerInput';
import { computeRate, computeRollingAverageRateFromDeltas, classifyDeviation, type VolumePoint } from '@/lib/flowRateGuards';
import { AnomalyRemarkBanner } from '@/components/AnomalyRemarkBanner';
import { submitAnomalyRemark } from '@/lib/anomalyRemarks';
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
  logProductionCalc,
} from '../shared';

export function ProductForm() {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const { user, isAdmin, isManager, isDataAnalyst } = useAuth();
  const { data: plants } = usePlants();
  const [plantId, setPlantId] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const canEdit = isAdmin || isManager || isDataAnalyst;

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

  // Latest reading per meter
  const { data: latestReadings } = useQuery({
    queryKey: ['product-readings-latest', plantId],
    queryFn: async () => {
      if (!plantId) return [];
      const { data, error } = await supabase
        .from('product_meter_readings' as any)
        .select('*')
        .eq('plant_id', plantId)
        .order('reading_datetime', { ascending: false })
        .limit(200);
      if (error) throw error;
      // Return only latest per meter_id
      const seen = new Set<string>();
      return ((data ?? []) as any[]).filter((r) => {
        if (seen.has(r.meter_id)) return false;
        seen.add(r.meter_id);
        return true;
      });
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

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['op-product-meters', plantId] });
    qc.invalidateQueries({ queryKey: ['product-readings-latest', plantId] });
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
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Plant</Label>
            <PlantSelector value={plantId} onChange={setPlantId} />
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
                    avgVol={avgByMeter[m.id] ?? null}
                    userId={user?.id ?? null}
                    canEdit={canEdit}
                    onSaved={invalidate}
                    mirrorSource={m.derived_from_locator_id ? mirrorSourceById[m.derived_from_locator_id] : null}
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
                      errors.push(`Meter "${r.meter_name}" @ ${dtMin}: negative delta (${rawOvwDelta.toFixed(2)}) — meter rollback detected. daily_volume stored as 0.`);
                    const csvDailyVol = rawOvwDelta != null ? Math.max(0, rawOvwDelta) : null;
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
                  // Fix #11 — negative delta was silently clamped to 0 with no user feedback.
                  // Now we still clamp (a negative daily_volume would corrupt Dashboard sums)
                  // but emit a warning so the user knows a rollback row was detected.
                  const rawDelta2 = csvPrev2 != null ? csvCur2 - csvPrev2 : null;
                  if (rawDelta2 != null && rawDelta2 < 0) {
                    errors.push(`Row for "${r.meter_name}" @ ${dt.slice(0, 10)}: negative delta (${rawDelta2.toFixed(2)}) — likely a meter rollback. daily_volume stored as 0; mark it as a meter replacement if needed.`);
                  }
                  const csvDailyVol2 = rawDelta2 != null ? Math.max(0, rawDelta2) : null;
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
            <Label>Meter name *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Main Line, Secondary Line…"
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              autoFocus
            />
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

// ── Product meter row ─────────────────────────────────────────────────────────

function ProductMeterRow({
  meter, plantId, latest, avgVol, userId, canEdit, onSaved, mirrorSource,
}: {
  meter: any;
  plantId: string;
  latest: any | null;
  avgVol?: number | null;
  userId: string | null;
  canEdit: boolean;
  onSaved: () => void;
  mirrorSource?: { locatorName: string; plantName: string } | null;
}) {
  const isMobile = useIsMobile();
  const [reading, setReading] = useState('');
  const lastPrefilledProduct = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [customDt, setCustomDt] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const dtInputRef = useRef<HTMLInputElement>(null);
  // "Meter replaced" — same two-way wiring fix as WellRow/LocatorRow: live at
  // entry time (previously only reachable from the meter's history dialog).
  const [showReplaceMeter, setShowReplaceMeter] = useState(false);
  const [meterReplacePending, setMeterReplacePending] = useState<{ newInitialReading: number | null; replacementId: string | null } | null>(null);

  const previous = latest?.current_reading ?? null;
  const cur = +reading || 0;
  const productionVolume = previous != null && reading ? cur - previous : null;
  // Required whenever the flow rate falls outside ±50% of the 10-day average
  // (see flowRateGuards.ts) — cleared after every successful save.
  const [anomalyRemark, setAnomalyRemark] = useState('');
  // Q = V / t: avgVol (from ProductSection's avgByMeter, now a true rolling-
  // average rate, not a naive average of raw daily_volume — see
  // computeRollingAverageRateFromDeltas in flowRateGuards.ts) is m³/hr, so
  // productionVolume needs the same conversion before comparing.
  const hoursElapsedProduct = latest?.reading_datetime && reading
    ? (new Date(customDt).getTime() - new Date(latest.reading_datetime).getTime()) / 3_600_000
    : null;
  const productionRate = computeRate(productionVolume, hoursElapsedProduct);
  const deviationProduct = classifyDeviation(productionRate, avgVol ?? null, ALERTS.product_spike_multiplier);
  const highVol = deviationProduct.tier !== 'ok';
  const anomalyRemarkRequired = highVol && !anomalyRemark.trim();

  // Pre-fill the drum with the latest previous reading so the operator
  // starts from the real odometer value and only rolls the changed digits.
  // Race-condition fix: same as LocatorRow / WellRow.
  useEffect(() => {
    if (previous == null) return;
    const expected = previous.toFixed(2);
    if (reading === '' || reading === lastPrefilledProduct.current) {
      setReading(expected);
      lastPrefilledProduct.current = expected;
    }
  }, [previous, reading]);

  const save = async () => {
    if (!reading) { toast.error(`${meter.name}: enter a reading`); return; }
    if (anomalyRemarkRequired) {
      toast.error(`${meter.name}: this reading is outside the normal range — add a remark before saving.`);
      return;
    }
    setSaving(true);
    const dt = new Date(customDt).toISOString();
    // Bug fix: persist daily_volume so Dashboard/TrendChart can sum it directly,
    // mirroring the same fix already applied to locator_readings and well_readings.
    const dailyVol = previous != null ? Math.max(0, cur - previous) : null;
    const { data: savedRow, error } = await supabase.from('product_meter_readings' as any).insert({
      meter_id: meter.id,
      plant_id: plantId,
      current_reading: cur,
      previous_reading: previous,
      reading_datetime: dt,
      recorded_by: userId,
      daily_volume: dailyVol,   // Bug fix: always persist computed delta for Dashboard aggregation
      is_meter_replacement: !!meterReplacePending,
      // product_meter_readings.norm_status already has full support in the
      // supervisor-review pipeline (DataCorrections.tsx, PendingReviewCard.tsx)
      // — it just never got set on insert before. Wiring it up here so a
      // critical-tier spike is actually queued for review, not just shown as
      // a cosmetic warning with no follow-up.
      ...(deviationProduct.tier === 'critical' ? { norm_status: 'pending_review' } : {}),
    } as any).select('id').single();
    if (error) { toast.error(friendlyError(error)); setSaving(false); return; }

    // Link the replacement record (old final / new initial / date) back to the
    // reading it produced — best-effort, mirrors WellRow/LocatorRow's save().
    if (meterReplacePending?.replacementId && (savedRow as any)?.id) {
      await (supabase.from('product_meter_replacements' as any) as any)
        .update({ reading_id: (savedRow as any).id })
        .eq('id', meterReplacePending.replacementId);
    }

    // Best-effort — the reading itself already saved successfully above,
    // this never blocks or rolls it back. See flowRateGuards.ts.
    if (highVol && (savedRow as any)?.id) {
      void submitAnomalyRemark({
        table_name: 'product_meter_readings',
        record_id: (savedRow as any).id,
        plant_id: plantId,
        tier: deviationProduct.tier as 'needs_remark' | 'critical',
        direction: deviationProduct.direction!,
        deviation_pct: deviationProduct.deviationPct!,
        flow_rate: deviationProduct.rate,
        avg_flow_rate: deviationProduct.avgRate,
        rate_unit: 'm3/hr',
        remark_text: anomalyRemark,
      });
    }
    setAnomalyRemark('');

    // Audit the production volume calculation
    if (productionVolume != null) {
      await logProductionCalc({
        plant_id: plantId,
        meter_id: meter.id,
        meter_name: meter.name,
        entry_name: meter.name,
        production_volume: productionVolume,
        user_id: userId,
        timestamp: dt,
      });
    }

    if (deviationProduct.tier === 'critical') {
      toast.info(`${meter.name}: reading saved and sent to supervisor for review.`, { duration: 6000 });
    } else {
      toast.success(`${meter.name}: reading saved${productionVolume != null ? ` · ${fmtNum(productionVolume)} m³ produced` : ''}`);
    }
    setReading(''); setSaving(false); onSaved();
    setMeterReplacePending(null); setShowReplaceMeter(false);
  };

  // ── Mirrored product meter (no physical meter) — GAP FIX (2026-07-28) ─────
  // Meters with derived_from_locator_id (e.g. Mambaling's HAMAS, mirrored from
  // SRP's derived "HAMAS (Mambaling)" locator — see fn_sweep_derived_meters()'s
  // mirror loop in 20260727_hamas_phase2_sweep_function.sql) have their
  // product_meter_readings written by the sweep, not by an operator. Rendering
  // the normal editable input here would let an operator type in a value the
  // next sweep run then either sits alongside (double-counting) or silently
  // overwrites — the exact gap already fixed on the locator side in
  // LocatorSection.tsx's 2026-07-25 GAP FIX; applying the same fix here.
  if (meter.is_derived) {
    return (
      <div className="p-3 space-y-2" data-testid={`product-meter-row-${meter.id}`}>
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
            <Gauge className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="text-sm font-medium truncate">{meter.name}</span>
            <span className="text-3xs font-bold uppercase tracking-widest bg-warn-soft text-warn px-1.5 py-0.5 rounded-full shrink-0">
              ~ Mirrored
            </span>
          </div>
          {canEdit && (
            <Button
              variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-lg text-muted-foreground shrink-0"
              onClick={() => setShowHistory(true)} title="View computed reading history"
            >
              <History className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        <div className="flex items-start gap-1.5 text-xs text-muted-foreground bg-muted/40 border border-border/60 rounded-lg px-3 py-2">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-warn mt-0.5" />
          <span>
            No physical meter here — this value is mirrored
            {mirrorSource
              ? <> from <span className="font-medium text-foreground/80">{mirrorSource.locatorName}</span> at {mirrorSource.plantName}</>
              : ' from a derived locator on another plant'}
            , computed automatically on a schedule.{' '}
            {latest ? (
              <>Last received: <span className="font-mono-num font-medium text-foreground/80">{fmtNum(latest.daily_volume ?? latest.current_reading)} m³</span> on {new Date(latest.reading_datetime).toLocaleDateString()}.</>
            ) : (
              <>No reading received yet — it lands here once the source locator is linked and the next sweep runs.</>
            )}
          </span>
        </div>

        {showHistory && (
          <ProductMeterHistoryDialog meter={meter} plantId={plantId} onClose={() => setShowHistory(false)} />
        )}
      </div>
    );
  }

  return (
    <div className="p-3 space-y-2" data-testid={`product-meter-row-${meter.id}`}>
      {/* Row 1: Name | compact date picker on right */}
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="text-sm font-medium truncate flex items-center gap-1.5 min-w-0 flex-1">
            <Gauge className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="truncate">{meter.name}</span>
          </div>
          <label className="shrink-0 cursor-pointer relative">
            <span
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-muted border border-border rounded px-3 py-1 font-mono-num whitespace-nowrap hover:bg-muted/70 transition-colors"
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
            <Input ref={dtInputRef} type="datetime-local" value={customDt}
              onChange={e => setCustomDt(e.target.value)}
              className="absolute inset-0 opacity-0 w-full h-full pointer-events-none"
              title="Reading date & time" tabIndex={-1} />
          </label>
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          prev: <span className="font-mono-num">{previous == null ? '—' : fmtNum(previous)}</span>
          {productionVolume != null && (
            <>
              {' · '}
              <span className="font-mono-num text-primary font-medium">{fmtNum(productionVolume)} m³</span>
              {' produced'}
            </>
          )}
        </div>
      </div>

      {/* Row 2: reading input + save + history */}
      {isMobile ? (
        <div className="space-y-2">
          <OdometerRollerInput
            value={reading}
            onChange={setReading}
            alertState="neutral"
            disabled={saving}
            testId={`product-meter-input-${meter.id}`}
          />
          <div className="flex items-center gap-2">
            <Button
              onClick={save} disabled={saving || !reading || anomalyRemarkRequired}
              className="flex-1 h-11 text-sm bg-primary hover:bg-primary/90 active:bg-primary text-white shadow-sm"
              data-testid={`product-meter-save-${meter.id}`}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
            </Button>
            {canEdit && (
              <Button variant="ghost" size="sm" className="h-11 w-11 p-0 rounded-lg text-muted-foreground shrink-0"
                onClick={() => setShowHistory(true)} title="View history">
                <History className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          <div className="relative flex-1 min-w-0">
            <Gauge className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-primary pointer-events-none" />
            <Input
              type="number" step="any" inputMode="decimal"
              value={reading}
              onChange={(e) => setReading(e.target.value)}
              placeholder="Product Reading"
              className="h-9 pl-7 w-full border-primary focus-visible:ring-primary bg-primary-soft/40"
              data-testid={`product-meter-input-${meter.id}`}
            />
          </div>
          <Button
            onClick={save}
            disabled={saving || !reading || anomalyRemarkRequired}
            size="sm"
            className="h-9 px-3 text-xs shrink-0"
            data-testid={`product-meter-save-${meter.id}`}
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
          </Button>
          {canEdit && (
            <Button
              variant="ghost" size="sm" className="h-9 w-9 p-0 rounded-full text-muted-foreground shrink-0"
              onClick={() => setShowHistory(true)} title="View history"
            >
              <History className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      )}

      {/* Meter replaced — two-way: live here at entry time, and also from the
          History dialog's per-row toggle for post-hoc corrections. */}
      <label className="flex items-center gap-1.5 text-2xs text-muted-foreground cursor-pointer select-none">
        <Checkbox
          checked={!!meterReplacePending}
          onCheckedChange={(v) => {
            if (v === true) setShowReplaceMeter(true);
            else setMeterReplacePending(null);
          }}
        />
        Meter replaced
        {meterReplacePending && <span className="text-primary font-medium">— logged</span>}
      </label>

      {/* Warning banner — mirrors locator / well / blending style */}
      {productionVolume != null && productionVolume < 0 && (
        <div className="flex flex-col gap-1 text-xs bg-warn-soft border border-warn px-3 py-2 rounded-lg">
          <span className="flex items-center gap-1.5 font-semibold text-warn">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            Verify before saving
          </span>
          <span className="text-warn pl-5">
            Reading is below the previous value — possible meter rollback or data entry error.
            If the meter was replaced, check "Meter replaced" above instead.
          </span>
        </div>
      )}

      {productionVolume != null && productionVolume >= 0 && highVol && (
        <AnomalyRemarkBanner
          result={deviationProduct}
          label={meter.name}
          unit="m3/hr"
          windowDays={10}
          remark={anomalyRemark}
          onRemarkChange={setAnomalyRemark}
        />
      )}

      {showHistory && (
        <ProductMeterHistoryDialog
          meter={meter}
          plantId={plantId}
          onClose={() => setShowHistory(false)}
        />
      )}

      {showReplaceMeter && (
        <ReplaceMeterDialog
          kind="product"
          assetId={meter.id}
          plantId={plantId}
          oldSerial={meter.meter_serial}
          onSuccess={(info) => {
            setMeterReplacePending(info ?? { newInitialReading: null, replacementId: null });
            if (info?.newInitialReading != null && (reading === '' || reading === previous?.toFixed(2))) {
              setReading(String(info.newInitialReading));
            }
          }}
          onClose={() => setShowReplaceMeter(false)}
        />
      )}
    </div>
  );
}

// ── Product meter history dialog ──────────────────────────────────────────────

function ProductMeterHistoryDialog({ meter, plantId, onClose }: { meter: any; plantId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [days, setDays] = useState<7 | 14 | 30 | 60 | 'custom'>(30);
  const [customFrom, setCustomFrom] = useState(format(new Date(Date.now() - 30 * 86400000), 'yyyy-MM-dd'));
  const [customTo, setCustomTo]     = useState(format(new Date(), 'yyyy-MM-dd'));
  const [appliedFrom, setAppliedFrom] = useState(customFrom);
  const [appliedTo, setAppliedTo]     = useState(customTo);
  const [editRow, setEditRow] = useState<{ id: string; datetime: string; value: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  // Reading id currently going through the "Replace meter" dialog — see
  // toggleMeterReplacement below for why checking opens this instead of a
  // bare flag flip.
  const [replaceReadingId, setReplaceReadingId] = useState<string | null>(null);
  const WINDOWS = [{ label: '7D', days: 7 }, { label: '14D', days: 14 }, { label: '30D', days: 30 }, { label: '60D', days: 60 }] as const;

  const localMidnight = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  const queryKey = ['product-meter-history', meter.id, days, appliedFrom, appliedTo];

  const { data: rows, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      let sinceIso: string;
      let untilIso: string;
      if (days === 'custom') {
        sinceIso = localMidnight(appliedFrom).toISOString();
        const end = localMidnight(appliedTo);
        end.setHours(23, 59, 59, 999);
        untilIso = end.toISOString();
      } else {
        const since = new Date();
        since.setDate(since.getDate() - days);
        sinceIso = since.toISOString();
        untilIso = new Date().toISOString();
      }
      const { data, error } = await supabase
        .from('product_meter_readings' as any)
        .select('id, current_reading, previous_reading, daily_volume, reading_datetime, is_meter_replacement')
        .eq('meter_id', meter.id)
        .gte('reading_datetime', sinceIso)
        .lte('reading_datetime', untilIso)
        .order('reading_datetime', { ascending: false });
      if (!error) return (data ?? []) as any[];
      // is_meter_replacement may not exist yet (pending migration) — fall back
      // to the base columns so the dialog still loads.
      const { data: fallback, error: fallbackErr } = await supabase
        .from('product_meter_readings' as any)
        .select('id, current_reading, previous_reading, daily_volume, reading_datetime')
        .eq('meter_id', meter.id)
        .gte('reading_datetime', sinceIso)
        .lte('reading_datetime', untilIso)
        .order('reading_datetime', { ascending: false });
      if (fallbackErr) throw fallbackErr;
      return (fallback ?? []) as any[];
    },
  });

  // Re-derive previous_reading/daily_volume for EVERY reading of this meter, in
  // chronological order, and persist any that drifted from what's actually stored.
  //
  // Root cause this guards against: previous_reading is written once at insert
  // time and nothing used to keep it in sync afterwards. Editing an older
  // reading's value, deleting a reading, or retroactively flagging one as a
  // meter replacement all change who a downstream row's "predecessor" really
  // is — but the downstream row's stored previous_reading was never told. It
  // keeps pointing at an orphaned, often much larger, cumulative reading, so
  // current − previous_reading can produce a huge bogus (often deeply
  // negative) "Production" figure instead of the correct day-to-day delta.
  // Re-walking the whole chain after every mutation keeps the stored columns
  // honest for anything that reads them directly (e.g. Dashboard/TrendChart
  // fallback paths), not just this dialog's own (now self-computed) display.
  //
  // is_derived (mirrored) meters — e.g. Mambaling's "HAMAS", mirrored from
  // SRP's derived "HAMAS (Mambaling)" locator — do NOT have a cumulative
  // chain: fn_sweep_derived_meters_for_date() writes each day's own volume
  // straight into current_reading and pins previous_reading at 0 (phase11/12
  // in supabase/migrations), so every row stands alone by design. Walking
  // that history here and diffing each row's current_reading against the
  // *previous row's* current_reading — as if it were a rising cumulative
  // meter — clamps almost every day to 0 (two independent daily volumes
  // essentially never happen to subtract into the second day's true volume).
  // This was the actual root cause of HAMAS's mirrored history going to ~0 at
  // Mambaling after any edit/delete/meter-replacement toggle in this dialog,
  // even though SRP's own derived locator kept computing correctly — the
  // sweep's mirror write was fine, this resync silently overwrote it
  // afterwards. See the accompanying hamas_phase13 migration for the one-time
  // data repair. Bail out before touching anything for these meters.
  const resyncMeterChain = async (meterId: string) => {
    if (meter.is_derived) return;
    const { data: all, error } = await supabase
      .from('product_meter_readings' as any)
      .select('id, current_reading, previous_reading, daily_volume, reading_datetime')
      .eq('meter_id', meterId)
      .order('reading_datetime', { ascending: true });
    if (error || !all) return;

    let last: number | null = null;
    const updates: { id: string; previous_reading: number | null; daily_volume: number | null }[] = [];
    for (const row of all as any[]) {
      const newPrev = last;
      const newVol = newPrev != null ? Math.max(0, +row.current_reading - newPrev) : null;
      if (row.previous_reading !== newPrev || row.daily_volume !== newVol) {
        updates.push({ id: row.id, previous_reading: newPrev, daily_volume: newVol });
      }
      last = +row.current_reading;
    }
    if (updates.length) {
      await Promise.all(updates.map(u => supabase
        .from('product_meter_readings' as any)
        .update({ previous_reading: u.previous_reading, daily_volume: u.daily_volume } as any)
        .eq('id', u.id)));
    }
  };

  const saveEdit = async () => {
    if (!editRow) return;
    setSaving(true);
    const newCur = +editRow.value;
    let updatePayload: Record<string, any>;
    if (meter.is_derived) {
      // Derived/mirrored meters store each day's own volume directly in
      // current_reading with previous_reading pinned at 0 (see
      // fn_sweep_derived_meters_for_date's mirror loop) — there's no prior
      // cumulative reading to diff against. A manual edit here is a human
      // override of that day's volume, so write it the same way the sweep
      // does, and mark is_estimated=false so it's clearly an operator value.
      updatePayload = {
        current_reading: newCur,
        previous_reading: 0,
        daily_volume: newCur,
        reading_datetime: new Date(editRow.datetime).toISOString(),
        is_estimated: false,
      };
    } else {
      // Recalculate daily_volume for product_meter_readings — this column is a plain
      // stored value the app owns (not GENERATED ALWAYS AS), the same as it's computed
      // on insert above. It was previously left stale after an edit.
      const existingRow = rows?.find((r: any) => r.id === editRow.id);
      const existingPrev = existingRow?.previous_reading;
      const newDailyVol = existingPrev != null ? Math.max(0, newCur - existingPrev) : null;
      updatePayload = {
        current_reading: newCur,
        reading_datetime: new Date(editRow.datetime).toISOString(),
        daily_volume: newDailyVol,
      };
    }
    const { error } = await supabase.from('product_meter_readings' as any)
      .update(updatePayload as any).eq('id', editRow.id);
    if (error) { setSaving(false); toast.error(friendlyError(error)); return; }
    // The edit may have changed this row's value and/or its position in the
    // date order — resync the full chain so any downstream row's stale
    // previous_reading (the bug behind the huge negative "Production"
    // figures) gets corrected too, not just this row. No-ops for derived
    // meters, which have no such chain — see resyncMeterChain.
    await resyncMeterChain(meter.id);
    setSaving(false);
    toast.success('Reading updated');
    setEditRow(null);
    qc.invalidateQueries({ queryKey });
    invalidateProductMeterDash(qc);
  };

  // Checking opens ReplaceMeterDialog so the swap gets logged (old/new brand,
  // size, serial, installed date) against product_meter_replacements instead
  // of just flipping a flag. Unchecking still clears the flag directly.
  const toggleMeterReplacement = async (r: any) => {
    const next = !r.is_meter_replacement;
    if (next) {
      setReplaceReadingId(r.id);
      return;
    }
    setTogglingId(r.id);
    const { error } = await (supabase.from('product_meter_readings' as any) as any)
      .update({ is_meter_replacement: next }).eq('id', r.id);
    if (error) {
      setTogglingId(null);
      // Column may not exist yet (pending migration) — skip silently rather
      // than surfacing the misleading PostgREST schema-cache error.
      if (error.message?.includes('does not exist') || error.message?.includes('is_meter_replacement')) return;
      toast.error(friendlyError(error));
      return;
    }
    // A replacement flag doesn't change previous_reading values in the chain
    // (that's still just "whatever the prior reading was"), but resyncing
    // here also cleans up any stale links left over from before this flag
    // existed — cheap enough to just always do it.
    await resyncMeterChain(meter.id);
    setTogglingId(null);
    toast.success(next ? 'Marked as meter replacement — Δ zeroed' : 'Meter replacement flag removed');
    qc.invalidateQueries({ queryKey });
    invalidateProductMeterDash(qc);
  };

  // Delete confirmation goes through an AlertDialog (themed, works in iframes,
  // unlike the native window.confirm() this previously used).
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const deleteRow = async (id: string) => {
    setPendingDeleteId(null);
    setDeletingId(id);
    const { error } = await supabase.from('product_meter_readings' as any).delete().eq('id', id);
    if (error) { setDeletingId(null); toast.error(friendlyError(error)); return; }
    // Removing a row closes a gap in the chain — the reading that came right
    // after it now needs to point its previous_reading at whatever came
    // right before it instead.
    await resyncMeterChain(meter.id);
    setDeletingId(null);
    toast.success('Reading deleted');
    qc.invalidateQueries({ queryKey });
    invalidateProductMeterDash(qc);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-1.5">
            <Gauge className="h-4 w-4 text-primary" /> {meter.name} — History
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
            {WINDOWS.map(({ label, days: d }) => (
              <button key={label} onClick={() => { setDays(d as any); setEditRow(null); }}
                className={['px-3 py-1 text-xs font-medium rounded-md transition-all',
                  days === d ? 'bg-primary text-white shadow-sm' : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}>{label}</button>
            ))}
            <button onClick={() => { setDays('custom'); setEditRow(null); }}
              className={['px-3 py-1 text-xs font-medium rounded-md transition-all',
                days === 'custom' ? 'bg-primary text-white shadow-sm' : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}>Custom</button>
          </div>
          {days === 'custom' && (
            <div className="flex items-center gap-1.5">
              <input type="date" value={customFrom} max={customTo}
                onChange={e => setCustomFrom(e.target.value)}
                className="h-7 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
              <span className="text-xs text-muted-foreground">to</span>
              <input type="date" value={customTo} min={customFrom} max={format(new Date(), 'yyyy-MM-dd')}
                onChange={e => setCustomTo(e.target.value)}
                className="h-7 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
              <Button size="sm" className="h-7 px-3 text-xs bg-primary text-white hover:bg-primary/90"
                onClick={() => { setAppliedFrom(customFrom); setAppliedTo(customTo); setEditRow(null); }}>
                Apply
              </Button>
            </div>
          )}
        </div>

        {editRow && (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2 text-xs">
            <p className="font-medium">Editing reading</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Date &amp; Time</Label>
                <Input type="datetime-local" value={editRow.datetime}
                  onChange={e => setEditRow({ ...editRow, datetime: e.target.value })} className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-xs">{meter.is_derived ? 'Volume (m³)' : 'Reading'}</Label>
                <Input type="number" step="any" value={editRow.value}
                  onChange={e => setEditRow({ ...editRow, value: e.target.value })} className="h-8 text-xs" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={saveEdit} disabled={saving || !editRow.value}
                className="bg-primary text-white hover:bg-primary/90 h-7 text-xs px-3">
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save changes'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditRow(null)} disabled={saving} className="h-7 text-xs px-3">Cancel</Button>
            </div>
          </div>
        )}

        {/* Derived (mirrored) meters have no physical counter — the sweep writes
            that day's already-computed volume straight into current_reading and
            resets previous_reading to 0 each run (see fn_sweep_derived_meters'
            mirror loop), so there is no real cumulative delta to take between
            rows. Mirrors the isDirectMode banner/column pattern already used for
            direct-input locators & wells in the shared ReadingHistoryDialog. */}
        {meter.is_derived && (
          <div className="flex items-center gap-1.5 rounded-md bg-primary-soft border border-primary/30 px-2.5 py-1.5 text-xs text-primary">
            <Droplet className="h-3 w-3 shrink-0" />
            This entity's input is already a period volume, so there's no Δ to compute — the value below is the volume itself.
          </div>
        )}

        <div className="overflow-auto max-h-[520px] rounded border text-xs">
          {isLoading ? (
            <div className="flex items-center justify-center p-6 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : !rows?.length ? (
            <p className="p-4 text-center text-muted-foreground">
              {days === 'custom'
                ? `No readings from ${appliedFrom} → ${appliedTo}`
                : `No readings in the last ${days} days`}
            </p>
          ) : (
            <table className="w-full text-left">
              <thead className="bg-muted sticky top-0">
                <tr>
                  <th className="px-3 py-2 font-medium">Date & Time</th>
                  {meter.is_derived ? (
                    <th className="px-3 py-2 font-medium text-right">Volume (m³)</th>
                  ) : (
                    <>
                      <th className="px-3 py-2 font-medium text-right">Reading</th>
                      <th className="px-3 py-2 font-medium text-right">Production (m³)</th>
                    </>
                  )}
                  <th className="px-2 py-2 font-medium text-center">Repl.</th>
                  <th className="px-2 py-2 font-medium text-center w-16">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any, i: number) => {
                  // Compute the delta from the adjacent row in this sorted result set
                  // (rows are ordered reading_datetime DESC, so the predecessor is the
                  // next array element) rather than trusting the row's stored
                  // `previous_reading` column.
                  //
                  // `previous_reading` is written once, at insert time, and nothing
                  // cascades an update to it afterwards. If an earlier reading is later
                  // edited/deleted, or a reading gets retroactively flagged as a meter
                  // replacement (as with the "Repl." toggle below), any row that was
                  // inserted pointing at the old chain becomes stale — it keeps
                  // subtracting from a now-orphaned, much larger cumulative reading and
                  // produces a huge negative "Production" figure. Recomputing live from
                  // the adjacent row self-heals regardless of what's stored in the DB.
                  const predecessor: any = rows[i + 1] ?? null;
                  const vol = predecessor != null ? r.current_reading - predecessor.current_reading : null;
                  const isEditing = editRow?.id === r.id;
                  const isDeleting = deletingId === r.id;
                  const isToggling = togglingId === r.id;
                  const isMeterReplacement = !!r.is_meter_replacement;
                  return (
                    <tr key={r.id ?? i} className={[
                      'border-t',
                      isEditing            ? 'bg-primary-soft/60'
                      : isMeterReplacement ? 'bg-kpi-solar/40'
                      : 'hover:bg-muted/40',
                    ].join(' ')}>
                      <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          {r.reading_datetime ? format(new Date(r.reading_datetime), 'MMM d, yyyy HH:mm') : '—'}
                          {isMeterReplacement && (
                            <span className="text-3xs font-semibold uppercase tracking-wide text-kpi-solar bg-kpi-solar/15 px-1 py-0.5 rounded leading-none">
                              repl.
                            </span>
                          )}
                        </span>
                      </td>
                      {meter.is_derived ? (
                        <td className="px-3 py-1.5 text-right font-mono-num text-primary">
                          {fmtNum(r.daily_volume ?? r.current_reading)}
                        </td>
                      ) : (
                        <>
                          <td className="px-3 py-1.5 text-right font-mono-num">{fmtNum(r.current_reading)}</td>
                          <td className="px-3 py-1.5 text-right font-mono-num text-primary">
                            {isMeterReplacement
                              ? <span className="text-kpi-solar font-medium">0</span>
                              : vol != null ? fmtNum(vol) : '—'
                            }
                          </td>
                        </>
                      )}
                      <td className="px-2 py-1.5 text-center">
                        <button
                          title={isMeterReplacement ? 'Meter replacement — click to unmark' : 'Mark as meter replacement (zeroes production)'}
                          aria-label={isMeterReplacement ? 'Meter replacement — click to unmark' : 'Mark as meter replacement (zeroes production)'}
                          disabled={isDeleting || isToggling}
                          onClick={() => toggleMeterReplacement(r)}
                          className={[
                            'inline-flex items-center justify-center w-5 h-5 rounded border transition-colors',
                            'disabled:opacity-40 disabled:cursor-not-allowed',
                            isMeterReplacement
                              ? 'bg-kpi-solar border-kpi-solar text-white hover:bg-kpi-solar/90'
                              : 'border-input bg-background hover:border-kpi-solar/90 hover:bg-kpi-solar/15',
                          ].join(' ')}
                        >
                          {isToggling
                            ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                            : isMeterReplacement ? <span className="text-3xs font-bold leading-none">✓</span> : null
                          }
                        </button>
                      </td>
                      <td className="px-2 py-1 text-center">
                        <div className="flex items-center justify-center gap-0.5">
                          <button title="Edit" aria-label="Edit" disabled={!!editRow || isDeleting}
                            onClick={() => { setPendingDeleteId(null); setEditRow({ id: r.id, datetime: format(new Date(r.reading_datetime), "yyyy-MM-dd'T'HH:mm"), value: String(r.current_reading) }); }}
                            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40">
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button title="Delete" aria-label="Delete" disabled={!!editRow || isDeleting}
                            onClick={() => setPendingDeleteId(r.id)}
                            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-40">
                            {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-2xs text-muted-foreground">
          {days === 'custom' ? `Showing ${appliedFrom} → ${appliedTo}` : `Showing up to ${days} days`} · {rows?.length ?? 0} records
        </p>

        <AlertDialog open={!!pendingDeleteId} onOpenChange={(o) => !o && setPendingDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this reading?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently remove the reading. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => pendingDeleteId && deleteRow(pendingDeleteId)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {replaceReadingId && (
          <ReplaceMeterDialog
            kind="product"
            assetId={meter.id}
            plantId={plantId}
            oldSerial={meter.meter_serial ?? null}
            readingId={replaceReadingId}
            onSuccess={() => {
              qc.invalidateQueries({ queryKey });
              invalidateProductMeterDash(qc);
            }}
            onClose={() => setReplaceReadingId(null)}
          />
        )}
      </DialogContent>
    </Dialog>
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


