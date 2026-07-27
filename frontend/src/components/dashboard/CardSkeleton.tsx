import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface CardSkeletonProps {
  className?: string;
  count?: number;
}

/**
 * Skeleton loader for StatCards during data fetching.
 * Displays animated placeholder content matching the StatCard layout.
 */
export function CardSkeleton({ className, count = 1 }: CardSkeletonProps) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <Card
          key={i}
          className={cn(
            'stat-card p-3 space-y-2 animate-pulse',
            'bg-gradient-to-br from-muted/40 to-transparent',
            className,
          )}
        >
          {/* Icon + Label placeholder */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 space-y-1">
              <div className="h-3 w-24 bg-muted-foreground/20 rounded" />
              <div className="h-4 w-16 bg-muted-foreground/15 rounded" />
            </div>
            <div className="h-5 w-5 bg-muted-foreground/20 rounded" />
          </div>

          {/* Value + Unit placeholder */}
          <div className="space-y-1">
            <div className="h-6 w-20 bg-muted-foreground/25 rounded" />
            <div className="h-3 w-12 bg-muted-foreground/15 rounded" />
          </div>

          {/* Trend badge placeholder */}
          <div className="h-3 w-10 bg-muted-foreground/15 rounded" />
        </Card>
      ))}
    </>
  );
}

/**
 * Skeleton for full-width chart/data containers.
 */
export function ChartSkeleton() {
  return (
    <Card className="p-4 space-y-3 animate-pulse">
      {/* Header placeholder */}
      <div className="h-4 w-32 bg-muted-foreground/20 rounded" />

      {/* Chart area placeholder */}
      <div className="h-64 bg-muted/30 rounded-lg" />

      {/* Legend placeholder */}
      <div className="flex gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-3 w-20 bg-muted-foreground/15 rounded" />
        ))}
      </div>
    </Card>
  );
}
