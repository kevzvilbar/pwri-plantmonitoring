import React from 'react';
import { ArrowDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PullToRefreshProps {
  pullDistance: number;
  isRefreshing: boolean;
  isThresholdCrossed: boolean;
  progress: number;
}

export function PullToRefreshIndicator({
  pullDistance,
  isRefreshing,
  isThresholdCrossed,
  progress,
}: PullToRefreshProps) {
  if (pullDistance <= 0 && !isRefreshing) return null;

  return (
    <div
      className={cn(
        'fixed top-0 left-0 right-0 z-50 flex items-center justify-center pointer-events-none md:hidden transition-transform duration-100 ease-out',
      )}
      style={{
        transform: `translateY(${Math.max(12, pullDistance * 0.75)}px)`,
      }}
      aria-live="polite"
      aria-label={isRefreshing ? 'Refreshing data' : isThresholdCrossed ? 'Release to refresh' : 'Pull down to refresh'}
    >
      <div
        className={cn(
          'flex items-center gap-2 px-3.5 py-1.5 rounded-full shadow-lg border backdrop-blur-md transition-all duration-200',
          isThresholdCrossed || isRefreshing
            ? 'bg-primary text-primary-foreground border-primary/40 shadow-primary/20 scale-105'
            : 'bg-card/95 text-foreground border-border/80 scale-95 opacity-90',
        )}
      >
        {isRefreshing ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-primary-foreground" />
            <span className="text-xs font-semibold">Updating telemetry…</span>
          </>
        ) : (
          <>
            <ArrowDown
              className={cn(
                'h-4 w-4 transition-transform duration-200',
                isThresholdCrossed ? 'rotate-180 text-primary-foreground' : 'text-primary',
              )}
              style={{
                transform: isThresholdCrossed ? 'rotate(180deg)' : `rotate(${progress * 180}deg)`,
              }}
            />
            <span className="text-xs font-medium font-sans">
              {isThresholdCrossed ? 'Release to refresh' : 'Pull to refresh'}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

