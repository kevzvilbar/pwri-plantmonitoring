import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';
import { Clock } from 'lucide-react';
import { SUBSYSTEM_OPTIONS } from './types';
import { Plant } from '@/hooks/usePlants';

interface AddEventFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plants: Plant[];
  initialPlantId?: string;
  isSubmitting: boolean;
  eventDate: string;
  onEventDateChange: (date: string) => void;
  plantId: string;
  onPlantIdChange: (id: string) => void;
  subsystem: string;
  onSubsystemChange: (sub: string) => void;
  duration: string;
  onDurationChange: (dur: string) => void;
  description: string;
  onDescriptionChange: (desc: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}

export function AddEventForm({
  open,
  onOpenChange,
  plants,
  initialPlantId,
  isSubmitting,
  eventDate,
  onEventDateChange,
  plantId,
  onPlantIdChange,
  subsystem,
  onSubsystemChange,
  duration,
  onDurationChange,
  description,
  onDescriptionChange,
  onSubmit,
}: AddEventFormProps) {
  if (!open) return null;

  return (
    <form
      onSubmit={onSubmit}
      className="p-4 rounded-xl border border-primary/30 bg-primary/5 space-y-3 shrink-0 animate-fade-in"
    >
      <div className="flex items-center justify-between border-b border-primary/20 pb-2">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          <span className="text-xs font-bold uppercase tracking-wider text-primary">Record Downtime Event</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-2xs text-muted-foreground hover:text-foreground"
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        <div className="space-y-1">
          <Label className="text-2xs font-semibold">Event Date *</Label>
          <DatePicker
            value={eventDate}
            onChange={onEventDateChange}
            size="sm"
            className="w-full bg-background"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-2xs font-semibold">Plant *</Label>
          <Select value={plantId} onValueChange={onPlantIdChange}>
            <SelectTrigger className="h-8 text-xs bg-background">
              <SelectValue placeholder="Select plant" />
            </SelectTrigger>
            <SelectContent>
              {plants.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-2xs font-semibold">Subsystem *</Label>
          <Select value={subsystem} onValueChange={onSubsystemChange}>
            <SelectTrigger className="h-8 text-xs bg-background">
              <SelectValue placeholder="Select subsystem" />
            </SelectTrigger>
            <SelectContent>
              {SUBSYSTEM_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-2xs font-semibold">Duration (hrs) *</Label>
          <Input
            type="number"
            step="0.1"
            min="0.1"
            max="720"
            placeholder="e.g. 3.5"
            value={duration}
            onChange={(e) => onDurationChange(e.target.value)}
            className="h-8 text-xs bg-background font-mono-num"
            required
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-2xs font-semibold">Root Cause / Operational Remarks</Label>
        <Input
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Describe shutdown reason, maintenance performed, or grid outage details…"
          className="h-8 text-xs bg-background"
        />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => onOpenChange(false)}
        >
          Dismiss
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={isSubmitting}
          className="h-7 text-xs font-semibold bg-primary text-primary-foreground gap-1.5 shadow-xs"
        >
          {isSubmitting ? 'Saving…' : 'Save Event'}
        </Button>
      </div>
    </form>
  );
}
