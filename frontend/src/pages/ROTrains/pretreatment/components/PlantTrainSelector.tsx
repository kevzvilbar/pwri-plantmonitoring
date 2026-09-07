import { Building2, Gauge } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DateTimePicker } from '@/components/ui/date-picker';
import { format } from 'date-fns';

export interface PlantTrainSelectorProps {
  plantId: string;
  trainId: string;
  plants: any[];
  trains: any[];
  dt: string;
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
  onPlantChange,
  onTrainChange,
  onDtChange,
}: PlantTrainSelectorProps) {
  return (
    <>
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
              {trains?.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pretreat-dt" className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
            <Gauge className="h-3.5 w-3.5 text-primary" /> Reading Date/Time
          </Label>
          <DateTimePicker
            value={dt}
            onChange={onDtChange}
            placeholder="Select date/time..."
            size="sm"
            className="w-full font-mono-num"
            id="pretreat-dt"
          />
        </div>
      </div>
    </>
  );
}
