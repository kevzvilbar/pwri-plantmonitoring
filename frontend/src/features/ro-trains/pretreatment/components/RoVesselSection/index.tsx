import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { RawWaterIcon, PermeateIcon, RejectIcon } from '@/components/icons/water-icons';
import { evaluateROMeterSpike } from '@/lib/roReadingGuards';
import { cn } from '@/lib/utils';
import { WaterMeterSection } from './WaterMeterSection';
import { PressureRow } from './PressureRow';
import { EMFlowRow } from './EMFlowRow';
import { TDSRow } from './TDSRow';
import { PHRow } from './PHRow';
import { ProductQualityRow } from './ProductQualityRow';
import { PowerMeterSection } from './PowerMeterSection';
import { RemarksSection } from './RemarksSection';
import { RO_FIELD_LABELS } from '../../types';

export interface RoVesselSectionProps {
  train: any;
  showFeedMeter: boolean;
  showPermeateMeter: boolean;
  showRejectMeter: boolean;
  showPowerMeter: boolean;
  isSharedPowerMeter: boolean;
  sharedPowerGroup: string | null;
  siblingTrains: any[];
  roValues: Record<string, string>;
  onFieldChange: (key: string) => { value: string; onChange: (e: any) => void };
  autoDurationMin: number | null;
  prevFeedMeter: number | null;
  prevPermMeter: number | null;
  prevRejMeter: number | null;
  feedNegWarn: boolean;
  permNegWarn: boolean;
  rejNegWarn: boolean;
  feedSpike: ReturnType<typeof evaluateROMeterSpike> | null;
  permSpike: ReturnType<typeof evaluateROMeterSpike> | null;
  rejSpike: ReturnType<typeof evaluateROMeterSpike> | null;
  feedNeedsRemark: boolean;
  permNeedsRemark: boolean;
  rejNeedsRemark: boolean;
  anomalyRemarkFeed: string;
  setAnomalyRemarkFeed: (v: string) => void;
  anomalyRemarkPerm: string;
  setAnomalyRemarkPerm: (v: string) => void;
  anomalyRemarkRej: string;
  setAnomalyRemarkRej: (v: string) => void;
  feedInferred: boolean;
  permInferred: boolean;
  rejInferred: boolean;
  effFeedFlow: number | null;
  effPermFlow: number | null;
  effRejFlow: number | null;
  permVol: number | null;
  rejVol: number | null;
  feedVol: number | null;
  feedFlowMeter: number | null;
  permFlowMeter: number | null;
  rejFlowMeter: number | null;
  recovery: number | null;
  recWarn: boolean;
  dp: number | null;
  dpAlert: boolean;
  pwrDelta: number | null;
  pwrKw: number | null;
  secEnergy: number | null;
  prevPowerMeter: number | null;
  productionLabel: string;
  remarks: string;
  setRemarks: (v: string) => void;
  meterCfg: {
    ro_production_source?: string;
    permeate_is_production?: boolean;
  };
  emEntered: number;
  emFeedInferred: boolean;
  emPermInferred: boolean;
  emRejInferred: boolean;
  phWarn: boolean;
  rejection: number | null;
  saltPassage: number | null;
  feedIsEM: boolean;
  permIsEM: boolean;
  rejIsEM: boolean;
  roReasonNeeded: boolean;
  setRoReasonNeeded: (v: boolean) => void;
  roEntryReasons: Record<string, { reason: string; custom: string }>;
  setRoEntryReasons: (v: Record<string, { reason: string; custom: string }> | ((prev: Record<string, { reason: string; custom: string }>) => Record<string, { reason: string; custom: string }>)) => void;
}

export function RoVesselSection({
  train,
  showFeedMeter,
  showPermeateMeter,
  showRejectMeter,
  showPowerMeter,
  isSharedPowerMeter,
  sharedPowerGroup,
  siblingTrains,
  roValues,
  onFieldChange,
  autoDurationMin,
  prevFeedMeter,
  prevPermMeter,
  prevRejMeter,
  feedNegWarn,
  permNegWarn,
  rejNegWarn,
  feedSpike,
  permSpike,
  rejSpike,
  feedNeedsRemark,
  permNeedsRemark,
  rejNeedsRemark,
  anomalyRemarkFeed,
  setAnomalyRemarkFeed,
  anomalyRemarkPerm,
  setAnomalyRemarkPerm,
  anomalyRemarkRej,
  setAnomalyRemarkRej,
  feedInferred,
  permInferred,
  rejInferred,
  effFeedFlow,
  effPermFlow,
  effRejFlow,
  permVol,
  rejVol,
  feedVol,
  feedFlowMeter,
  permFlowMeter,
  rejFlowMeter,
  recovery,
  recWarn,
  dp,
  dpAlert,
  pwrDelta,
  pwrKw,
  secEnergy,
  prevPowerMeter,
  productionLabel,
  remarks,
  setRemarks,
  meterCfg,
  emEntered,
  emFeedInferred,
  emPermInferred,
  emRejInferred,
  phWarn,
  rejection,
  saltPassage,
  feedIsEM,
  permIsEM,
  rejIsEM,
  roReasonNeeded,
  setRoReasonNeeded,
  roEntryReasons,
  setRoEntryReasons,
}: RoVesselSectionProps) {
  const f = (k: string) => onFieldChange(k);
  const activeMeters = [showFeedMeter, showPermeateMeter, showRejectMeter].filter(Boolean).length;
  const meterGridClass = activeMeters === 3 ? 'grid-cols-3' : activeMeters === 2 ? 'grid-cols-2' : 'grid-cols-1';

  const updateRoReason = (key: string, reason: string) => {
    setRoEntryReasons((prev) => ({
      ...prev,
      [key]: { reason, custom: reason === 'Other' ? (prev[key]?.custom || '') : '' },
    }));
  };

  const updateRoCustomReason = (key: string, custom: string) => {
    setRoEntryReasons((prev) => ({
      ...prev,
      [key]: { reason: prev[key]?.reason || 'Other', custom },
    }));
  };

  const onApplyAllRoReasons = (sourceKey: string) => {
    const cur = roEntryReasons[sourceKey];
    if (!cur?.reason) {
      toast.error(`Select a reason for ${RO_FIELD_LABELS[sourceKey] || sourceKey} first before applying to all.`);
      return;
    }
    const next = { ...roEntryReasons };
    const incompleteKeys: string[] = [];
    if (showFeedMeter && !roValues.feed_meter_curr) incompleteKeys.push('feed_meter');
    if (showPermeateMeter && !roValues.permeate_meter_curr) incompleteKeys.push('permeate_meter');
    if (showRejectMeter && !roValues.reject_meter_curr) incompleteKeys.push('reject_meter');
    if (!roValues.suction_pressure_psi) incompleteKeys.push('suction_pressure_psi');
    if (!roValues.feed_pressure_psi) incompleteKeys.push('feed_pressure_psi');
    if (!roValues.reject_pressure_psi) incompleteKeys.push('reject_pressure_psi');
    if (showFeedMeter && feedIsEM && !emFeedInferred && !roValues.feed_flow) incompleteKeys.push('feed_flow');
    if (showPermeateMeter && permIsEM && !emPermInferred && !roValues.permeate_flow) incompleteKeys.push('permeate_flow');
    if (showRejectMeter && rejIsEM && !emRejInferred && !roValues.reject_flow) incompleteKeys.push('reject_flow');
    if (!roValues.feed_tds) incompleteKeys.push('feed_tds');
    if (!roValues.permeate_tds) incompleteKeys.push('permeate_tds');
    if (!roValues.reject_tds) incompleteKeys.push('reject_tds');
    if (!roValues.feed_ph) incompleteKeys.push('feed_ph');
    if (!roValues.permeate_ph) incompleteKeys.push('permeate_ph');
    if (!roValues.reject_ph) incompleteKeys.push('reject_ph');
    if (!roValues.turbidity_ntu) incompleteKeys.push('turbidity_ntu');
    if (!roValues.temperature_c) incompleteKeys.push('temperature_c');

    incompleteKeys.forEach((k) => {
      next[k] = { ...cur };
    });
    setRoEntryReasons(next);
    toast.success('Applied reason to all incomplete RO entries.');
  };

  return (
    <>
      <Card className="p-3 space-y-3">
        <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">RO Vessel</h4>

        <div className={cn('grid gap-2', meterGridClass)}>
          {showFeedMeter && (
            <div className="flex items-center gap-1.5 rounded-md bg-info-soft border border-info px-2 py-1.5">
              <RawWaterIcon className="h-3.5 w-3.5 text-info shrink-0" aria-hidden />
              <span className="text-xs font-semibold text-info">Feed / Raw</span>
            </div>
          )}
          {showPermeateMeter && (
            <div className="flex items-center gap-1.5 rounded-md bg-accent-soft border border-accent px-2 py-1.5">
              <PermeateIcon className="h-3.5 w-3.5 text-accent shrink-0" aria-hidden />
              <span className="text-xs font-semibold text-accent">{productionLabel}</span>
            </div>
          )}
          {showRejectMeter && (
            <div className="flex items-center gap-1.5 rounded-md bg-muted border border-border px-2 py-1.5">
              <RejectIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden />
              <span className="text-xs font-semibold text-muted-foreground">Reject / Concentrate</span>
            </div>
          )}
        </div>

        <WaterMeterSection
          showFeedMeter={showFeedMeter}
          showPermeateMeter={showPermeateMeter}
          showRejectMeter={showRejectMeter}
          f={f}
          autoDurationMin={autoDurationMin}
          prevFeedMeter={prevFeedMeter}
          feedMeterCurr={roValues.feed_meter_curr}
          feedNegWarn={feedNegWarn}
          feedSpike={feedSpike}
          feedNeedsRemark={feedNeedsRemark}
          anomalyRemarkFeed={anomalyRemarkFeed}
          setAnomalyRemarkFeed={setAnomalyRemarkFeed}
          feedInferred={feedInferred}
          feedVol={feedVol}
          feedFlowMeter={feedFlowMeter}
          prevPermMeter={prevPermMeter}
          permMeterCurr={roValues.permeate_meter_curr}
          permNegWarn={permNegWarn}
          permSpike={permSpike}
          permNeedsRemark={permNeedsRemark}
          anomalyRemarkPerm={anomalyRemarkPerm}
          setAnomalyRemarkPerm={setAnomalyRemarkPerm}
          permInferred={permInferred}
          permVol={permVol}
          permFlowMeter={permFlowMeter}
          meterCfg={meterCfg}
          prevRejMeter={prevRejMeter}
          rejMeterCurr={roValues.reject_meter_curr}
          rejNegWarn={rejNegWarn}
          rejSpike={rejSpike}
          rejNeedsRemark={rejNeedsRemark}
          anomalyRemarkRej={anomalyRemarkRej}
          setAnomalyRemarkRej={setAnomalyRemarkRej}
          rejInferred={rejInferred}
          rejVol={rejVol}
          rejFlowMeter={rejFlowMeter}
          roReasonNeeded={roReasonNeeded}
          roEntryReasons={roEntryReasons}
          onReasonChange={updateRoReason}
          onCustomReasonChange={updateRoCustomReason}
          onApplyAll={onApplyAllRoReasons}
        />

        <PressureRow
          f={f}
          dp={dp}
          dpAlert={dpAlert}
          roReasonNeeded={roReasonNeeded}
          roEntryReasons={roEntryReasons}
          onReasonChange={updateRoReason}
          onCustomReasonChange={updateRoCustomReason}
          onApplyAll={onApplyAllRoReasons}
        />
        <EMFlowRow
          showFeedMeter={showFeedMeter}
          showPermeateMeter={showPermeateMeter}
          showRejectMeter={showRejectMeter}
          f={f}
          emEntered={emEntered}
          emFeedInferred={emFeedInferred}
          emPermInferred={emPermInferred}
          emRejInferred={emRejInferred}
          effFeedFlow={effFeedFlow}
          effPermFlow={effPermFlow}
          effRejFlow={effRejFlow}
          feedFlowMeter={feedFlowMeter}
          permFlowMeter={permFlowMeter}
          rejFlowMeter={rejFlowMeter}
          recovery={recovery}
          recWarn={recWarn}
          meterCfg={meterCfg}
          feedIsEM={feedIsEM}
          permIsEM={permIsEM}
          rejIsEM={rejIsEM}
          roReasonNeeded={roReasonNeeded}
          roEntryReasons={roEntryReasons}
          onReasonChange={updateRoReason}
          onCustomReasonChange={updateRoCustomReason}
          onApplyAll={onApplyAllRoReasons}
        />
        <TDSRow
          f={f}
          rejection={rejection}
          saltPassage={saltPassage}
          roReasonNeeded={roReasonNeeded}
          roEntryReasons={roEntryReasons}
          onReasonChange={updateRoReason}
          onCustomReasonChange={updateRoCustomReason}
          onApplyAll={onApplyAllRoReasons}
        />
        <PHRow
          f={f}
          phWarn={phWarn}
          roReasonNeeded={roReasonNeeded}
          roEntryReasons={roEntryReasons}
          onReasonChange={updateRoReason}
          onCustomReasonChange={updateRoCustomReason}
          onApplyAll={onApplyAllRoReasons}
        />
        <ProductQualityRow
          f={f}
          roReasonNeeded={roReasonNeeded}
          roEntryReasons={roEntryReasons}
          onReasonChange={updateRoReason}
          onCustomReasonChange={updateRoCustomReason}
          onApplyAll={onApplyAllRoReasons}
        />
      </Card>

      {showPowerMeter && (
        <PowerMeterSection
          autoDurationMin={autoDurationMin}
          isSharedPowerMeter={isSharedPowerMeter}
          sharedPowerGroup={sharedPowerGroup}
          siblingTrains={siblingTrains}
          f={f}
          prevPowerMeter={prevPowerMeter}
          pwrDelta={pwrDelta}
          pwrKw={pwrKw}
          secEnergy={secEnergy}
        />
      )}
      {!showPowerMeter && (
        <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          ⚡ Per-train power meter not configured for this plant — energy consumption is tracked plant-wide in the <strong className="font-medium">Power tab</strong>.
        </div>
      )}

      <RemarksSection remarks={remarks} setRemarks={setRemarks} />
    </>
  );
}
