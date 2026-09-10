import { useMemo } from 'react';
import { calc, ALERTS } from '@/lib/calculations';
import { evaluateROMeterSpike } from '@/lib/roReadingGuards';
import { isAnomalyRemarkValid } from '@/lib/anomalyRemarks';

export interface PretreatmentCalculations {
  dp: number | null;
  feedDelta: number | null;
  permDelta: number | null;
  rejDelta: number | null;
  feedFlowMeter: number | null;
  permFlowMeter: number | null;
  rejFlowMeter: number | null;
  feedInferred: boolean;
  permInferred: boolean;
  rejInferred: boolean;
  effFeedFlow: number | null;
  effPermFlow: number | null;
  effRejFlow: number | null;
  emFeedInferred: boolean;
  emPermInferred: boolean;
  emRejInferred: boolean;
  recovery: number | null;
  rejection: number | null;
  saltPassage: number | null;
  rejectFlow: number | null;
  phWarn: boolean;
  recWarn: boolean;
  dpAlert: boolean;
  pwrDelta: number | null;
  pwrKw: number | null;
  secEnergy: number | null;
  feedNegWarn: boolean;
  permNegWarn: boolean;
  rejNegWarn: boolean;
  feedSpike: ReturnType<typeof evaluateROMeterSpike>;
  permSpike: ReturnType<typeof evaluateROMeterSpike>;
  rejSpike: ReturnType<typeof evaluateROMeterSpike>;
  feedHighWarn: boolean;
  permHighWarn: boolean;
  rejHighWarn: boolean;
  feedNeedsRemark: boolean;
  permNeedsRemark: boolean;
  rejNeedsRemark: boolean;
  anyNeedsRemark: boolean;
  anomalyRemarksMissing: boolean;
  anyMeterSpike: boolean;
  feedVol: number | null;
  permVol: number | null;
  rejVol: number | null;
  mDurHr: number | null;
}

export function usePretreatmentCalculations(
  roValues: Record<string, string>,
  prevFeedMeter: number | null,
  prevPermMeter: number | null,
  prevRejMeter: number | null,
  prevPowerMeter: number | null,
  autoDurationMin: number | null,
  avgFeedFlowRate: number | null,
  avgPermFlowRate: number | null,
  avgRejFlowRate: number | null,
  anomalyRemarkFeed: string,
  anomalyRemarkPerm: string,
  anomalyRemarkRej: string,
  showRejectMeter: boolean,
): PretreatmentCalculations {
  return useMemo(() => {
    const num = (s: string) => s ? +s : NaN;
    const dp = calc.pressureDiff(num(roValues.feed_pressure_psi), num(roValues.reject_pressure_psi));

    const mDur = autoDurationMin ?? NaN;
    const mDurHr = !isNaN(mDur) && mDur > 0 ? mDur / 60 : null;

    const feedCurr = num(roValues.feed_meter_curr);
    const permCurr = num(roValues.permeate_meter_curr);
    const rejCurr = num(roValues.reject_meter_curr);

    const feedDelta = !isNaN(feedCurr) && prevFeedMeter != null ? feedCurr - prevFeedMeter : null;
    const permDelta = !isNaN(permCurr) && prevPermMeter != null ? permCurr - prevPermMeter : null;
    const rejDelta = !isNaN(rejCurr) && prevRejMeter != null ? rejCurr - prevRejMeter : null;

    const feedNegWarn = prevFeedMeter != null && !isNaN(feedCurr) && feedCurr < prevFeedMeter;
    const permNegWarn = prevPermMeter != null && !isNaN(permCurr) && permCurr < prevPermMeter;
    const rejNegWarn = prevRejMeter != null && !isNaN(rejCurr) && rejCurr < prevRejMeter;

    const feedSpike = evaluateROMeterSpike('feed', feedDelta, mDurHr, avgFeedFlowRate);
    const permSpike = evaluateROMeterSpike('permeate', permDelta, mDurHr, avgPermFlowRate);
    const rejSpike = evaluateROMeterSpike('reject', rejDelta, mDurHr, avgRejFlowRate);

    const feedHighWarn = !feedNegWarn && feedSpike.tier === 'critical';
    const permHighWarn = !permNegWarn && permSpike.tier === 'critical';
    const rejHighWarn = !rejNegWarn && rejSpike.tier === 'critical';

    const feedNeedsRemark = !feedNegWarn && feedSpike.tier !== 'ok';
    const permNeedsRemark = !permNegWarn && permSpike.tier !== 'ok';
    const rejNeedsRemark = !rejNegWarn && rejSpike.tier !== 'ok';
    const anyNeedsRemark = feedNeedsRemark || permNeedsRemark || rejNeedsRemark;

    const anomalyRemarksMissing =
      (feedNeedsRemark && !isAnomalyRemarkValid(anomalyRemarkFeed)) ||
      (permNeedsRemark && !isAnomalyRemarkValid(anomalyRemarkPerm)) ||
      (rejNeedsRemark && !isAnomalyRemarkValid(anomalyRemarkRej));

    const anyMeterSpike = feedHighWarn || permHighWarn || rejHighWarn;

    const feedVol = feedDelta ?? (permDelta !== null && rejDelta !== null ? +(permDelta + rejDelta).toFixed(3) : null);
    const permVol = permDelta ?? (feedDelta !== null && rejDelta !== null ? +(feedDelta - rejDelta).toFixed(3) : null);
    const rejVol = rejDelta ?? (feedDelta !== null && permDelta !== null ? +(feedDelta - permDelta).toFixed(3) : null);

    const feedFlowMeter = feedVol !== null && mDurHr ? +(feedVol / mDurHr).toFixed(2) : null;
    const permFlowMeter = permVol !== null && mDurHr ? +(permVol / mDurHr).toFixed(2) : null;
    const rejFlowMeter = rejVol !== null && mDurHr ? +(rejVol / mDurHr).toFixed(2) : null;

    const feedInferred = feedDelta === null && feedVol !== null;
    const permInferred = permDelta === null && permVol !== null;
    const rejInferred = rejDelta === null && rejVol !== null;

    // EM 3-way inference
    const emFeedFlow = roValues.feed_flow ? num(roValues.feed_flow) : null;
    const emPermFlow = roValues.permeate_flow ? num(roValues.permeate_flow) : null;
    const emRejFlow = roValues.reject_flow ? num(roValues.reject_flow) : null;
    const emEntered = [emFeedFlow, emPermFlow, emRejFlow].filter(v => v !== null).length;

    const effFeedFlow: number | null = (() => {
      if (emFeedFlow !== null) return emFeedFlow;
      if (emEntered === 2 && emPermFlow !== null && emRejFlow !== null)
        return +((emPermFlow + emRejFlow).toFixed(2));
      return feedFlowMeter;
    })();
    const effPermFlow: number | null = (() => {
      if (emPermFlow !== null) return emPermFlow;
      if (emEntered === 2 && emFeedFlow !== null && emRejFlow !== null)
        return +((emFeedFlow - emRejFlow).toFixed(2));
      return permFlowMeter;
    })();
    const effRejFlow: number | null = (() => {
      if (emRejFlow !== null) return emRejFlow;
      if (emEntered === 2 && emFeedFlow !== null && emPermFlow !== null)
        return +((emFeedFlow - emPermFlow).toFixed(2));
      if (emEntered === 0) {
        if (feedFlowMeter !== null && permFlowMeter !== null)
          return +((feedFlowMeter - permFlowMeter).toFixed(2));
        return rejFlowMeter;
      }
      return rejFlowMeter;
    })();

    const emFeedInferred = emFeedFlow === null && emEntered === 2 && emPermFlow !== null && emRejFlow !== null;
    const emPermInferred = emPermFlow === null && emEntered === 2 && emFeedFlow !== null && emRejFlow !== null;
    const emRejInferred = !showRejectMeter || (emRejFlow === null && emEntered === 2 && effRejFlow !== null && !(emFeedFlow === null && emPermFlow === null));

    // Recovery, rejection, salt passage
    const recovery = effPermFlow !== null && effFeedFlow !== null && effFeedFlow > 0
      ? +Math.min(100, Math.max(0, (effPermFlow / effFeedFlow) * 100)).toFixed(1) : null;
    const feedTds = num(roValues.feed_tds);
    const permTds = num(roValues.permeate_tds);
    const rejection = feedTds != null && feedTds > 0 && permTds != null
      ? +(((feedTds - permTds) / feedTds) * 100).toFixed(2) : null;
    const saltPassage = feedTds != null && feedTds > 0 && permTds != null
      ? +((permTds / feedTds) * 100).toFixed(2) : null;
    const rejectFlow = effRejFlow;

    const phWarn = !!(num(roValues.permeate_ph) && (num(roValues.permeate_ph) < 6.5 || num(roValues.permeate_ph) > 8.5));
    const recWarn = recovery != null && (recovery < 65 || recovery > 75);
    const dpAlert = dp != null && dp >= ALERTS.dp_max;

    // Power meter
    const pwrCurr = num(roValues.power_meter_curr);
    const pwrDelta = !isNaN(pwrCurr) && prevPowerMeter != null
      ? +(pwrCurr - prevPowerMeter).toFixed(3) : null;
    const pwrKw = pwrDelta !== null && mDurHr ? +(pwrDelta / mDurHr).toFixed(2) : null;
    const secEnergy = pwrDelta !== null && permVol !== null && permVol > 0
      ? +(pwrDelta / permVol).toFixed(3) : null;

    return {
      dp, feedDelta, permDelta, rejDelta,
      feedFlowMeter, permFlowMeter, rejFlowMeter,
      feedInferred, permInferred, rejInferred,
      effFeedFlow, effPermFlow, effRejFlow,
      emFeedInferred, emPermInferred, emRejInferred,
      recovery, rejection, saltPassage, rejectFlow,
      phWarn, recWarn, dpAlert,
      pwrDelta, pwrKw, secEnergy,
      feedNegWarn, permNegWarn, rejNegWarn,
      feedSpike, permSpike, rejSpike,
      feedHighWarn, permHighWarn, rejHighWarn,
      feedNeedsRemark, permNeedsRemark, rejNeedsRemark,
      anyNeedsRemark, anomalyRemarksMissing, anyMeterSpike,
      feedVol, permVol, rejVol, mDurHr,
    };
  }, [roValues, prevFeedMeter, prevPermMeter, prevRejMeter, prevPowerMeter, autoDurationMin, avgFeedFlowRate, avgPermFlowRate, avgRejFlowRate, anomalyRemarkFeed, anomalyRemarkPerm, anomalyRemarkRej, showRejectMeter]);
}