import { AlertCircle, ShieldAlert } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import type { DeviationResult, RateUnit } from '@/lib/flowRateGuards';
import { formatDeviationMessage } from '@/lib/flowRateGuards';
import { MIN_ANOMALY_REMARK_LENGTH, isAnomalyRemarkValid } from '@/lib/anomalyRemarks';

/**
 * Shared banner + remark input rendered by every odometer input page
 * (locator, well, product, blending, power, RO train feed/permeate/reject)
 * whenever a reading's flow rate falls outside the normal band. Replaces
 * four previously-separate, slightly different hand-written warning blocks
 * with one component so the wording, color, and remark requirement are
 * identical everywhere.
 *
 * Renders nothing for tier 'ok'. For 'needs_remark' / 'critical', renders
 * the unified message plus a required textarea — callers gate their Save
 * button on isAnomalyRemarkValid(remark) (tier !== 'ok' implies a remark is
 * required either way; 'critical' additionally still gets auto pending_review
 * exactly as before). A bare non-empty check used to pass "0" or "-" as a
 * complete remark; isAnomalyRemarkValid() also enforces a minimum length so
 * a placeholder keystroke can't stand in for an actual explanation.
 */
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
      className={
        isCritical
          ? 'flex flex-col gap-2 text-xs bg-destructive/10 border border-destructive/30 px-3 py-2 rounded-lg'
          : 'flex flex-col gap-2 text-xs bg-warn-soft border border-warn/40 px-3 py-2 rounded-lg'
      }
    >
      <span
        className={
          isCritical
            ? 'flex items-center gap-1.5 font-semibold text-destructive'
            : 'flex items-center gap-1.5 font-semibold text-warn'
        }
      >
        {isCritical ? (
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        )}
        {message}
      </span>
      <div className="space-y-1 pl-5">
        <Textarea
          value={remark}
          onChange={(e) => onRemarkChange(e.target.value)}
          placeholder="Why is this reading outside the normal range? e.g. unusually high demand, pump just serviced, meter fault…"
          maxLength={500}
          rows={2}
          className={
            isCritical
              ? 'text-xs bg-background border-destructive/40'
              : 'text-xs bg-background border-warn/60'
          }
          data-testid="anomaly-remark-textarea"
        />
        {!isAnomalyRemarkValid(remark) && (
          <p className={isCritical ? 'text-destructive/80' : 'text-warn/90'}>
            {remark.trim()
              ? `Say a bit more — at least ${MIN_ANOMALY_REMARK_LENGTH} characters needed.`
              : 'A remark is required before this reading can be saved.'}
          </p>
        )}
      </div>
    </div>
  );
}
