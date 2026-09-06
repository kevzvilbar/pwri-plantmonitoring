import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIsMobile } from '@/hooks/use-mobile';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useDraft } from '@/hooks/useDraft';
import { CorrectionRequestDialog, type CorrectionTarget } from '@/components/CorrectionRequestDialog';
import { ReadingHistoryDialog } from '@/components/ReadingHistoryDialog';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { fmtNum, ALERTS } from '@/lib/calculations';
import { computeRate, classifyDeviation } from '@/lib/flowRateGuards';
import { fmtSaveToast, lastReadingFreshness } from '@/lib/format';
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
  // "Meter replaced" — same two-way wiring fix as WellRow/LocatorRow: live at
  // entry time (previously only reachable from the meter's history dialog).
  const [showReplaceMeter, setShowReplaceMeter] = useState(false);
  const [meterReplacePending, setMeterReplacePending] = useState<{ newInitialReading: number | null; replacementId: string | null } | null>(null);

  const previous = latest?.current_reading ?? null;
  const cur = +reading || 0;
  const readingChanged = reading !== '' && (previous == null || cur !== previous);
  const productionVolume = previous != null && readingChanged ? cur - previous : null;
  // Required whenever the flow rate falls outside ±75% of the 10-day average
  // (see flowRateGuards.ts) — cleared after every successful save.
  const [anomalyRemark, setAnomalyRemark] = useState('');
  const [showAnomalyBanner, setShowAnomalyBanner] = useState(false);
  // Q = V / t: avgVol (from ProductSection's avgByMeter, now a true rolling-
  // average rate, not a naive average of raw daily_volume — see
  // computeRollingAverageRateFromDeltas in flowRateGuards.ts) is m³/hr, so
  // productionVolume needs the same conversion before comparing.
  const hoursElapsedProduct = latest?.reading_datetime && reading
    ? (new Date(customDt).getTime() - new Date(latest.reading_datetime).getTime()) / 3_600_000
    : null;
  const productionRate = computeRate(productionVolume, hoursElapsedProduct, undefined, true);
  const deviationProduct = classifyDeviation(productionRate, avgVol ?? null, ALERTS.product_spike_multiplier);
  const highVol = deviationProduct.tier !== 'ok';
  const anomalyRemarkRequired = highVol && !isAnomalyRemarkValid(anomalyRemark);

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
    // Re-entrancy guard: ignore a second call while the first is still
    // in-flight (double-tap, slow network + impatient re-tap, etc.) — same
    // guard PretreatmentAndROLog.tsx's submit() uses.
    if (saving) return;
    if (!reading) { toast.error(`${meter.name}: enter a reading`); return; }

    // Redundancy Guard (12 hours): identical odometer reading within 12h cannot be saved
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

    // Purge any orphan auto-backfill estimate on the same date so it cannot coexist with the human reading
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

    // Bug fix: persist daily_volume so Dashboard/TrendChart can sum it directly,
    // mirroring the same fix already applied to locator_readings and well_readings.
    const dailyVol = previous != null ? cur - previous : null;
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
    if (error) {
      // 23505 = unique_violation: a reading already exists for this meter at
      // this exact timestamp — see well_readings/locator_readings' identical
      // handling and 20260816000000_meter_readings_dedupe_and_unique_
      // constraints.sql. Most commonly hit by tapping Save again after the
      // input re-filled with the just-saved value.
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

        {/* Date picker */}
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

      {/* Row 2: Recessed Telemetry Panel */}
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

      {/* Row 3: reading input + save + history */}
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

// ── Product meter history dialog ──────────────────────────────────────────────

function ProductMeterHistoryDialog({ meter, plantId, onClose }: { meter: any; plantId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { user, activeOperator, isAdmin, isManager, isDataAnalyst, activeOperatorId } = useAuth();
  // This dialog previously had NO ownership/time/pending-review restriction
  // at all on Edit/Delete — any signed-in user could edit or delete any
  // other operator's product-meter reading, any time, even mid-review.
  // Every other reading module (well/locator/power/blending/RO) already
  // gates this the same way; product_meter_readings was the one table that
  // never got wired up (see the 2026-08-11 audit-log comment above).
  const hasFullAccess = isAdmin || isManager || isDataAnalyst;
  const [days, setDays] = useState<7 | 14 | 30 | 60 | 'custom'>(30);
  const [customFrom, setCustomFrom] = useState(format(new Date(Date.now() - 30 * 86400000), 'yyyy-MM-dd'));
  const [customTo, setCustomTo]     = useState(format(new Date(), 'yyyy-MM-dd'));
  const [appliedFrom, setAppliedFrom] = useState(customFrom);
  const [appliedTo, setAppliedTo]     = useState(customTo);
  const [editRow, setEditRow] = useState<{ id: string; datetime: string; value: string } | null>(null);
  // Required "why was this edit made" — same CORRECTION_REASONS dropdown
  // every other edit-an-already-saved-reading dialog uses (RO train,
  // pretreatment, locator, well, power, blending, dosing/CIP logs). This
  // was the one reading table that never got wired to it — see
  // 20260811_reading_audit_log_add_product_meter.sql.
  const [reason, setReason] = useState('');
  const [customReason, setCustomReason] = useState('');
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
        .select('id, current_reading, previous_reading, daily_volume, reading_datetime, is_meter_replacement, is_estimated, recorded_by, created_at, norm_status')
        .eq('meter_id', meter.id)
        .gte('reading_datetime', sinceIso)
        .lte('reading_datetime', untilIso)
        .order('reading_datetime', { ascending: false });
      if (!error) return (data ?? []) as any[];
      // is_meter_replacement may not exist yet (pending migration) — fall back
      // to the base columns so the dialog still loads.
      const { data: fallback, error: fallbackErr } = await supabase
        .from('product_meter_readings' as any)
        .select('id, current_reading, previous_reading, daily_volume, reading_datetime, is_estimated, recorded_by, created_at, norm_status')
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
      const newVol = newPrev != null ? +row.current_reading - newPrev : null;
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

  const actorLabel = () =>
    `${activeOperator?.first_name ?? ''} ${activeOperator?.last_name ?? ''}`.trim()
    || activeOperator?.username || null;

  const saveEdit = async () => {
    if (!editRow) return;
    const beforeRowCheck = rows?.find((r: any) => r.id === editRow.id);
    if (!beforeRowCheck || !canEditEntry(beforeRowCheck, hasFullAccess, activeOperatorId)) {
      toast.error(
        beforeRowCheck?.norm_status === 'pending_review'
          ? 'This reading is flagged and awaiting review in Data Corrections — it can’t be edited until a reviewer approves or rejects it.'
          : 'You can only edit your own entries, within 8 hours of submitting them.',
      );
      setEditRow(null);
      return;
    }
    if (!reason) { toast.error('Select a reason for this edit'); return; }
    if (!isReasonComplete(reason, customReason)) { toast.error('Describe the reason for this edit'); return; }
    setSaving(true);
    const newCur = +editRow.value;
    const beforeRow = beforeRowCheck ?? null;
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
      const newDailyVol = existingPrev != null ? newCur - existingPrev : null;
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
    await logReadingEdit({
      table_name:    'product_meter_readings',
      record_id:     editRow.id,
      plant_id:      plantId,
      actor_user_id: user?.id ?? null,
      actor_label:   actorLabel(),
      changes:       diffFields(beforeRow ?? {}, updatePayload),
      reason:        resolveReason(reason, customReason),
    });
    setSaving(false);
    toast.success('Reading updated');
    setEditRow(null); setReason(''); setCustomReason('');
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
    const row = rows?.find((r: any) => r.id === id);
    if (!row || !canEditEntry(row, hasFullAccess, activeOperatorId)) {
      toast.error(
        row?.norm_status === 'pending_review'
          ? 'This reading is flagged and awaiting review in Data Corrections — it can’t be deleted until a reviewer approves or rejects it.'
          : 'You can only delete your own entries, within 8 hours of submitting them.',
      );
      setPendingDeleteId(null);
      return;
    }
    setPendingDeleteId(null);
    setDeletingId(id);
    const { error } = await supabase.from('product_meter_readings' as any).delete().eq('id', id);
    if (error) { setDeletingId(null); toast.error(friendlyError(error)); return; }
    await logReadingEdit({
      table_name:    'product_meter_readings',
      record_id:     id,
      plant_id:      plantId,
      action:        'delete',
      actor_user_id: user?.id ?? null,
      actor_label:   actorLabel(),
    });
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
                  days === d ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}>{label}</button>
            ))}
            <button onClick={() => { setDays('custom'); setEditRow(null); }}
              className={['px-3 py-1 text-xs font-medium rounded-md transition-all',
                days === 'custom' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
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
              <Button size="sm" className="h-7 px-3 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
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
                <Label htmlFor="productsection-date-amp-time" className="text-xs">Date &amp; Time</Label>
                <Input type="datetime-local" value={editRow.datetime}
                  onChange={e => setEditRow({ ...editRow, datetime: e.target.value })} className="h-8 text-xs" id="productsection-date-amp-time"/>
              </div>
              <div>
                <Label htmlFor="productsection-field" className="text-xs">{meter.is_derived ? 'Volume (m³)' : 'Reading'}</Label>
                <Input type="number" step="any" value={editRow.value}
                  onChange={e => setEditRow({ ...editRow, value: e.target.value })} className="h-8 text-xs" id="productsection-field"/>
              </div>
            </div>
            <CorrectionReasonField
              reason={reason} onReasonChange={setReason}
              customReason={customReason} onCustomReasonChange={setCustomReason}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={saveEdit} disabled={saving || !editRow.value || !isReasonComplete(reason, customReason)}
                className="bg-primary text-primary-foreground hover:bg-primary/90 h-7 text-xs px-3">
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save changes'}
              </Button>
              <Button size="sm" variant="outline"
                onClick={() => { setEditRow(null); setReason(''); setCustomReason(''); }}
                disabled={saving} className="h-7 text-xs px-3">Cancel</Button>
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
                  const isEstimated = !!r.is_estimated;
                  const rowEditable = canEditEntry(r, hasFullAccess, activeOperatorId);
                  return (
                    <tr key={r.id ?? i} className={[
                      'border-t',
                      isEditing            ? 'bg-primary-soft/60'
                      : isMeterReplacement ? 'bg-kpi-solar/40'
                      : isEstimated        ? 'bg-warn-soft/20'
                      : 'hover:bg-muted/40',
                    ].join(' ')}>
                      <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          {r.reading_datetime ? format(new Date(r.reading_datetime), 'MMM d, yyyy HH:mm') : '—'}
                          {isEstimated && (
                            <span className="text-3xs font-semibold uppercase tracking-wide text-warn bg-warn-soft/40 px-1 py-0.5 rounded leading-none border border-warn/40" title="Auto-backfilled reading">
                              Est.
                            </span>
                          )}
                          {isMeterReplacement && (
                            <span className="text-3xs font-semibold uppercase tracking-wide text-kpi-solar bg-kpi-solar/15 px-1 py-0.5 rounded leading-none">
                              repl.
                            </span>
                          )}
                        </span>
                      </td>
                      {meter.is_derived ? (
                        <td className={cn('px-3 py-1.5 text-right font-mono-num', (r.daily_volume ?? r.current_reading) < 0 ? 'text-destructive font-semibold' : 'text-primary')}>
                          {fmtNum(r.daily_volume ?? r.current_reading, 1)}
                        </td>
                      ) : (
                        <>
                          <td className="px-3 py-1.5 text-right font-mono-num">{fmtNum(r.current_reading, 1)}</td>
                          <td className="px-3 py-1.5 text-right font-mono-num text-primary">
                            {isMeterReplacement
                              ? <span className="text-kpi-solar font-medium">0.0</span>
                              : vol != null ? <span className={vol < 0 ? 'text-destructive font-semibold' : ''}>{fmtNum(vol, 1)}</span> : '—'
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
                        {rowEditable && (
                          <div className="flex items-center justify-center gap-0.5">
                            <button title="Edit" aria-label="Edit" disabled={!!editRow || isDeleting}
                              onClick={() => {
                                setPendingDeleteId(null);
                                setReason(''); setCustomReason('');
                                setEditRow({ id: r.id, datetime: format(new Date(r.reading_datetime), "yyyy-MM-dd'T'HH:mm"), value: String(r.current_reading) });
                              }}
                              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40">
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button title="Delete" aria-label="Delete" disabled={!!editRow || isDeleting}
                              onClick={() => setPendingDeleteId(r.id)}
                              className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-40">
                              {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                            </button>
                          </div>
                        )}
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

export { ProductMeterRow };
