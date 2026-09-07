import { AlertTriangle, AlertCircle } from 'lucide-react';
import { AnomalyRemarkBanner } from '@/components/AnomalyRemarkBanner';

interface StatusBannersProps {
  cooldownMinutes: number;
  cooldownAvailableAt: Date | null;
  lastSavePending: boolean;
  reading: string;
  belowPrev: boolean;
  highVol: boolean;
  showAnomalyBanner: boolean;
  anomalyRemark: string;
  deviationLoc: any;
  locatorName: string;
  onAnomalyRemarkChange: (value: string) => void;
}

export function StatusBanners({
  cooldownMinutes, cooldownAvailableAt, lastSavePending,
  reading, belowPrev, highVol, showAnomalyBanner, anomalyRemark, deviationLoc, locatorName,
  onAnomalyRemarkChange,
}: StatusBannersProps) {
  return (
    <>
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
          label={locatorName}
          unit="m3/hr"
          windowDays={10}
          remark={anomalyRemark}
          onRemarkChange={onAnomalyRemarkChange}
        />
      )}
    </>
  );
}
