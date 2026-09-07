import React from 'react';
import { DateRangePicker } from '@/components/ui/date-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar, Search, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Plant } from '@/hooks/usePlants';

interface TopControlsBarProps {
  dateRange: { from: string; to: string };
  onDateRangeChange: (range: { from: string; to: string }) => void;
  selectedPlantId: string;
  onSelectedPlantIdChange: (id: string) => void;
  initialPlantId?: string;
  plants: Plant[];
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onLogClick: () => void;
}

export function TopControlsBar({
  dateRange,
  onDateRangeChange,
  selectedPlantId,
  onSelectedPlantIdChange,
  initialPlantId,
  plants,
  searchQuery,
  onSearchQueryChange,
  onLogClick,
}: TopControlsBarProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2.5 p-3 rounded-xl bg-card border border-border/80 shadow-2xs shrink-0">
      <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[280px]">
        <div className="space-y-1 flex-1 min-w-[200px]">
          <Label className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Calendar className="h-3 w-3 text-primary" /> Time Horizon Range
          </Label>
          <DateRangePicker
            from={dateRange.from}
            to={dateRange.to}
            onChange={onDateRangeChange}
            size="sm"
            className="w-full h-8.5 text-xs bg-background"
            placeholder="Select date horizon..."
          />
        </div>

        {!initialPlantId && plants.length > 0 && (
          <div className="space-y-1 min-w-[140px]">
            <Label className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Plant</Label>
            <Select value={selectedPlantId} onValueChange={onSelectedPlantIdChange}>
              <SelectTrigger className="h-8.5 text-xs bg-background">
                <SelectValue placeholder="All Plants" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Plants</SelectItem>
                {plants.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <div className="relative w-44 sm:w-56">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder="Search cause / notes…"
            className="h-8.5 text-xs pl-8 bg-background"
          />
        </div>

        <Button
          size="sm"
          onClick={onLogClick}
          className="h-8.5 px-3 text-xs gap-1.5 bg-primary text-primary-foreground font-semibold shadow-xs"
        >
          <Plus className="h-3.5 w-3.5" /> Log Downtime
        </Button>
      </div>
    </div>
  );
}
