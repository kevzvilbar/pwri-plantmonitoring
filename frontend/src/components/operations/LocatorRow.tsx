import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useDraft } from '@/hooks/useDraft';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { CorrectionRequestDialog, type CorrectionTarget } from '@/components/CorrectionRequestDialog';
import { CorrectionReasonField } from '@/components/CorrectionReasonField';
import { StatusPill } from '@/components/StatusPill';
import { ReplaceMeterDialog } from '@/pages/plants/locators/LocatorDialogs';
import { ControlCluster } from '@/components/operations/ControlCluster';
import { MetaStrip } from '@/components/operations/MetaStrip';
import { MapPin, Pencil, X, Droplet, Zap, Upload, Download, FileText, AlertCircle, AlertTriangle, Loader2, History, FlaskConical, Keyboard, MessageCircleOff, CalendarClock, RefreshCw, PencilLine, ShieldAlert, ArrowUpRight, Lock, SquarePen } from 'lucide-react';
import { DerivedMeterIcon } from '@/components/icons/water-icons';
import { OdometerRollerInput, MobileCarousel, type OdometerAlertState } from '@/components/OdometerRollerInput';
import { evaluateReadingGuard, SPIKE_MULTIPLIER } from '@/lib/readingGuards';
import { computeRate, classifyDeviation } from '@/lib/flowRateGuards';
import { AnomalyRemarkBanner } from '@/components/AnomalyRemarkBanner';
import { submitAnomalyRemark, isAnomalyRemarkValid } from '@/lib/anomalyRemarks';
import { ReadingHistoryDialog } from '@/components/ReadingHistoryDialog';
import {
  GridPylonIcon, WELL_MAX_READINGS_PER_DAY,
  formatCooldown, invalidateLocatorDash, invalidateWellDash, invalidateDashboard,
  invalidateProductMeterDash, invalidatePowerDash, invalidateRODash, invalidateChemDash,
} from '../../pages/operations/shared';
import { ReasonDialog } from '@/components/ReasonDialog';
import { reasonCategoryLabel } from '@/lib/reasonCodes';
import { DerivedMeterOverrideDialog } from '@/components/DerivedMeterOverrideDialog';
import { isReasonComplete, resolveReason } from '@/lib/correctionReasons';
import { logReadingEdit, diffFields } from '@/pages/ro-trains/helpers';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { fmtNum, getCurrentPosition, isOffLocation, ALERTS } from '@/lib/calculations';
import { fmtSaveToast, lastReadingFreshness } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  insertDerivedOverrideRows, HAMAS_OVERRIDE_SCHEMA, HAMAS_OVERRIDE_TEMPLATE_ROW,
  syncDerivedLocatorMirrors,
} from '@/data/mutations/locators';
import { validateDerivedOverrideRow } from '@/lib/readingValidation';
import { ImportReadingsDialog } from '@/components/ReadingImportDialog';

function LocatorRow({
  locator, plantId, previous, previousDt, latestReading, todayReadings, avgVol, userId, onSaved, isManagerOrAdmin, maxReadingsPerDay = 3,
  gapReason, onGapReasonSaved, rowRef, pulsing,
}: {
  locator: any; plantId: string; previous: number | null; previousDt: string | null;
  latestReading?: any | null;
  todayReadings: any[]; avgVol: number | null;
  userId: string | undefined; onSaved: () => void;
  isManagerOrAdmin: boolean;
  maxReadingsPerDay?: number;
  gapReason?: any | null;
  onGapReasonSaved?: () => void;
  rowRef?: (el: HTMLDivElement | null) => void;
  pulsing?: boolean;
}) {
  const isMobile = useIsMobile();
  const qc = useQueryClient();

  const [reading, setReading]     = useState('');
  const lastPrefilledLoc = useRef<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBefore, setEditBefore] = useState<Record<string, unknown> | null>(null);
  const [editReason, setEditReason] = useState('');
  const [editCustomReason, setEditCustomReason] = useState('');
  const [saving, setSaving]       = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [customDt, setCustomDt]   = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const dtInputRef = useRef<HTMLInputElement>(null);
  const [gapDialogOpen, setGapDialogOpen] = useState(false);
  const [gapSaving, setGapSaving] = useState(false);
  const [showReplaceMeter, setShowReplaceMeter] = useState(false);
  const [meterReplacePending, setMeterReplacePending] = useState<{ newInitialReading: number | null; replacementId: string | null } | null>(null);
  const [anomalyRemark, setAnomalyRemark] = useState('');

  const { draft: draftReading, setDraft: setDraftReading, clearDraft: clearDraftReading } =
    useDraft(`loc-reading-${locator.id}`, { value: '' });
  useEffect(() => {
    if (reading === '' && draftReading.value) setReading(draftReading.value);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const locInputMode: 'raw' | 'direct' = locator.default_input_mode === 'direct' ? 'direct' : 'raw';

  useEffect(() => {
    if (locInputMode !== 'raw' || previous == null || editingId) return;
    const expected = previous.toFixed(2);
    if (reading === '' || reading === lastPrefilledLoc.current) {
      setReading(expected);
      lastPrefilledLoc.current = expected;
    }
  }, [previous, locInputMode, editingId, reading]);

  const [showAnomalyBanner, setShowAnomalyBanner] = useState(false);

  const startEdit = (readingRow: any) => {
    if (!readingRow) return;
    setEditingId(readingRow.id);
    setReading(String(readingRow.current_reading));
    if (readingRow.reading_datetime) {
      setCustomDt(new Date(readingRow.reading_datetime).toISOString().slice(0, 16));
    }
    setAnomalyRemark(readingRow.anomaly_remark ?? '');
    setShowAnomalyBanner(false);
    setEditBefore({
      current_reading: readingRow.current_reading ?? null,
      reading_datetime: readingRow.reading_datetime ?? null,
      daily_volume: readingRow.daily_volume ?? null,
      is_meter_replacement: !!readingRow.is_meter_replacement,
      is_estimated: !!readingRow.is_estimated,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setReading(previous != null ? previous.toFixed(2) : '');
    setCustomDt(new Date().toISOString().slice(0, 16));
    setAnomalyRemark('');
    setShowAnomalyBanner(false);
    setEditBefore(null); setEditReason(''); setEditCustomReason('');
  };

  const cur      = +reading || 0;
  const readingChanged = reading !== '' && (previous == null || cur !== previous || editingId != null);
  const dailyVol = locInputMode === 'direct'
    ? (reading ? +reading : null)
    : (readingChanged && previous != null ? cur - previous : null);
  const belowPrev = locInputMode === 'raw' && previous != null && cur > 0 && cur < previous;
  const hoursElapsedLoc = previousDt && reading
    ? (new Date(customDt).getTime() - new Date(previousDt).getTime()) / 3_600_000
    : null;
  const currentFlowRateLoc = locInputMode === 'raw' ? computeRate(dailyVol, hoursElapsedLoc, undefined, true) : null;
  const deviationLoc = locInputMode === 'raw'
    ? classifyDeviation(currentFlowRateLoc, avgVol, SPIKE_MULTIPLIER)
    : { tier: 'ok' as const, direction: null, rate: null, avgRate: null, deviationPct: null };
  const highVol = deviationLoc.tier !== 'ok';
  const anomalyRemarkRequired = deviationLoc.tier !== 'ok' && !isAnomalyRemarkValid(anomalyRemark);
  const todayCount = todayReadings.length;
  const lastToday  = todayReadings[0] ?? null;
  const atLimit    = !editingId && todayCount >= maxReadingsPerDay;
  const freshness  = lastReadingFreshness(previousDt);
  const navigate   = useNavigate();

  const odometerAlert: OdometerAlertState =
    !readingChanged   ? 'neutral' :
    belowPrev         ? 'warn'    :
    highVol           ? 'warn'    :
    (+reading < 0 && locInputMode === 'raw') ? 'error' :
    'ok';

  const [lastSavePending, setLastSavePending] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [cooldownMinutes, setCooldownMinutes] = useState(0);
  const [cooldownAvailableAt, setCooldownAvailableAt] = useState<Date | null>(null);
  const [correctionTarget, setCorrectionTarget] = useState<CorrectionTarget | null>(null);

  const save = async () => {
    if (saving) return;
    if (!reading) { toast.error(`${locator.name}: enter a reading`); return; }
    if (atLimit) { toast.error(`${locator.name}: max ${maxReadingsPerDay} readings/day reached`); return; }
    if (locInputMode === 'direct' && +reading <= 0) { toast.error(`${locator.name}: enter a positive volume`); return; }

    if (editingId && !isReasonComplete(editReason, editCustomReason)) {
      toast.error(`${locator.name}: select a reason for this edit`);
      return;
    }

    if (!editingId && locInputMode === 'raw' && previous != null && cur === previous && !meterReplacePending) {
      if (hoursElapsedLoc != null && hoursElapsedLoc < 12) {
        toast.error(`${locator.name}: this odometer reading (${fmtNum(cur, 1)}) was already recorded within the last 12 hours.`);
        return;
      }
    }

    if (anomalyRemarkRequired) {
      setShowAnomalyBanner(true);
      toast.error(`${locator.name}: this reading is outside the normal range (±75%) — add a remark before saving.`);
      return;
    }

    if (!editingId && userId) {
      setSaving(true);
      const guard = await evaluateReadingGuard(
        'locator', locator.id, plantId, userId,
        cur,
        new Date(customDt), !!meterReplacePending, false, avgVol, false, locInputMode,
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
      if (guard.status === 'blocked' && guard.reason === 'duplicate') {
        toast.error(`${locator.name}: ${guard.detail}`, { duration: 8000 });
        return;
      }
      if (guard.status === 'pending_review') {
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

    const payload: any = locInputMode === 'direct'
      ? {
          locator_id: locator.id, plant_id: plantId,
          current_reading: cur,
          gps_lat, gps_lng, off_location_flag: off, recorded_by: userId,
          reading_datetime: new Date(customDt).toISOString(),
          is_estimated: false,
        }
      : {
          locator_id: locator.id, plant_id: plantId,
          current_reading: cur,
          gps_lat, gps_lng, off_location_flag: off, recorded_by: userId,
          reading_datetime: new Date(customDt).toISOString(),
          is_estimated: false,
          is_meter_replacement: !!meterReplacePending,
        };

    if (!editingId) {
      try {
        const dt = new Date(customDt);
        const dayStart = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 0, 0, 0, 0).toISOString();
        const dayEnd = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59, 999).toISOString();
        await supabase
          .from('locator_readings')
          .delete()
          .eq('locator_id', locator.id)
          .eq('is_estimated', true)
          .gte('reading_datetime', dayStart)
          .lte('reading_datetime', dayEnd);
      } catch (err) {
        console.warn('[Operations] Failed to purge orphan estimate on same day:', err);
      }
    }

    const { data: savedRow, error } = editingId
      ? await (supabase.from('locator_readings').update(payload).eq('id', editingId).select('id,norm_status,current_reading,previous_reading,daily_volume').single() as any)
      : await (supabase.from('locator_readings').insert(payload).select('id,norm_status,current_reading,previous_reading,daily_volume').single() as any);

    setSaving(false);

    if (error) {
      if (error.code === '23505') {
        toast.error(
          `${locator.name}: a reading was already submitted for this time. Check the log before resubmitting.`,
          { duration: 8000 },
        );
      } else {
        toast.error(friendlyError(error));
      }
      return;
    }

    if (editingId && editBefore) {
      const after: Record<string, unknown> = {
        current_reading: payload.current_reading,
        reading_datetime: payload.reading_datetime,
        is_estimated: !!payload.is_estimated,
        is_meter_replacement: !!payload.is_meter_replacement,
      };
      await logReadingEdit({
        table_name: 'locator_readings',
        record_id: editingId,
        plant_id: plantId,
        action: 'update',
        actor_user_id: userId ?? null,
        actor_label: actorLabel,
        changes: diffFields(editBefore, after),
        reason: resolveReason(editReason, editCustomReason),
      });
    }

    if (meterReplacePending?.replacementId && savedRow?.id) {
      await (supabase.from('locator_meter_replacements' as any) as any)
        .update({ reading_id: savedRow.id })
        .eq('id', meterReplacePending.replacementId);
    }

    if (deviationLoc.tier !== 'ok' && savedRow?.id) {
      void submitAnomalyRemark({
        table_name: 'locator_readings',
        record_id: savedRow.id,
        plant_id: plantId,
        tier: deviationLoc.tier,
        direction: deviationLoc.direction!,
        deviation_pct: deviationLoc.deviationPct!,
        flow_rate: deviationLoc.rate,
        avg_flow_rate: deviationLoc.avgRate,
        rate_unit: 'm3/hr',
        remark_text: anomalyRemark,
      });
    }
    setAnomalyRemark('');

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
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 500);
    setReading(''); clearDraftReading(); setEditingId(null); onSaved();
    setMeterReplacePending(null); setShowReplaceMeter(false);
    setEditBefore(null); setEditReason(''); setEditCustomReason('');
  };

  const { user } = useAuth();
  const actorLabel = user?.email ?? 'Unknown user';

  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [recalcSaving, setRecalcSaving] = useState(false);
  const [importOverrideOpen, setImportOverrideOpen] = useState(false);

  const { data: reviewFlag } = useQuery({
    queryKey: ['derived-review-flag', locator.id],
    queryFn: async () => {
      const { data, error } = await (supabase.from('locator_derived_review_flags' as any) as any)
        .select('id, date_key, flagged_at')
        .eq('locator_id', locator.id)
        .is('resolved_at', null)
        .order('flagged_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; date_key: string; flagged_at: string } | null;
    },
    enabled: !!locator.is_derived,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const recalcNow = async () => {
    setRecalcSaving(true);
    try {
      const p_date = format(new Date(), 'yyyy-MM-dd');
      const { error } = await (supabase.rpc as any)('fn_sweep_derived_meters', { p_date, p_lookback_days: 3 });
      if (error) throw error;
      toast.success(`${locator.name}: recalculated.`);
      qc.invalidateQueries({ queryKey: ['op-loc-latest'] });
      qc.invalidateQueries({ queryKey: ['derived-review-flag', locator.id] });
      qc.invalidateQueries({ queryKey: ['reading-history', 'locator', locator.id] });
    } catch (err: any) {
      toast.error(friendlyError(err));
    } finally {
      setRecalcSaving(false);
    }
  };

  const saveOverride = async (value: number, reason: string) => {
    setOverrideSaving(true);
    try {
      const before = latestReading
        ? { current_reading: latestReading.current_reading, is_estimated: latestReading.is_estimated }
        : {};
      const payload: any = {
        locator_id: locator.id, plant_id: plantId,
        current_reading: value, previous_reading: 0, is_estimated: false,
        recorded_by: userId,
      };
      const { data: savedRow, error } = latestReading?.id
        ? await supabase.from('locator_readings').update(payload).eq('id', latestReading.id).select().single()
        : await supabase.from('locator_readings').insert({ ...payload, reading_datetime: new Date().toISOString() }).select().single();
      if (error) throw error;

      await logReadingEdit({
        table_name: 'locator_readings',
        record_id: (savedRow as any)?.id ?? null,
        plant_id: plantId,
        actor_user_id: userId ?? null,
        actor_label: actorLabel,
        changes: { ...diffFields(before, { current_reading: value, is_estimated: false }), override_reason: { old: null, new: reason } },
        reason,
      });

      try {
        await syncDerivedLocatorMirrors(
          locator.id,
          (savedRow as any)?.reading_datetime ?? new Date().toISOString(),
          value,
        );
      } catch (mirrorErr: any) {
        console.error('[saveOverride] mirror sync failed:', mirrorErr);
        toast.warning(`${locator.name}: override saved, but mirror sync failed — the other plant's meter may be out of date until the next sweep.`);
      }

      toast.success(`${locator.name}: override saved.`);
      setOverrideOpen(false);
      qc.invalidateQueries({ queryKey: ['op-loc-latest'] });
      qc.invalidateQueries({ queryKey: ['derived-review-flag', locator.id] });
      qc.invalidateQueries({ queryKey: ['reading-history', 'locator', locator.id] });
      qc.invalidateQueries({ queryKey: ['product-meter-readings'] });
      qc.invalidateQueries({ queryKey: ['product-meter-dash'] });
      onSaved();
    } catch (err: any) {
      toast.error(friendlyError(err));
    } finally {
      setOverrideSaving(false);
    }
  };

  if (locator.is_derived) {
    return (
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground break-words">{locator.name}</div>
            <span className="inline-flex items-center gap-1 text-3xs font-bold uppercase tracking-widest bg-warn-soft text-warn px-1.5 py-0.5 rounded-full shrink-0">
              <DerivedMeterIcon className="h-2.5 w-2.5" /> Derived
            </span>
          </div>
          {isManagerOrAdmin && (
            <Button variant="ghost" size="sm"
              className="h-9 w-9 p-0 rounded-lg shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted"
              onClick={() => setShowHistory(true)} title="View computed reading history">
              <History className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {reviewFlag && (
          <div className="flex items-center gap-1.5 text-xs text-warn bg-warn-soft border border-warn/40 rounded-lg px-3 py-2">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-warn" />
            <span>
              Needs review — a sibling locator or the mother meter changed for {new Date(reviewFlag.date_key).toLocaleDateString()} since this was last computed.
            </span>
          </div>
        )}

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 border border-border/60 rounded-lg px-3 py-2">
          <DerivedMeterIcon className="h-3.5 w-3.5 shrink-0 text-warn" />
          <span>
            No physical meter — volume is auto-computed as mother meter minus other locators.
            {latestReading ? (
              latestReading.is_estimated === false ? (
                <> Manually overridden: <span className="font-mono-num font-medium text-foreground/80">{fmtNum(latestReading.daily_volume)} m³</span> on {new Date(latestReading.reading_datetime).toLocaleDateString()}.</>
              ) : (
                <> Last computed: <span className="font-mono-num font-medium text-foreground/80">{fmtNum(latestReading.daily_volume)} m³</span> on {new Date(latestReading.reading_datetime).toLocaleDateString()}.</>
              )
            ) : (
              <> Not yet computed — waiting on the next sweep (runs every 8h), or recalculate now below.</>
            )}
          </span>
        </div>

        {isManagerOrAdmin && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" disabled={recalcSaving} onClick={recalcNow}>
              {recalcSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Recalculate now
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => setOverrideOpen(true)}>
              <PencilLine className="h-3.5 w-3.5" />
              Override
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => setImportOverrideOpen(true)}>
              <Upload className="h-3.5 w-3.5" />
              Import CSV
            </Button>
          </div>
        )}

        {showHistory && (
          <ReadingHistoryDialog
            entityName={locator.name}
            module="locator"
            entityId={locator.id}
            plantId={plantId}
            assetMeterSerial={locator.meter_serial}
            defaultInputMode={locator.default_input_mode === 'direct' ? 'direct' : 'raw'}
            onClose={() => setShowHistory(false)}
          />
        )}
        {overrideOpen && (
          <DerivedMeterOverrideDialog
            open={overrideOpen}
            onOpenChange={setOverrideOpen}
            locatorName={locator.name}
            currentValue={latestReading?.daily_volume ?? null}
            busy={overrideSaving}
            onConfirm={saveOverride}
          />
        )}
        {importOverrideOpen && (
          <ImportReadingsDialog
            title={`Bulk Override ${locator.name} from CSV`}
            module="Derived Meter Override"
            plantId={plantId}
            userId={userId ?? null}
            schemaHint={HAMAS_OVERRIDE_SCHEMA}
            templateFilename={`${locator.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_override_template.csv`}
            templateRow={HAMAS_OVERRIDE_TEMPLATE_ROW}
            validateRow={validateDerivedOverrideRow}
            insertRows={(rows, pid) => insertDerivedOverrideRows(rows, pid, locator.id, userId ?? null, actorLabel)}
            onClose={() => setImportOverrideOpen(false)}
            onImported={() => {
              setImportOverrideOpen(false);
              qc.invalidateQueries({ queryKey: ['op-loc-latest'] });
              qc.invalidateQueries({ queryKey: ['derived-review-flag', locator.id] });
              qc.invalidateQueries({ queryKey: ['reading-history', 'locator', locator.id] });
              onSaved();
            }}
          />
        )}
      </div>
    );
  }

  const lastTodayAge  = lastToday ? (Date.now() - new Date(lastToday.reading_datetime).getTime()) / 60_000 : Infinity;
  const isLocked      = !!(lastToday as any)?.locked_at;
  const canSelfEdit   = lastTodayAge <= 120 && !isLocked;
  const canRequest    = lastTodayAge > 120 && lastTodayAge < 7 * 24 * 60 && !isLocked;

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
      <ControlCluster
        actions={[
          lastToday && !editingId && canSelfEdit && {
            icon: Pencil,
            title: `Edit last reading (${fmtNum(lastToday.current_reading)})`,
            onClick: () => { setEditingId(lastToday.id); setReading(String(lastToday.current_reading)); },
          },
          editingId && {
            icon: X,
            title: 'Cancel edit',
            variant: 'danger',
            onClick: () => { setEditingId(null); setReading(''); },
          },
          isManagerOrAdmin && {
            icon: History,
            title: 'View reading history',
            onClick: () => setShowHistory(true),
          },
          isLocked && lastToday && !editingId && {
            icon: Lock,
            label: 'Locked',
            title: 'Reading approved by supervisor — locked from editing',
            variant: 'danger',
            disabled: true,
            onClick: () => {},
          },
          lastToday && !editingId && canRequest && {
            icon: SquarePen,
            label: 'Fix',
            title: 'Entry is older than 2 hours — submit a correction request for supervisor review',
            variant: 'warn',
            onClick: handleCorrectionRequest,
          },
        ]}
      />
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
    <div
      ref={rowRef}
      className={cn(
        'p-4 space-y-3 transition-all border-b last:border-b-0 border-border/60',
        pulsing ? 'ring-2 ring-accent ring-inset bg-accent-soft/20' : '',
      )}
    >
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
          <span className="text-sm font-semibold text-foreground break-words">{locator.name}</span>
          <MetaStrip
            primary={
              <StatusPill tone={freshness.tone}>
                <CalendarClock className="h-3 w-3" />
                {freshness.label}
              </StatusPill>
            }
            alerts={[
              todayCount === 0 && !editingId && {
                tone: 'warn',
                icon: MessageCircleOff,
                label: gapReason ? reasonCategoryLabel(gapReason.reason_category) : 'Log gap reason',
                onClick: () => setGapDialogOpen(true),
                testId: `locator-gap-reason-btn-${locator.id}`,
              },
              editingId && {
                tone: 'primary',
                label: 'Editing',
              },
              locator.is_locked && {
                tone: 'danger',
                icon: ShieldAlert,
                label: 'meter locked',
              },
              lastToday?.is_estimated && {
                tone: 'warn',
                label: 'Estimated',
                title: 'Auto-backfilled reading — no manual operator entry on file.',
              },
              lastToday?.off_location_flag && {
                tone: 'warn',
                icon: MapPin,
                label: 'off-site',
              },
            ].filter(Boolean)}
            overflow={[
              {
                icon: ArrowUpRight,
                label: 'Plant detail',
                onClick: () => navigate(`/plants/${plantId}?tab=locators&highlight=${locator.id}`),
              },
            ].filter(Boolean)}
            maxVisible={4}
          />
        </div>

        <label className="shrink-0 cursor-pointer relative">
          <span
            className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground bg-muted border border-border/70 rounded-full px-3 py-1 font-mono-num whitespace-nowrap hover:bg-muted/80 hover:text-foreground transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-ring peer-focus-visible:outline-offset-2"
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
            {customDt ? new Date(customDt).toLocaleString([], { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—'}
            <CalendarClock className="h-3 w-3 shrink-0 opacity-70" />
          </span>
          <Input ref={dtInputRef} type="datetime-local" value={customDt} onChange={e => setCustomDt(e.target.value)}
            className="peer absolute inset-0 opacity-0 w-full h-full pointer-events-none" title="Reading date & time" />
        </label>
      </div>

      <div className="recessed-glass p-2.5 sm:p-3 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <div
            className="flex items-center rounded-full border border-kpi-locator/40 overflow-hidden text-2xs font-semibold shrink-0 px-2.5 py-0.5 bg-kpi-locator/20 text-kpi-locator"
            title={locInputMode === 'raw'
              ? 'Cumulative meter reading — Δ auto-computed. Set in Plant config > Locators.'
              : 'Daily m³ entered directly. Set in Plant config > Locators.'}
          >
            {locInputMode === 'raw' ? 'Raw Meter' : 'Direct m³'}
          </div>
          <div className="text-xs text-muted-foreground">
            {locInputMode === 'raw' ? (
              <>
                prev: <span className="font-mono-num font-semibold text-foreground">{previous == null ? '—' : fmtNum(previous)}</span>
                {!isMobile && dailyVol != null && <> · Δ <span className={cn('font-mono-num font-semibold', dailyVol < 0 ? 'text-destructive' : 'text-primary')}>{fmtNum(dailyVol)} m³</span></>}
              </>
            ) : (
              <>
                {dailyVol != null ? <><span className={cn('font-mono-num font-semibold', dailyVol < 0 ? 'text-destructive' : 'text-primary')}>{fmtNum(dailyVol)} m³</span> to save</> : <span className="text-muted-foreground/70">enter daily volume</span>}
              </>
            )}
          </div>
        </div>

        <div className="text-xs font-mono-num">
          <span className={cn('px-2 py-0.5 rounded-full font-medium', atLimit ? 'bg-warn-soft text-warn font-semibold' : 'bg-muted/60 text-muted-foreground')}>
            {todayCount}/{maxReadingsPerDay} today
          </span>
        </div>
      </div>

      {isMobile && locInputMode === 'raw' ? (
        <div className="space-y-2.5">
          <OdometerRollerInput
            value={reading}
            onChange={(v) => { setReading(v); setDraftReading({ value: v }); }}
            alertState={odometerAlert}
            disabled={saving || atLimit}
            testId={`loc-odometer-${locator.id}`}
          />

          <div className="flex items-center justify-between text-xs px-1 min-h-[18px]">
            <span className="text-muted-foreground font-medium">
              Current:{' '}
              <span className={`font-mono-num font-semibold ${reading ? 'text-foreground' : 'text-muted-foreground/50'}`}>
                {reading ? (+reading).toFixed(2) : '—'}
              </span>
            </span>
            {dailyVol != null && (
              <span className={cn('font-mono-num font-semibold', dailyVol < 0 ? 'text-destructive' : 'text-primary')}>
                Δ {fmtNum(dailyVol)} m³
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {atLimit ? (
              <Button
                onClick={() => lastToday && startEdit(lastToday)}
                variant="outline"
                className="flex-1 h-11 rounded-full text-sm font-semibold border-primary/40 text-primary hover:bg-primary/10 transition-all"
                data-testid={`loc-edit-${locator.id}`}
              >
                <Pencil className="h-4 w-4 mr-1.5" /> Edit reading
              </Button>
            ) : (
              <Button
                onClick={save} disabled={saving || !readingChanged || (showAnomalyBanner && anomalyRemarkRequired) || (editingId && !isReasonComplete(editReason, editCustomReason))}
                style={{ '--confirm-glow': 'hsl(var(--kpi-locator, 175 84% 32%) / 0.5)' } as React.CSSProperties}
                className={cn(
                  'flex-1 h-11 rounded-full text-sm font-semibold shadow-sm transition-all',
                  readingChanged
                    ? 'bg-kpi-locator hover:bg-kpi-locator/90 active:scale-[0.98] text-white'
                    : 'bg-muted text-muted-foreground/60 border border-border/40 hover:bg-muted cursor-not-allowed',
                  justSaved && 'animate-gauge-confirm',
                )}
                data-testid={`loc-save-${locator.id}`}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId ? 'Update reading' : 'Save reading'}
              </Button>
            )}
            {editingId && (
              <Button
                onClick={cancelEdit}
                variant="ghost"
                size="sm"
                className="h-11 px-3 rounded-full text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </Button>
            )}
            {ActionButtons}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Droplet className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-kpi-locator pointer-events-none" />
            <Input
              type="number" step="any" inputMode="decimal"
              value={reading} onChange={(e) => { setReading(e.target.value); setDraftReading({ value: e.target.value }); setShowAnomalyBanner(false); }}
              placeholder={locInputMode === 'direct' ? 'Daily volume (m³)' : 'Meter reading'}
              className="pl-9 h-11 rounded-xl bg-kpi-locator/5 border-kpi-locator/30 focus-visible:ring-kpi-locator/30 font-mono-num font-medium"
            />
          </div>
          {atLimit ? (
            <Button
              onClick={() => lastToday && startEdit(lastToday)}
              variant="outline"
              className="h-11 px-5 rounded-full text-sm font-semibold shrink-0 border-primary/40 text-primary hover:bg-primary/10 transition-all"
              data-testid={`loc-edit-${locator.id}`}
            >
              <Pencil className="h-4 w-4 mr-1.5" /> Edit reading
            </Button>
          ) : (
            <Button
              onClick={save} disabled={saving || !readingChanged || (showAnomalyBanner && anomalyRemarkRequired) || (editingId && !isReasonComplete(editReason, editCustomReason))}
              style={{ '--confirm-glow': 'hsl(var(--kpi-locator, 175 84% 32%) / 0.5)' } as React.CSSProperties}
              className={cn(
                'h-11 px-6 rounded-full text-sm font-semibold shrink-0 shadow-sm transition-all',
                readingChanged
                  ? 'bg-kpi-locator hover:bg-kpi-locator/90 active:scale-[0.98] text-white'
                  : 'bg-muted text-muted-foreground/60 border border-border/40 hover:bg-muted cursor-not-allowed',
                justSaved && 'animate-gauge-confirm',
              )}
              data-testid={`loc-save-${locator.id}`}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId ? 'Update reading' : 'Save reading'}
            </Button>
          )}
          {editingId && (
            <Button
              onClick={cancelEdit}
              variant="ghost"
              size="sm"
              className="h-11 px-3 rounded-full text-xs text-muted-foreground hover:text-foreground shrink-0"
            >
              Cancel
            </Button>
          )}
          {ActionButtons}
        </div>
      )}

      {editingId && (
        <div>
          <CorrectionReasonField
            reason={editReason} onReasonChange={setEditReason}
            customReason={editCustomReason} onCustomReasonChange={setEditCustomReason}
            label="Reason for this edit"
          />
        </div>
      )}

      {locInputMode === 'raw' && (
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
      )}

      {showHistory && (
        <ReadingHistoryDialog
          entityName={locator.name}
          module="locator"
          entityId={locator.id}
          plantId={plantId}
          assetMeterSerial={locator.meter_serial}
          defaultInputMode={locator.default_input_mode === 'direct' ? 'direct' : 'raw'}
          onClose={() => setShowHistory(false)}
        />
      )}

      {showReplaceMeter && (
        <ReplaceMeterDialog
          kind="locator"
          assetId={locator.id}
          plantId={plantId}
          oldSerial={locator.meter_serial}
          onSuccess={(info) => {
            setMeterReplacePending(info ?? { newInitialReading: null, replacementId: null });
            if (info?.newInitialReading != null && (reading === '' || reading === previous?.toFixed(2))) {
              setReading(String(info.newInitialReading));
            }
          }}
          onClose={() => setShowReplaceMeter(false)}
        />
      )}
      {cooldownMinutes > 0 && cooldownAvailableAt && (
        <div className="flex items-center gap-1.5 rounded-md bg-destructive/10 border border-destructive/30 px-2.5 py-1.5 text-xs text-destructive">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          Cooldown active — next reading available at{' '}
          {cooldownAvailableAt.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}{' '}
          ({cooldownMinutes} min remaining).
        </div>
      )}

      {lastSavePending && !cooldownMinutes && (
        <div className="flex items-center gap-1.5 rounded-md bg-warn-soft border border-warn/40 px-2.5 py-1.5 text-xs text-warn">
          <AlertCircle className="h-3 w-3 shrink-0" />
          Last reading sent for supervisor review — excluded from totals until approved.
        </div>
      )}

      {reading && belowPrev && !lastSavePending && (
        <div className="flex flex-col gap-1 text-xs bg-warn-soft border border-warn/30 px-3 py-2 rounded-lg">
          <span className="flex items-center gap-1.5 font-semibold text-warn">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            Below previous — will go to supervisor review after save.
          </span>
          <span className="text-warn pl-5">
            If the meter was replaced, check "Meter replaced" above instead.
          </span>
        </div>
      )}

      {reading && !belowPrev && highVol && !lastSavePending && (showAnomalyBanner || anomalyRemark.trim().length > 0) && (
        <AnomalyRemarkBanner
          result={deviationLoc}
          label={locator.name}
          unit="m3/hr"
          windowDays={10}
          remark={anomalyRemark}
          onRemarkChange={setAnomalyRemark}
        />
      )}

      <ReasonDialog
        open={gapDialogOpen}
        onOpenChange={setGapDialogOpen}
        title={`No reading today for "${locator.name}" — why?`}
        description="This explains the gap in Data Summary for today. If a reading comes in later today, it takes priority over this note."
        confirmLabel="Log reason"
        busy={gapSaving}
        onConfirm={async (category, detail) => {
          setGapSaving(true);
          const todayDateStr = format(new Date(), 'yyyy-MM-dd');
          const { error } = await supabase.from('reading_gap_reasons' as any).upsert(
            [{
              entity_type: 'locator', entity_id: locator.id, plant_id: plantId,
              gap_date: todayDateStr, reason_category: category, reason_detail: detail || null,
              logged_by: userId ?? null,
            }] as any,
            { onConflict: 'entity_type,entity_id,gap_date' },
          );
          setGapSaving(false);
          if (error) { toast.error(friendlyError(error)); return; }
          toast.success(`${locator.name}: reason logged`);
          setGapDialogOpen(false);
          onGapReasonSaved?.();
        }}
      />
    </div>
  );
}

export { LocatorRow };
