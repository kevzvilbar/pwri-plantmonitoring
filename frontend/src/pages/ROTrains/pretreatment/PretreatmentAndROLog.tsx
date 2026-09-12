import { useState, useMemo, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { ExportButton } from '@/components/ExportButton';
import { Upload, Loader2 } from 'lucide-react';
import { ImportROReadingsDialog } from '../../ro-trains';

import { DowntimeResolutionCard, OfflineDetailsPanel, OfflineLockedCard } from './components/OfflineTrainBanner';
import { PlantTrainSelector } from './components/PlantTrainSelector';
import { OnlineStatusToggle } from './components/OnlineStatusToggle';
import { PretreatmentStagesContainer } from './components/PretreatmentStagesContainer';
import { RoVesselContainer } from './components/RoVesselContainer';
import { usePretreatmentFormState } from './hooks/usePretreatmentFormState';
import { usePretreatmentData } from './hooks/usePretreatmentData';
import { usePretreatmentCalculations } from './hooks/usePretreatmentCalculations';
import { usePretreatmentActions } from './hooks/usePretreatmentActions';
import { invalidateAllRoQueries } from './hooks/useRoQueryInvalidation';
import { isWasActuallyRunningReason, WAS_ACTUALLY_RUNNING_REASON } from '@/lib/trainUptimeExemption';

export function PretreatmentAndROLog() {
  const qc = useQueryClient();
  const { activeOperator, isManager } = useAuth();
  const [showImport, setShowImport] = useState(false);
  const { selectedPlantId, setSelectedPlantId, addAlerts } = useAppStore();
  const { data: plants } = usePlants();

  // Persist plant + train selection across tab switches / browser-focus changes
  const [plantId, setPlantIdState] = useState<string>(() => {
    try { return selectedPlantId || sessionStorage.getItem('pretreat:plantId') || ''; } catch { return ''; }
  });
  const setPlantId = (v: string) => {
    try { sessionStorage.setItem('pretreat:plantId', v); } catch { /* ignore */ }
    setPlantIdState(v);
  };
  const [trainId, setTrainIdState] = useState<string>(() => {
    try { return sessionStorage.getItem('pretreat:trainId') ?? ''; } catch { return ''; }
  });
  const setTrainId = (v: string) => {
    try { sessionStorage.setItem('pretreat:trainId', v); } catch { /* ignore */ }
    setTrainIdState(v);
  };

  const [dt, setDt] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));

  // ── Sync with global plant selector (TopBar) ───────────────────────────────
  const lastSyncedPlantRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedPlantId || selectedPlantId === lastSyncedPlantRef.current) return;
    lastSyncedPlantRef.current = selectedPlantId;
    setPlantId(selectedPlantId);
    setTrainId('');
  }, [selectedPlantId]);

  // ── Deep-link from an alert/notification ──────────────────────────────────
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const deepPlant = searchParams.get('plant');
    const deepTrain = searchParams.get('train');
    if (!deepPlant && !deepTrain) return;
    if (deepPlant) setPlantId(deepPlant);
    if (deepTrain) setTrainId(deepTrain);
    const sp = new URLSearchParams(searchParams);
    sp.delete('plant'); sp.delete('train');
    setSearchParams(sp, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // ── Form state & data hooks ───────────────────────────────────────────────
  const form = usePretreatmentFormState(trainId, null);
  const plant = useMemo(() => plants?.find((p) => p.id === plantId), [plants, plantId]);
  const isSynchronized = (plant as any)?.backwash_mode === 'synchronized';

  const data = usePretreatmentData(plantId, trainId, form.roValues, isSynchronized);
  const { train, meterCfg, siblingTrains, latestStatusLog } = data;

  const showFeedMeter = !((train as any)?.unit_type === 'secondary') && (meterCfg.ro_has_feed_meter ?? true);
  const showPermeateMeter = meterCfg.ro_has_permeate_meter ?? true;
  const showRejectMeter = meterCfg.ro_has_reject_meter ?? true;
  const showPowerMeter = meterCfg.ro_has_per_train_electricity ?? true;
  const productionLabel = meterCfg.ro_production_source === 'permeate' ? 'Permeate / Production' : 'Permeate / Product';

  const plantFilterHousingType: 'Cartridge Filter' | 'Bag Filter' =
    (plant as any)?.filter_housing_type ?? 'Cartridge Filter';
  const cartridgeHousingLabel =
    plantFilterHousingType === 'Bag Filter' ? 'Filter Housing (Pre-filter)' : 'Cartridge Housing (Pre-filter)';
  const changedElementLabel =
    plantFilterHousingType === 'Bag Filter' ? 'Bag Filters Changed Today' : 'Cartridges Changed Today';

  const boosterConfig = useMemo(() => {
    const raw = train?.booster_pump_targets as any;
    if (!raw || typeof raw !== 'object') return null;
    return {
      psiMode: raw.psi_mode === true,
      targets: (raw.targets && typeof raw.targets === 'object') ? raw.targets : {},
    };
  }, [train?.booster_pump_targets]);

  const sharedPowerGroup: string | null = (train as any)?.shared_power_meter_group ?? null;
  const isSharedPowerMeter = !!sharedPowerGroup;

  // Auto-fill from configured setpoint
  useEffect(() => {
    form.setHppTarget(train?.hpp_target_pressure_psi != null ? String(train.hpp_target_pressure_psi) : '');
  }, [train?.id, train?.hpp_target_pressure_psi]);

  // Auto-set offline when train is offline in DB or has no readings in past 2 hours.
  // Wait for isStatusLoading to settle before locking in a default — prevReadings/
  // prevPretreatReadings resolve independently of the trains query, so applying this
  // the instant `train` loads can lock in a default computed from a stale/missing
  // lastReadingTime (and never re-check, since it only runs once per train).
  const autoInitializedTrainId = useRef<string | null>(null);
  useEffect(() => {
    if (!train) return;
    if (data.isStatusLoading) return;
    if (autoInitializedTrainId.current !== train.id) {
      autoInitializedTrainId.current = train.id;
      if (data.isEffectivelyOffline) {
        form.setTrainOnline(false);
        if (data.lastReadingTime) {
          form.setOfflineStart(format(new Date(data.lastReadingTime), "yyyy-MM-dd'T'HH:mm"));
        } else {
          form.setOfflineStart(dt);
        }
        form.setOfflineEnd('');
        form.setOfflineReason(
          latestStatusLog?.reason && !latestStatusLog.reason.startsWith('Auto-flagged')
            ? latestStatusLog.reason
            : ''
        );
      } else {
        form.setTrainOnline(true);
        form.setOfflineStart('');
        form.setOfflineEnd('');
        form.setOfflineReason('');
        form.setOfflineReasonOther('');
        form.setExemptionSubreason('');
        form.setExemptionDetail('');
      }
    }
  }, [train?.id, data.isStatusLoading, data.isEffectivelyOffline, data.lastReadingTime, latestStatusLog?.reason, dt]);

  // ── Calculations hook ─────────────────────────────────────────────────────
  const calc = usePretreatmentCalculations(
    form.roValues,
    data.prevFeedMeter,
    data.prevPermMeter,
    data.prevRejMeter,
    data.prevPowerMeter,
    data.autoDurationMin,
    data.avgFeedFlowRate,
    data.avgPermFlowRate,
    data.avgRejFlowRate,
    form.anomalyRemarkFeed,
    form.anomalyRemarkPerm,
    form.anomalyRemarkRej,
    showRejectMeter,
  );

  const wasOffline = Boolean(train && (train.status === 'Offline' || data.isEffectivelyOffline));
  // "Was actually running" exemption: the train never stopped, only the
  // encoding did — so Back Online At is not applicable and the downtime
  // resolution rules that require it must not apply.
  const isExemption = isWasActuallyRunningReason(form.offlineReason);
  const isDowntimeResolved = isExemption
    ? Boolean(form.offlineReason && form.offlineStart && form.exemptionSubreason)
    : wasOffline
    ? Boolean(
        form.offlineReason &&
        (form.offlineReason !== 'Other' || form.offlineReasonOther.trim()) &&
        form.offlineStart &&
        form.offlineEnd &&
        new Date(form.offlineEnd) <= new Date(dt) &&
        new Date(form.offlineStart) < new Date(form.offlineEnd)
      )
    : true;

  // Stay fully locked while the form is in the offline state — for BOTH real
  // downtime and the "was actually running" exemption. The operator's FIRST
  // save must be the offline/exemption record (which flips the train back to
  // Running); only after that save do the telemetry inputs unlock for a
  // normal online reading save.
  const isOfflineBlocked = !form.trainOnline || !isDowntimeResolved;
  const offlineReasonFinal = form.offlineReason === 'Other' ? form.offlineReasonOther : form.offlineReason;

  // Shortcut shared by the details panel + locked card: pre-select the
  // exemption for an auto-flagged train instead of logging downtime.
  const reportRunningInstead = () => {
    form.setTrainOnline(false);
    form.setOfflineReason(WAS_ACTUALLY_RUNNING_REASON);
    form.setOfflineEnd('');
  };

  const f = (k: string) => ({
    value: form.roValues[k] ?? '',
    onChange: (e: any) => form.setRoValues((prev) => ({ ...prev, [k]: e.target.value })),
  });

  // ── Save action hook ──────────────────────────────────────────────────────
  const {
    submit,
    isSaving: hookIsSaving,
  } = usePretreatmentActions({
    plantId,
    trainId,
    train,
    dt,
    isSynchronized,
    showFeedMeter,
    showPermeateMeter,
    showRejectMeter,
    sharedPowerGroup,
    qc,
    activeOperator,
    addAlerts,
    supabase,
    form,
    data,
    calc,
  });

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-2">
        <p className="text-sm text-muted-foreground">AFM/MMF, Boosters, Filter Housings & RO Vessel</p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 h-8 text-xs"
            onClick={() => setShowImport(true)}
          >
            <Upload className="h-3.5 w-3.5" /> Import RO CSV
          </Button>
          <ExportButton table="ro_pretreatment_readings" filters={plantId ? { plant_id: plantId } : undefined} />
        </div>
        {showImport && (
          <ImportROReadingsDialog
            plantId={plantId}
            userId={activeOperator?.id ?? null}
            meterConfig={{
              permeateIsProduction: meterCfg.permeate_is_production ?? false,
            }}
            onClose={() => setShowImport(false)}
            onImported={() => {
              setShowImport(false);
              invalidateAllRoQueries(qc);
            }}
          />
        )}
      </div>

      <Card className="p-4 space-y-4 border-border/80 shadow-xs">
        {/* Plant + Train Row */}
        <PlantTrainSelector
          plantId={plantId}
          trainId={trainId}
          plants={plants ?? []}
          trains={data.trains ?? []}
          dt={dt}
          isManager={isManager}
          onPlantChange={(v) => {
            lastSyncedPlantRef.current = v;
            setPlantId(v);
            setTrainId('');
            setSelectedPlantId(v);
          }}
          onTrainChange={setTrainId}
          onDtChange={setDt}
        />

        {/* Online / Offline Status Segmented Bar */}
        {train && data.isStatusLoading && (
          <div className="pt-2 border-t border-border/50">
            <div className="h-[60px] rounded-lg border border-border/60 bg-muted/20 animate-pulse" />
          </div>
        )}
        {train && !data.isStatusLoading && (
          <OnlineStatusToggle
            trainOnline={form.trainOnline}
            onSetOnline={() => {
              form.setTrainOnline(true);
              // Exemption already chosen while still offline: "Online" here
              // means "file the attestation and restore Running" — the train
              // never went down, so the downtime-resolve card stays hidden
              // (see its !isExemption guard below).
              if (wasOffline && !form.offlineStart && data.lastReadingTime) {
                form.setOfflineStart(format(new Date(data.lastReadingTime), "yyyy-MM-dd'T'HH:mm"));
              }
            }}
            onSetOffline={() => {
              form.setTrainOnline(false);
              if (data.lastReadingTime && !form.offlineStart) {
                form.setOfflineStart(format(new Date(data.lastReadingTime), "yyyy-MM-dd'T'HH:mm"));
              }
            }}
          />
        )}

        {/* Downtime Resolution Card: when train was offline but operator toggled to online.
            Hidden under the exemption — "Online" there means "file the
            attestation", not "the train came back", so no back-online
            confirmation is demanded. */}
        {train && wasOffline && form.trainOnline && !isExemption && (
          <DowntimeResolutionCard
            train={train}
            offlineReason={form.offlineReason}
            offlineReasonOther={form.offlineReasonOther}
            offlineStart={form.offlineStart}
            offlineEnd={form.offlineEnd}
            isDowntimeResolved={isDowntimeResolved}
            onOfflineReasonChange={form.setOfflineReason}
            onOfflineReasonOtherChange={form.setOfflineReasonOther}
            onOfflineStartChange={form.setOfflineStart}
            onOfflineEndChange={form.setOfflineEnd}
          />
        )}

        {/* Offline Details Panel — shown when train is marked offline */}
        {train && !form.trainOnline && (
          <OfflineDetailsPanel
            offlineReason={form.offlineReason}
            offlineReasonOther={form.offlineReasonOther}
            exemptionSubreason={form.exemptionSubreason}
            exemptionDetail={form.exemptionDetail}
            offlineStart={form.offlineStart}
            offlineEnd={form.offlineEnd}
            latestStatusLog={latestStatusLog}
            onOfflineReasonChange={form.setOfflineReason}
            onOfflineReasonOtherChange={form.setOfflineReasonOther}
            onExemptionSubreasonChange={form.setExemptionSubreason}
            onExemptionDetailChange={form.setExemptionDetail}
            onOfflineStartChange={form.setOfflineStart}
            onOfflineEndChange={form.setOfflineEnd}
            onReportRunningInstead={reportRunningInstead}
          />
        )}

        {plant && (
          <div className="flex items-center justify-between text-2xs text-muted-foreground pt-1 border-t border-border/30">
            <span>Plant Backwash Architecture:</span>
            <span className="font-semibold text-foreground px-2 py-0.5 rounded bg-muted/40 border border-border/40">
              {isSynchronized ? 'Synchronized (Whole Train at Once)' : 'Independent (Per Unit)'}
            </span>
          </div>
        )}
      </Card>

      {train && (
        <>
          {/* Offline gate: lock all parameter inputs when train is offline with no end time */}
          {isOfflineBlocked && (
            <OfflineLockedCard
              trainOnline={form.trainOnline}
              offlineReasonFinal={offlineReasonFinal}
              offlineStart={form.offlineStart}
              latestStatusLog={latestStatusLog}
              onReportRunningInstead={reportRunningInstead}
            />
          )}

          {!isOfflineBlocked && (
            <>
              <PretreatmentStagesContainer
                train={train}
                isSynchronized={isSynchronized}
                form={form}
                data={data}
                boosterConfig={boosterConfig}
                cartridgeHousingLabel={cartridgeHousingLabel}
                changedElementLabel={changedElementLabel}
              />
              {form.cartridgeSectionStarted && (
                <RoVesselContainer
                  train={train}
                  meterCfg={meterCfg}
                  siblingTrains={siblingTrains ?? []}
                  form={form}
                  data={data}
                  calc={calc}
                  showFeedMeter={showFeedMeter}
                  showPermeateMeter={showPermeateMeter}
                  showRejectMeter={showRejectMeter}
                  showPowerMeter={showPowerMeter}
                  isSharedPowerMeter={isSharedPowerMeter}
                  sharedPowerGroup={sharedPowerGroup}
                  productionLabel={productionLabel}
                  onFieldChange={f}
                />
              )}
            </>
          )}

          {train && (!form.trainOnline || (isDowntimeResolved && form.cartridgeSectionStarted)) && (
            <Button onClick={submit} disabled={hookIsSaving || (!isExemption && calc.anomalyRemarksMissing)} className="w-full h-12 text-base font-semibold gap-2">
              {hookIsSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              {hookIsSaving
                ? 'Saving…'
                : !form.trainOnline && isExemption
                ? 'Save & Mark Running (Was Not Offline)'
                : !form.trainOnline
                ? 'Save Offline Record'
                : wasOffline
                ? 'Save Reading & Mark Train Online'
                : 'Save Pre-Treatment & RO Reading'}
            </Button>
          )}
        </>
      )}

      {!train && plantId && (
        <Card className="p-4 text-center text-xs text-muted-foreground">Select a train to log pre-treatment and RO data</Card>
      )}
    </div>
  );
}
