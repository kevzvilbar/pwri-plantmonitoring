import { Building2, Gauge, Clock } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DateTimePicker } from '@/components/ui/date-picker';
import { cn } from '@/lib/utils';

export interface PlantTrainSelectorProps {
  plantId: string;
  trainId: string;
  plants: any[];
  trains: any[];
  dt: string;
  isManager?: boolean;
  onPlantChange: (v: string) => void;
  onTrainChange: (v: string) => void;
  onDtChange: (v: string) => void;
}

export function PlantTrainSelector({
  plantId,
  trainId,
  plants,
  trains,
  dt,
  isManager = false,
  onPlantChange,
  onTrainChange,
  onDtChange,
}: PlantTrainSelectorProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="pretreat-plant" className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
          <Building2 className="h-3.5 w-3.5 text-primary" /> Plant
        </Label>
        <Select
          value={plantId}
          onValueChange={onPlantChange}
        >
          <SelectTrigger className="h-9 font-medium" id="pretreat-plant">
            <SelectValue placeholder="Select Plant" />
          </SelectTrigger>
          <SelectContent>
            {plants?.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pretreat-train" className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
          <Gauge className="h-3.5 w-3.5 text-primary" /> Train
        </Label>
        <Select value={trainId} onValueChange={onTrainChange} disabled={!plantId}>
          <SelectTrigger className="h-9 font-medium" id="pretreat-train">
            <SelectValue placeholder="Select Train" />
          </SelectTrigger>
          <SelectContent>
            {trains?.map((t: any) => (
              <SelectItem key={t.id} value={t.id}>{t.name ?? `Train ${t.train_number}`}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
        <div className="flex items-center justify-between">
          <Label htmlFor="pretreat-reading-date-amp-time" className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
            <Clock className="h-3.5 w-3.5 text-primary" /> Reading Timestamp
          </Label>
          {isManager ? (
            <span className="text-3xs font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
              Manager Edit
            </span>
          ) : (
            <span className="text-3xs font-medium text-muted-foreground">
              Current Hour
            </span>
          )}
        </div>
        <DateTimePicker
          value={dt}
          onChange={isManager ? onDtChange : undefined}
          disabled={!isManager}
          placeholder="Select reading timestamp..."
          size="default"
          className={cn(
            "w-full font-mono-num",
            !isManager && "cursor-not-allowed opacity-80 bg-muted/30"
          )}
          id="pretreat-reading-date-amp-time"
        />
      </div>
    </div>
  );
}
