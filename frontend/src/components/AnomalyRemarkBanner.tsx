import { AlertCircle, ShieldAlert } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Lamp } from '@/components/ui/Lamp';
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
    <div
      className={cn(
        'flex flex-col gap-2 text-xs bg-card border border-border/80 p-3.5 rounded-xl shadow-[var(--shadow-card)] transition-colors',
        isCritical ? 'edge-light-rose' : 'edge-light-amber',
      )}
    >
      <div className="flex items-start gap-2">
        <Lamp tone={isCritical ? 'danger' : 'warn'} pulse size={7} className="mt-1" />
        {isCritical ? (
          <ShieldAlert className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
        ) : (
          <AlertCircle className="h-4 w-4 shrink-0 text-warn mt-0.5" />
        )}
        <span className={cn('font-semibold leading-relaxed flex-1', isCritical ? 'text-destructive' : 'text-warn')}>
          {message}
        </span>
      </div>

      <div className="space-y-1.5 pl-6">
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
          <p className={cn('text-2xs font-mono', isCritical ? 'text-destructive/90' : 'text-warn/90')}>
            {remark.trim()
              ? `Say a bit more — at least ${MIN_ANOMALY_REMARK_LENGTH} characters needed.`
              : 'A remark is required before this reading can be saved.'}
          </p>
        )}
      </div>
    </div>
  );
}
