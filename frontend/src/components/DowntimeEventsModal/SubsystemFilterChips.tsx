import React from 'react';
import { Button } from '@/components/ui/button';
import { Filter } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SubsystemFilterChipsProps {
  subs: { subsystem: string; hours: number }[];
  totalDurationHrs: number;
  totalCount: number;
  subFilter: string;
  onSubFilterChange: (filter: string) => void;
}

export function SubsystemFilterChips({
  subs,
  totalDurationHrs,
  totalCount,
  subFilter,
  onSubFilterChange,
}: SubsystemFilterChipsProps) {
  return (
    <div className="flex flex-wrap gap-1.5 items-center px-1 shrink-0">
      <Filter className="h-3.5 w-3.5 text-muted-foreground mr-1" />
      <Button
        size="sm"
        variant={subFilter === 'all' ? 'default' : 'outline'}
        className={cn(
          'h-6.5 px-2.5 text-2xs rounded-full transition-all',
          subFilter === 'all' && 'shadow-xs font-semibold'
        )}
        onClick={() => onSubFilterChange('all')}
        data-testid="downtime-filter-all"
      >
        All Subsystems · {totalDurationHrs ?? 0}h
      </Button>
      {subs.map((s) => (
        <Button
          key={s.subsystem}
          size="sm"
          variant={subFilter === s.subsystem ? 'default' : 'outline'}
          className={cn(
            'h-6.5 px-2.5 text-2xs rounded-full transition-all',
            subFilter === s.subsystem && 'shadow-xs font-semibold'
          )}
          onClick={() => onSubFilterChange(s.subsystem)}
          data-testid={`downtime-filter-${s.subsystem}`}
        >
          {s.subsystem}
          <span className="ml-1 font-mono-num font-semibold text-muted-foreground">{s.hours}h</span>
        </Button>
      ))}
    </div>
  );
}
