import { AlertCircle, ShieldAlert } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Signal } from '@/components/ui/Signal';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { DeviationResult, RateUnit } from '@/lib/flowRateGuards';
import { formatDeviationMessage } from '@/lib/flowRateGuards';
import {
  MIN_ANOMALY_REMARK_LENGTH,
  ANOMALY_REASON_OPTIONS,
  type AnomalyReasonCode,
  isAnomalyRemarkValid,
} from '@/lib/anomalyRemarks';

export function AnomalyRemarkBanner({
  result,
  label,
  unit,
  windowDays,
  remark,
  onRemarkChange,
  reasonCode,
  onReasonCodeChange,
  escalates = true,
}: {
  result: DeviationResult;
  label: string;
  unit: RateUnit;
  windowDays: number;
  remark: string;
  onRemarkChange: (value: string) => void;
  reasonCode?: AnomalyReasonCode | null;
  onReasonCodeChange?: (value: AnomalyReasonCode) => void;
  /** False for tables with no supervisor pending_review pipeline (blending, power) — see formatDeviationMessage. */
  escalates?: boolean;
}) {
  if (result.tier === 'ok') return null;

  const message = formatDeviationMessage(label, result, unit, windowDays, escalates);
  const isCritical = result.tier === 'critical';
  const isValid = isAnomalyRemarkValid(remark, reasonCode);

  return (
    <Signal
      variant="banner"
      tone={isCritical ? 'critical' : 'warning'}
      icon={isCritical ? ShieldAlert : AlertCircle}
      title={message}
      /* One-shot arrival flash: the banner mounting IS the state change, so
         the tint sweep directs the eye to it (impeccable /animate: direct
         attention at a meaningful moment). Color-only, one run. The
         reduce-motion-keep marker preserves this feedback under
         prefers-reduced-motion instead of erasing it. */
      className={cn('animate-alert-flash reduce-motion-keep', isCritical && 'animate-alert-flash-critical')}
    >
      <div className="space-y-2 pl-6 pt-1">
        {onReasonCodeChange && (
          <div className="w-full">
            <Select
              value={reasonCode ?? ''}
              onValueChange={(val) => onReasonCodeChange(val as AnomalyReasonCode)}
            >
              <SelectTrigger className="h-8 text-xs bg-card/60 border-border/70">
                <SelectValue placeholder="Select standard reason (optional)" />
              </SelectTrigger>
              <SelectContent>
                {ANOMALY_REASON_OPTIONS.map((opt) => (
                  <SelectItem key={opt.code} value={opt.code} className="text-xs">
                    <span className="font-semibold">{opt.label}</span>
                    <span className="text-3xs text-muted-foreground ml-1.5">({opt.description})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <Textarea
          value={remark}
          onChange={(e) => onRemarkChange(e.target.value)}
          placeholder={
            reasonCode && reasonCode !== 'other'
              ? 'Additional context or operator notes (optional)...'
              : 'Why is this reading outside the normal range? e.g. unusually high demand, pump just serviced, meter fault…'
          }
          maxLength={500}
          rows={2}
          className={cn(
            'text-xs bg-muted/30 border-border/70 focus:border-border font-sans',
            isCritical ? 'focus:ring-destructive/30' : 'focus:ring-warn/30',
          )}
          data-testid="anomaly-remark-textarea"
        />
        {!isValid && (
          <p className={cn('text-2xs font-mono-num font-medium', isCritical ? 'text-destructive/90' : 'text-amber-500')}>
            {remark.trim()
              ? `Say a bit more — at least ${MIN_ANOMALY_REMARK_LENGTH} characters needed.`
              : 'Select a standard reason or provide an explanation before saving.'}
          </p>
        )}
      </div>
    </Signal>
  );
}
