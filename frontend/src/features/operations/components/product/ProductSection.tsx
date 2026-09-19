import React, { useState } from 'react';
import { PlantSelector } from '@/components/PlantSelector';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useIsMobile } from '@/hooks/use-mobile';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { CorrectionRequestDialog } from '@/components/CorrectionRequestDialog';
import type { CorrectionTarget } from '@/components/CorrectionRequestDialog';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
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
import { OdometerRollerInput, MobileCarousel } from '@/components/OdometerRollerInput';
import { AnomalyRemarkBanner } from '@/components/AnomalyRemarkBanner';
import { submitAnomalyRemark, isAnomalyRemarkValid } from '@/lib/anomalyRemarks';
import {
  parseCSVText, triggerTemplateDownload, normalizeDatetime,
  clearDupDecisions, clearBulkDupDecision, ImportReadingsDialog, resolveImportDuplicate,
} from '@/components/ReadingImportDialog';
import { ReadingHistoryDialog } from '@/components/ReadingHistoryDialog';
import { ReplaceMeterDialog } from '@/pages/plants/locators/LocatorDialogs';
import { useProductSectionData } from './useProductSectionData';
import { AddProductMeterButton } from './AddProductMeterButton';
import { MeterNameList } from './MeterNameList';

export function ProductForm({ highlightId }: { highlightId?: string | null } = {}) {
  const { user, isAdmin, isManager, isDataAnalyst } = useAuth();
  const isMobile = useIsMobile();
  const canEdit = isAdmin || isManager || isDataAnalyst;

  const {
    plantId,
    setPlantId,
    importOpen,
    setImportOpen,
    meters,
    metersLoading,
    latestByMeter,
    avgByMeter,
    mirrorSourceById,
    gapReasonsByMeter,
    rowRefs,
    pulseId,
    setPulseId,
    invalidate,
    qc,
  } = useProductSectionData({ highlightId, isMobile, user });

  const navigate = useNavigate();

  const insertRows = async (rows: any[], pid: string) => {
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

      const { data: existing, error: dupCheckErr } = await supabase.from('product_meter_readings' as any)
        .select('id').eq('meter_id', meterId)
        .gte('reading_datetime', `${dtMin}:00`)
        .lte('reading_datetime', `${dtMin}:59`).limit(1);
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
          daily_volume: csvDailyVol,
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
        daily_volume: csvDailyVol2,
      } as any);
      if (error) errors.push(error.message);
      else count++;
    }
    return { count, errors };
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
          <Card className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Gauge className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-semibold text-foreground/80 tracking-tight">Product Meters</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground tabular-nums bg-muted px-2 py-0.5 rounded-full">{meters?.length ?? 0} configured</span>
                {canEdit && <AddProductMeterButton plantId={plantId} onAdded={invalidate} />}
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
              insertRows={insertRows}
              onClose={() => setImportOpen(false)}
              onImported={() => { setImportOpen(false); invalidate(); }}
            />
          )}
        </>
      )}
    </div>
  );
}
