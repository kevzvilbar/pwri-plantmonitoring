import { AlertCircle, ShieldAlert } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Signal } from '@/components/ui/Signal';
import { cn } from '@/lib/utils';
import type { DeviationResult, RateUnit } from '@/lib/flowRateGuards';
import { formatDeviationMessage } from '@/lib/flowRateGuards';
import { MIN_ANOMALY_REMARK_LENGTH, isAnomalyRemarkValid } from '@/lib/anomalyRemarks';

export function AnomalyRemarkBanner({
  result,
  label,
  unit,
  windowDays,
  remark,
  onRemarkChange,
  escalates = true,
}: {
  result: DeviationResult;
  label: string;
  unit: RateUnit;
  windowDays: number;
  remark: string;
  onRemarkChange: (value: string) => void;
  /** False for tables with no supervisor pending_review pipeline (blending, power) — see formatDeviationMessage. */
  escalates?: boolean;
}) {
  if (result.tier === 'ok') return null;

  const message = formatDeviationMessage(label, result, unit, windowDays, escalates);
  const isCritical = result.tier === 'critical';

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
      <div className="space-y-1.5 pl-6 pt-1">
        <Textarea
          value={remark}
          onChange={(e) => onRemarkChange(e.target.value)}
          placeholder="Why is this reading outside the normal range? e.g. unusually high demand, pump just serviced, meter fault…"
          maxLength={500}
          rows={2}
          className={cn(
            'text-xs bg-muted/30 border-border/70 focus:border-border font-sans',
            isCritical ? 'focus:ring-destructive/30' : 'focus:ring-warn/30',
          )}
          data-testid="anomaly-remark-textarea"
        />
        {!isAnomalyRemarkValid(remark) && (
          <p className={cn('text-2xs font-mono-num font-medium', isCritical ? 'text-destructive/90' : 'text-amber-500')}>
            {remark.trim()
              ? `Say a bit more — at least ${MIN_ANOMALY_REMARK_LENGTH} characters needed.`
              : 'A remark is required before this reading can be saved.'}
          </p>
        )}
      </div>
    </Signal>
  );
}
