import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { ComputedInput } from '@/components/ComputedInput';
import { Label } from '@/components/ui/label';
import { MeterColumn } from './MeterColumn';

export interface WaterMeterSectionProps {
  showFeedMeter: boolean;
  showPermeateMeter: boolean;
  showRejectMeter: boolean;
  f: (key: string) => { value: string; onChange: (e: any) => void };
  autoDurationMin: number | null;
  prevFeedMeter: number | null;
  feedMeterCurr: string;
  feedNegWarn: boolean;
  feedSpike: any;
  feedNeedsRemark: boolean;
  anomalyRemarkFeed: string;
  setAnomalyRemarkFeed: (v: string) => void;
  feedInferred: boolean;
  feedVol: number | null;
  feedFlowMeter: number | null;
  prevPermMeter: number | null;
  permMeterCurr: string;
  permNegWarn: boolean;
  permSpike: any;
  permNeedsRemark: boolean;
  anomalyRemarkPerm: string;
  setAnomalyRemarkPerm: (v: string) => void;
  permInferred: boolean;
  permVol: number | null;
  permFlowMeter: number | null;
  meterCfg: {
    ro_production_source?: string;
    permeate_is_production?: boolean;
  };
  prevRejMeter: number | null;
  rejMeterCurr: string;
  rejNegWarn: boolean;
  rejSpike: any;
  rejNeedsRemark: boolean;
  anomalyRemarkRej: string;
  setAnomalyRemarkRej: (v: string) => void;
  rejInferred: boolean;
  rejVol: number | null;
  rejFlowMeter: number | null;
}

export function WaterMeterSection({
  showFeedMeter,
  showPermeateMeter,
  showRejectMeter,
  f,
  autoDurationMin,
  prevFeedMeter,
  feedMeterCurr,
  feedNegWarn,
  feedSpike,
  feedNeedsRemark,
  anomalyRemarkFeed,
  setAnomalyRemarkFeed,
  feedInferred,
  feedVol,
  feedFlowMeter,
  prevPermMeter,
  permMeterCurr,
  permNegWarn,
  permSpike,
  permNeedsRemark,
  anomalyRemarkPerm,
  setAnomalyRemarkPerm,
  permInferred,
  permVol,
  permFlowMeter,
  meterCfg,
  prevRejMeter,
  rejMeterCurr,
  rejNegWarn,
  rejSpike,
  rejNeedsRemark,
  anomalyRemarkRej,
  setAnomalyRemarkRej,
  rejInferred,
  rejVol,
  rejFlowMeter,
}: WaterMeterSectionProps) {
  const activeMeters = [showFeedMeter, showPermeateMeter, showRejectMeter].filter(Boolean).length;
  const meterGridClass = activeMeters === 3 ? 'grid-cols-3' : activeMeters === 2 ? 'grid-cols-2' : 'grid-cols-1';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/70 px-0.5">Water Meter</p>
        <p className="text-2xs text-muted-foreground/60 italic">
          {(!showFeedMeter || !showRejectMeter) ? 'Missing meter auto-inferred' : 'Leave one stream blank — it will be inferred'}
        </p>
      </div>
      <div className="flex items-center gap-2 mb-1">
        <Label htmlFor="pretreat-duration-min" className="text-xs text-muted-foreground shrink-0">Duration (min)</Label>
        <ComputedInput
          value={autoDurationMin != null ? String(autoDurationMin) : ''}
          className="h-7 text-xs w-28"
          id="pretreat-duration-min"
        />
        {autoDurationMin == null && (
          <span className="text-2xs text-muted-foreground/60 italic">— no prior reading found</span>
        )}
      </div>
      {(!showFeedMeter || !showRejectMeter) && (
        <div className="rounded-md bg-info-soft border border-info px-2.5 py-1.5 text-2xs text-info mb-1">
          {!showFeedMeter && showPermeateMeter && showRejectMeter && 'Feed meter disabled — feed volume auto-inferred as permeate + reject.'}
          {showFeedMeter && !showRejectMeter && 'Reject meter disabled — reject volume auto-inferred as feed − permeate.'}
          {!showFeedMeter && !showRejectMeter && 'Feed and reject meters disabled — only permeate logged.'}
        </div>
      )}
      <div className={cn('grid gap-2', meterGridClass)}>
        {showFeedMeter && (
          <MeterColumn
            label="Feed"
            stream="feed"
            f={f}
            prevReading={prevFeedMeter}
            prevId="pretreat-previous-feed-meter-reading"
            currentRawValue={feedMeterCurr}
            currentOnChange={f('feed_meter_curr')}
            currentId="pretreat-feed-meter-reading"
            negWarn={feedNegWarn}
            spike={feedSpike}
            needsRemark={feedNeedsRemark}
            remark={anomalyRemarkFeed}
            onRemarkChange={setAnomalyRemarkFeed}
            volume={feedVol}
            inferred={feedInferred}
            volId="pretreat-feed-volume-m"
            flowrate={feedFlowMeter}
            flowId="pretreat-feed-flowrate-m-hr"
          />
        )}
        {showPermeateMeter && (
          <MeterColumn
            label="Permeate"
            stream="permeate"
            f={f}
            prevReading={prevPermMeter}
            prevId="pretreat-previous-permeate-meter-reading"
            currentRawValue={permMeterCurr}
            currentOnChange={f('permeate_meter_curr')}
            currentId="pretreat-permeate-meter-reading"
            negWarn={permNegWarn}
            spike={permSpike}
            needsRemark={permNeedsRemark}
            remark={anomalyRemarkPerm}
            onRemarkChange={setAnomalyRemarkPerm}
            volume={permVol}
            inferred={permInferred}
            volId="pretreat-m"
            flowrate={permFlowMeter}
            flowId="pretreat-permeate-flowrate-m-hr"
            meterCfg={meterCfg}
          />
        )}
        {showRejectMeter && (
          <MeterColumn
            label="Reject"
            stream="reject"
            f={f}
            prevReading={prevRejMeter}
            prevId="pretreat-previous-reject-meter-reading"
            currentRawValue={rejMeterCurr}
            currentOnChange={f('reject_meter_curr')}
            currentId="pretreat-reject-meter-reading"
            negWarn={rejNegWarn}
            spike={rejSpike}
            needsRemark={rejNeedsRemark}
            remark={anomalyRemarkRej}
            onRemarkChange={setAnomalyRemarkRej}
            volume={rejVol}
            inferred={rejInferred}
            volId="pretreat-reject-volume-m"
            flowrate={rejFlowMeter}
            flowId="pretreat-reject-flowrate-m-hr"
          />
        )}
      </div>
    </div>
  );
}
