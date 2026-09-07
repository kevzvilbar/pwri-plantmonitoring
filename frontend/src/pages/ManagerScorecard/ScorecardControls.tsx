import { Building2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const WINDOW_OPTIONS: { label: string; value: number }[] = [
  { label: '7d', value: 7 },
  { label: '14d', value: 14 },
  { label: '30d', value: 30 },
  { label: '90d (Qtr)', value: 90 },
  { label: '365d (Annual YTD)', value: 365 },
];

interface ScorecardControlsProps {
  days: number;
  onDaysChange: (days: number) => void;
  viewBy: 'plant' | 'manager';
  onViewByChange: (view: 'plant' | 'manager') => void;
  managerCount: number;
  plantCount: number;
  avgCompleteness: number | null;
}

export function ScorecardControls({
  days, onDaysChange, viewBy, onViewByChange,
  managerCount, plantCount, avgCompleteness,
}: ScorecardControlsProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5 p-2 rounded-xl bg-muted/40 border border-border/60 font-sans">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex rounded-lg border border-border/70 bg-background overflow-hidden p-0.5 shadow-2xs">
          {WINDOW_OPTIONS.map(({ label, value }) => (
            <button
              key={String(value)}
              className={cn(
                'px-2.5 py-1 text-xs font-semibold rounded-md transition-all',
                days === value
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
              )}
              onClick={() => onDaysChange(value)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex rounded-lg border border-border/70 bg-background overflow-hidden p-0.5 shadow-2xs">
          <button
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-all',
              viewBy === 'plant'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
            )}
            onClick={() => onViewByChange('plant')}
          >
            <Building2 className="h-3.5 w-3.5" /> View by Plant
          </button>
          <button
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-all',
              viewBy === 'manager'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
            )}
            onClick={() => onViewByChange('manager')}
          >
            <Users className="h-3.5 w-3.5" /> View by Manager
          </button>
        </div>
      </div>

      <div className="text-2xs text-muted-foreground flex items-center gap-2">
        <span><strong className="text-foreground">{managerCount}</strong> managers</span>
        <span>·</span>
        <span><strong className="text-foreground">{plantCount}</strong> plants</span>
        <span>·</span>
        <span className={cn('font-bold', (avgCompleteness ?? 0) >= 80 ? 'text-accent' : 'text-warn')}>
          {avgCompleteness === null ? '—' : `${avgCompleteness.toFixed(1)}%`} Avg Completeness
        </span>
      </div>
    </div>
  );
}
