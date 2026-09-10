import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIsMobile } from '@/hooks/use-mobile';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { CorrectionRequestDialog, type CorrectionTarget } from '@/components/CorrectionRequestDialog';
import { ReplaceMeterDialog } from '@/pages/plants/locators/LocatorDialogs';
import { ReasonDialog } from '@/components/ReasonDialog';
import { CorrectionReasonField } from '@/components/CorrectionReasonField';
import { MetaStrip } from '@/components/operations/MetaStrip';
import { ControlCluster } from '@/components/operations/ControlCluster';
import { StatusPill } from '@/components/StatusPill';
import { AnomalyRemarkBanner } from '@/components/AnomalyRemarkBanner';
import { OdometerRollerInput } from '@/components/OdometerRollerInput';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { fmtNum, ALERTS } from '@/lib/calculations';
import { fmtSaveToast, lastReadingFreshness } from '@/lib/format';
import { computeRate, classifyDeviation } from '@/lib/flowRateGuards';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { submitAnomalyRemark, isAnomalyRemarkValid } from '@/lib/anomalyRemarks';
import { isReasonComplete, resolveReason } from '@/lib/correctionReasons';
import { reasonCategoryLabel } from '@/lib/reasonCodes';
import { logReadingEdit, diffFields, canEditEntry } from '@/pages/ro-trains/helpers';
import { logProductionCalc, invalidateProductMeterDash } from '@/pages/operations/shared';
import {
  AlertCircle, Loader2, History, Gauge, CalendarClock, ArrowUpRight, MessageCircleOff,
  Droplet, Pencil, X
} from 'lucide-react';
import { ProductMeterHistoryDialog } from './ProductMeterRow/ProductMeterHistoryDialog';

function ProductMeterRow({
  meter, plantId, latest, gapReason, avgVol, userId, canEdit, onSaved, onGapReasonSaved, mirrorSource, rowRef, pulsing,
}: {
  meter: any;
  plantId: string;
  latest: any | null;
  gapReason?: any | null;
  avgVol?: number | null;
  userId: string | null;
  canEdit: boolean;
  onSaved: () => void;
  onGapReasonSaved?: () => void;
  mirrorSource?: { locatorName: string; plantName: string } | null;
  rowRef?: (el: HTMLDivElement | null) => void;
  pulsing?: boolean;
}) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [reading, setReading] = useState('');
  const lastPrefilledProduct = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [gapDialogOpen, setGapDialogOpen] = useState(false);
  const [gapSaving, setGapSaving] = useState(false);
  const [customDt, setCustomDt] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const dtInputRef = useRef<HTMLInputElement>(null);
  const [showReplaceMeter, setShowReplaceMeter] = useState(false);
  const [meterReplacePending, setMeterReplacePending] = useState<{ newInitialReading: number | null; replacementId: string | null } | null>(null);

  const previous = latest?.current_reading ?? null;
  const cur = +reading || 0;
  const readingChanged = reading !== '' && (previous == null || cur !== previous);
  const productionVolume = previous != null && readingChanged ? cur - previous : null;
  const [anomalyRemark, setAnomalyRemark] = useState('');
  const [showAnomalyBanner, setShowAnomalyBanner] = useState(false);

  const hoursElapsedProduct = latest?.reading_datetime && reading
    ? (new Date(customDt).getTime() - new Date(latest.reading_datetime).getTime()) / 3_600_000
    : null;
  const productionRate = computeRate(productionVolume, hoursElapsedProduct, undefined, true);
  const deviationProduct = classifyDeviation(productionRate, avgVol ?? null, ALERTS.product_spike_multiplier);
  const highVol = deviationProduct.tier !== 'ok';
  const anomalyRemarkRequired = highVol && !isAnomalyRemarkValid(anomalyRemark);

  useEffect(() => {
    if (previous == null) return;
    const expected = previous.toFixed(2);
    if (reading === '' || reading === lastPrefilledProduct.current) {
      setReading(expected);
      lastPrefilledProduct.current = expected;
    }
  }, [previous, reading]);

  const save = async () => {
    if (saving) return;
    if (!reading) { toast.error(`${meter.name}: enter a reading`); return; }

    if (previous != null && cur === previous && !meterReplacePending) {
      if (hoursElapsedProduct != null && hoursElapsedProduct < 12) {
        toast.error(`${meter.name}: this odometer reading (${fmtNum(cur, 1)}) was already recorded within the last 12 hours.`);
        return;
      }
    }

    if (anomalyRemarkRequired) {
      setShowAnomalyBanner(true);
      toast.error(`${meter.name}: this reading is outside the normal range (±75%) — add a remark before saving.`);
      return;
    }
    setSaving(true);
    const dt = new Date(customDt).toISOString();

    try {
      const dayObj = new Date(customDt);
      const dayStart = new Date(dayObj.getFullYear(), dayObj.getMonth(), dayObj.getDate(), 0, 0, 0, 0).toISOString();
      const dayEnd = new Date(dayObj.getFullYear(), dayObj.getMonth(), dayObj.getDate(), 23, 59, 59, 999).toISOString();
      await supabase
        .from('product_meter_readings' as any)
        .delete()
        .eq('meter_id', meter.id)
        .eq('is_estimated', true)
        .gte('reading_datetime', dayStart)
        .lte('reading_datetime', dayEnd);
    } catch (err) {
      console.warn('[Operations] Failed to purge orphan estimate on same day:', err);
    }

    const dailyVol = previous != null ? cur - previous : null;
    const { data: savedRow, error } = await supabase.from('product_meter_readings' as any).insert({
      meter_id: meter.id,
      plant_id: plantId,
      current_reading: cur,
      previous_reading: previous,
      reading_datetime: dt,
      recorded_by: userId,
      daily_volume: dailyVol,
      is_meter_replacement: !!meterReplacePending,
      ...(deviationProduct.tier === 'critical' ? { norm_status: 'pending_review' } : {}),
    } as any).select('id').single();
    if (error) {
      if ((error as any).code === '23505') {
        toast.error(
          `${meter.name}: a reading was already submitted for this time. Check the log before resubmitting.`,
          { duration: 8000 },
        );
      } else {
        toast.error(friendlyError(error));
      }
      setSaving(false);
      return;
    }

    if (meterReplacePending?.replacementId && (savedRow as any)?.id) {
      await (supabase.from('product_meter_replacements' as any) as any)
        .update({ reading_id: (savedRow as any).id })
        .eq('id', meterReplacePending.replacementId);
    }

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

  const todayDateStr = format(new Date(), 'yyyy-MM-dd');
  const hasReadingToday = latest?.reading_datetime && format(new Date(latest.reading_datetime), 'yyyy-MM-dd') === todayDateStr;

  return (
    <div
      ref={rowRef}
      className={cn(
        'instrument-housing p-4 space-y-3 transition-all border border-border/80 rounded-2xl mb-3 shadow-xs',
        pulsing ? 'ring-2 ring-accent ring-inset' : '',
      )}
      data-testid={`product-meter-row-${meter.id}`}
    >
      {/* Row 1: Name + Prioritized MetaStrip | compact date picker */}
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
          <span className="text-sm font-bold text-foreground break-words">{meter.name}</span>
          <MetaStrip
            primary={
              (() => {
                const fresh = lastReadingFreshness(latest?.reading_datetime);
                return (
                  <StatusPill tone={fresh.tone}>
                    <CalendarClock className="h-3 w-3" />
                    {fresh.label}
                  </StatusPill>
                );
              })()
            }
            alerts={[
              !hasReadingToday && {
                tone: 'warn',
                icon: MessageCircleOff,
                label: gapReason ? reasonCategoryLabel(gapReason.reason_category) : 'Log gap reason',
                onClick: () => setGapDialogOpen(true),
                testId: `product-gap-reason-btn-${meter.id}`,
              },
              latest?.is_estimated && {
                tone: 'warn',
                label: 'Estimated',
                title: 'Auto-backfilled reading — no manual operator entry on file.',
              },
              productionVolume != null && {
                tone: productionVolume < 0 ? 'danger' : 'primary',
                label: `Δ ${fmtNum(productionVolume)} m³`,
              },
            ].filter(Boolean)}
            overflow={[
              {
                icon: ArrowUpRight,
                label: 'Plant detail',
                onClick: () => navigate(`/plants/${plantId}?tab=product&highlight=${meter.id}`),
              },
            ]}
            maxVisible={4}
          />
        </div>

        <label className="shrink-0 cursor-pointer relative">
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
          <Input ref={dtInputRef} type="datetime-local" value={customDt}
            onChange={e => setCustomDt(e.target.value)}
            className="peer absolute inset-0 opacity-0 w-full h-full pointer-events-none"
            title="Reading date & time" />
        </label>
      </div>

      <div className="recessed-glass p-2.5 sm:p-3 flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs text-muted-foreground">
          prev: <span className="font-mono-num font-semibold text-foreground">{previous == null ? '—' : fmtNum(previous)}</span>
          {productionVolume != null && (
            <>
              {' · '}
              <span className={cn('font-mono-num font-semibold', productionVolume < 0 ? 'text-destructive' : 'text-primary')}>{fmtNum(productionVolume)} m³</span>
              {' produced'}
            </>
          )}
        </div>
      </div>

      {isMobile ? (
        <div className="space-y-2.5">
          <OdometerRollerInput
            value={reading}
            onChange={setReading}
            alertState="neutral"
            disabled={saving}
            testId={`product-meter-input-${meter.id}`}
          />
          <div className="flex items-center gap-2">
            <Button
              onClick={save} disabled={saving || !readingChanged || (showAnomalyBanner && anomalyRemarkRequired)}
              className={cn(
                'flex-1 h-11 rounded-full text-sm font-semibold shadow-sm transition-all',
                readingChanged
                  ? 'bg-primary hover:bg-primary/90 active:scale-[0.98] text-primary-foreground'
                  : 'bg-muted text-muted-foreground/60 border border-border/40 hover:bg-muted cursor-not-allowed',
              )}
              data-testid={`product-meter-save-${meter.id}`}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save reading'}
            </Button>
            {canEdit && (
              <ControlCluster
                actions={[
                  {
                    icon: History,
                    title: 'View history',
                    onClick: () => setShowHistory(true),
                  },
                ]}
              />
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          <div className="relative flex-1 min-w-0">
            <Gauge className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary pointer-events-none" />
            <Input
              type="number" step="any" inputMode="decimal"
              value={reading}
              onChange={(e) => { setReading(e.target.value); setShowAnomalyBanner(false); }}
              placeholder="Product Reading"
              className="h-11 pl-9 w-full rounded-xl border-primary/30 focus-visible:ring-primary bg-primary-soft/30 font-mono-num font-medium"
              data-testid={`product-meter-input-${meter.id}`}
            />
          </div>
          <Button
            onClick={save}
            disabled={saving || !readingChanged || (showAnomalyBanner && anomalyRemarkRequired)}
            className={cn(
              'h-11 px-6 rounded-full text-sm font-semibold shrink-0 shadow-sm transition-all',
              readingChanged
                ? 'bg-primary hover:bg-primary/90 active:scale-[0.98] text-primary-foreground'
                : 'bg-muted text-muted-foreground/60 border border-border/40 hover:bg-muted cursor-not-allowed',
            )}
            data-testid={`product-meter-save-${meter.id}`}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save reading'}
          </Button>
          {canEdit && (
            <ControlCluster
              actions={[
                {
                  icon: History,
                  title: 'View history',
                  onClick: () => setShowHistory(true),
                },
              ]}
            />
          )}
        </div>
      )}

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

      {productionVolume != null && productionVolume >= 0 && highVol && (showAnomalyBanner || anomalyRemark.trim().length > 0) && (
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

      <ReasonDialog
        open={gapDialogOpen}
        onOpenChange={setGapDialogOpen}
        title={`No reading today for "${meter.name}" — why?`}
        description="This explains the gap in Data Summary for today. If a reading comes in later today, it takes priority over this note."
        confirmLabel="Log reason"
        busy={gapSaving}
        onConfirm={async (category, detail) => {
          setGapSaving(true);
          const { error } = await supabase.from('reading_gap_reasons' as any).upsert(
            [{
              entity_type: 'product', entity_id: meter.id, plant_id: plantId,
              gap_date: todayDateStr, reason_category: category, reason_detail: detail || null,
              logged_by: userId ?? null,
            }] as any,
            { onConflict: 'entity_type,entity_id,gap_date' },
          );
          setGapSaving(false);
          if (error) { toast.error(friendlyError(error)); return; }
          toast.success(`${meter.name}: reason logged`);
          setGapDialogOpen(false);
          onGapReasonSaved?.();
        }}
      />
    </div>
  );
}

export { ProductMeterRow };
