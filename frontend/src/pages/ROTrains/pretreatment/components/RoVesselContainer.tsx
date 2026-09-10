import { RoVesselSection } from './RoVesselSection';
import { usePretreatmentFormState } from '../hooks/usePretreatmentFormState';
import { usePretreatmentData } from '../hooks/usePretreatmentData';
import { usePretreatmentCalculations } from '../hooks/usePretreatmentCalculations';

export interface RoVesselContainerProps {
  train: any;
  meterCfg: any;
  siblingTrains: any[];
  form: ReturnType<typeof usePretreatmentFormState>;
  data: ReturnType<typeof usePretreatmentData>;
  calc: ReturnType<typeof usePretreatmentCalculations>;
  showFeedMeter: boolean;
  showPermeateMeter: boolean;
  showRejectMeter: boolean;
  showPowerMeter: boolean;
  isSharedPowerMeter: boolean;
  sharedPowerGroup: string | null;
  productionLabel: string;
  onFieldChange: (k: string) => { value: string; onChange: (e: any) => void };
}

export function RoVesselContainer({
  train,
  meterCfg,
  siblingTrains,
  form,
  data,
  calc,
  showFeedMeter,
  showPermeateMeter,
  showRejectMeter,
  showPowerMeter,
  isSharedPowerMeter,
  sharedPowerGroup,
  productionLabel,
  onFieldChange,
}: RoVesselContainerProps) {
  const emEntered = [form.roValues.feed_flow, form.roValues.permeate_flow, form.roValues.reject_flow].filter(Boolean).length;

  return (
    <RoVesselSection
      train={train}
      showFeedMeter={showFeedMeter}
      showPermeateMeter={showPermeateMeter}
      showRejectMeter={showRejectMeter}
      showPowerMeter={showPowerMeter}
      isSharedPowerMeter={isSharedPowerMeter}
      sharedPowerGroup={sharedPowerGroup}
      siblingTrains={siblingTrains}
      roValues={form.roValues}
      onFieldChange={onFieldChange}
      autoDurationMin={data.autoDurationMin}
      prevFeedMeter={data.prevFeedMeter}
      prevPermMeter={data.prevPermMeter}
      prevRejMeter={data.prevRejMeter}
      feedNegWarn={calc.feedNegWarn}
      permNegWarn={calc.permNegWarn}
      rejNegWarn={calc.rejNegWarn}
      feedSpike={calc.feedSpike}
      permSpike={calc.permSpike}
      rejSpike={calc.rejSpike}
      feedNeedsRemark={calc.feedNeedsRemark}
      permNeedsRemark={calc.permNeedsRemark}
      rejNeedsRemark={calc.rejNeedsRemark}
      anomalyRemarkFeed={form.anomalyRemarkFeed}
      setAnomalyRemarkFeed={form.setAnomalyRemarkFeed}
      anomalyRemarkPerm={form.anomalyRemarkPerm}
      setAnomalyRemarkPerm={form.setAnomalyRemarkPerm}
      anomalyRemarkRej={form.anomalyRemarkRej}
      setAnomalyRemarkRej={form.setAnomalyRemarkRej}
      feedInferred={calc.feedInferred}
      permInferred={calc.permInferred}
      rejInferred={calc.rejInferred}
      effFeedFlow={calc.effFeedFlow}
      effPermFlow={calc.effPermFlow}
      effRejFlow={calc.effRejFlow}
      permVol={calc.permVol}
      rejVol={calc.rejVol}
      feedVol={calc.feedVol}
      feedFlowMeter={calc.feedFlowMeter}
      permFlowMeter={calc.permFlowMeter}
      rejFlowMeter={calc.rejFlowMeter}
      recovery={calc.recovery}
      recWarn={calc.recWarn}
      dp={calc.dp}
      dpAlert={calc.dpAlert}
      pwrDelta={calc.pwrDelta}
      pwrKw={calc.pwrKw}
      secEnergy={calc.secEnergy}
      prevPowerMeter={data.prevPowerMeter}
      productionLabel={productionLabel}
      remarks={form.remarks}
      setRemarks={form.setRemarks}
      meterCfg={meterCfg}
      emEntered={emEntered}
      emFeedInferred={calc.emFeedInferred}
      emPermInferred={calc.emPermInferred}
      emRejInferred={calc.emRejInferred}
      phWarn={calc.phWarn}
      rejection={calc.rejection}
      saltPassage={calc.saltPassage}
    />
  );
}
