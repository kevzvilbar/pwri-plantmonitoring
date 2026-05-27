import { formatDistanceToNow } from 'date-fns';
import { RotateCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LastUpdatedBadgeProps {
  timestamp: Date | null;
  isRefreshing?: boolean;
  className?: string;
}

/**
 * Displays "Last updated X minutes ago" badge with optional refresh indicator.
 * Updates reactively as time passes.
 */
export function LastUpdatedBadge({
  timestamp,
  isRefreshing = false,
  className,
}: LastUpdatedBadgeProps) {
  if (!timestamp) {
    return (
      <span className={cn('text-[10px] text-muted-foreground/60', className)}>
        No data
      </span>
    );
  }

  const timeAgo = formatDistanceToNow(timestamp, { addSuffix: true });

  return (
    <div className={cn('flex items-center gap-1 text-[10px] text-muted-foreground/70', className)}>
      {isRefreshing && (
        <RotateCw className="h-2.5 w-2.5 animate-spin text-primary/60" aria-hidden />
      )}
      <span>Updated {timeAgo}</span>
    </div>
  );
}

/**
 * Cluster-level "last updated" timestamp shown in the header.
 * Useful for showing when the entire cluster's data was last fetched.
 */
export function ClusterLastUpdated({
  timestamp,
  className,
}: {
  timestamp: Date | null;
  className?: string;
}) {
  if (!timestamp) return null;

  return (
    <span className={cn('text-[11px] text-muted-foreground/60 italic', className)}>
      as of {formatDistanceToNow(timestamp, { addSuffix: true })}
    </span>
  );
}
