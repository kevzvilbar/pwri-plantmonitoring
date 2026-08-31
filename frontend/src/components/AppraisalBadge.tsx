import React from 'react';
import { cn } from '@/lib/utils';
import { Lamp } from '@/components/ui/Lamp';
import { AppraisalTier, getAppraisalTier, renderAppraisalIcon } from '@/lib/appraisal';

export interface AppraisalBadgeProps {
  score?: number | null;
  tier?: AppraisalTier;
  size?: 'sm' | 'md' | 'lg';
  showScore?: boolean;
  showIcon?: boolean;
  showLamp?: boolean;
  label?: string;
  className?: string;
}

export function AppraisalBadge({
  score,
  tier: providedTier,
  size = 'md',
  showScore = true,
  showIcon = true,
  showLamp = true,
  label,
  className,
}: AppraisalBadgeProps) {
  const tier = providedTier ?? (score != null ? getAppraisalTier(score) : undefined);

  if (!tier) return null;

  if (size === 'lg') {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-2.5 px-3 py-1.5 rounded-xl border bg-card/90 shadow-2xs font-sans',
          tier.badge,
          className,
        )}
      >
        {showLamp && <Lamp tone={tier.tone} size={8} pulse={tier.minScore >= 90} />}
        {showIcon && renderAppraisalIcon(tier.iconName, 'h-4 w-4 shrink-0')}
        <div className="flex items-center gap-1.5 min-w-0">
          {label && <span className="text-xs font-semibold opacity-85">{label}:</span>}
          {showScore && score != null && (
            <span className="font-mono-num font-bold text-sm tracking-tight">{score}%</span>
          )}
          <span className="text-xs font-bold truncate">({tier.tier})</span>
        </div>
      </div>
    );
  }

  if (size === 'sm') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-2xs font-semibold select-none shrink-0 font-sans',
          tier.badge,
          className,
        )}
        title={`${tier.tier} (Score ≥ ${tier.minScore}%) — ${tier.description}`}
      >
        {showLamp && <Lamp tone={tier.tone} size={5} />}
        {showIcon && renderAppraisalIcon(tier.iconName, 'h-3 w-3 shrink-0')}
        <span className="truncate">{tier.shortLabel}</span>
      </span>
    );
  }

  // Standard 'md' size
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-semibold select-none shrink-0 font-sans',
        tier.badge,
        className,
      )}
      title={`${tier.tier} (Score ≥ ${tier.minScore}%) — ${tier.description}`}
    >
      {showLamp && <Lamp tone={tier.tone} size={6} />}
      {showIcon && renderAppraisalIcon(tier.iconName, 'h-3.5 w-3.5 shrink-0')}
      {showScore && score != null && (
        <span className="font-mono-num font-bold">{score}%</span>
      )}
      <span className="truncate">{tier.tier}</span>
    </span>
  );
}

