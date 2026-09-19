import React from 'react';
import { AlertCircle } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { AnomalyRemarkBanner } from '@/components/AnomalyRemarkBanner';
import { cn } from '@/lib/utils';

interface WellRowAlertsProps {
  reading: string;
  belowPrev: boolean;
  isRollover: boolean;
  onIsRolloverChange: (v: boolean) => void;
  rolloverMax: string;
  onRolloverMaxChange: (v: string) => void;
  defaultRolloverMax: string;
  well: any;
  highVol: boolean;
  showAnomalyBanner: boolean;
  anomalyRemark: string;
  onAnomalyRemarkChange: (v: string) => void;
  deviationWell: any;
}

export function WellRowAlerts({
  reading, belowPrev, isRollover, onIsRolloverChange, rolloverMax, onRolloverMaxChange,
  defaultRolloverMax, well, highVol, showAnomalyBanner, anomalyRemark, onAnomalyRemarkChange, deviationWell,
}: WellRowAlertsProps) {
  return (
    <>
      {reading && belowPrev && (
        <div className="flex flex-col gap-1 text-xs bg-warn-soft border border-warn px-3 py-2 rounded-lg">
          <span className="flex items-center gap-1.5 font-semibold text-warn">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            Verify before saving
          </span>
          <span className="text-warn pl-5">
            Meter reading is below the previous value — possible meter rollback or data entry error.
            If the meter was replaced, check "Meter replaced" above instead.
          </span>
          <div className="pl-5 flex flex-wrap items-center gap-2 pt-1">
            <label className="flex items-center gap-1.5 text-warn cursor-pointer">
              <Checkbox checked={isRollover} onCheckedChange={(v) => onIsRolloverChange(v === true)} />
              This is a meter rollover (odometer wrapped around), not an error
            </label>
            {isRollover && (
              <span className="flex items-center gap-1.5">
                <span className="text-warn">Wrap point:</span>
                <Input
                  value={rolloverMax}
                  onChange={(e) => onRolloverMaxChange(e.target.value)}
                  className="h-6 w-24 text-xs"
                  inputMode="numeric"
                />
                {well.meter_rollover_max == null && (
                  <span className="text-warn/70 text-2xs">(guess — confirm against the meter, or set it once in Edit Well)</span>
                )}
              </span>
            )}
          </div>
        </div>
      )}

      {reading && !belowPrev && highVol && (showAnomalyBanner || anomalyRemark.trim().length > 0) && (
        <AnomalyRemarkBanner
          result={deviationWell}
          label={well.name}
          unit="m3/hr"
          windowDays={10}
          remark={anomalyRemark}
          onRemarkChange={onAnomalyRemarkChange}
        />
      )}
    </>
  );
}
