import { usePlants } from '@/hooks/usePlants';
import { useAppStore } from '@/store/appStore';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { DateTimePicker } from '@/components/ui/date-picker';
import { ExportButton } from '@/components/ExportButton';
import { History } from 'lucide-react';
import { cn } from '@/lib/utils';

const DAYS_OPTIONS = ['7', '30', '90', 'custom'] as const;

interface DosingHistoryLogFiltersProps {
  filterPlantId: string;
  setFilterPlantId: (id: string) => void;
  selectedPlantId: string | null | undefined;
  setSelectedPlantId: (id: string | null) => void;
  days: '7' | '30' | '90' | 'custom';
  setDays: (d: '7' | '30' | '90' | 'custom') => void;
  customFrom: string;
  setCustomFrom: (v: string) => void;
  customTo: string;
  setCustomTo: (v: string) => void;
  lastSyncedPlantRef: React.MutableRefObject<string | null>;
  plants: { id: string; name: string }[] | undefined;
}

export function DosingHistoryLogFilters({
  filterPlantId, setFilterPlantId, selectedPlantId, setSelectedPlantId,
  days, setDays, customFrom, setCustomFrom, customTo, setCustomTo,
  lastSyncedPlantRef, plants,
}: DosingHistoryLogFiltersProps) {
  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <History className="h-4 w-4 text-primary shrink-0" />
        <h4 className="text-sm font-semibold text-foreground">Dosing History</h4>
        <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
          <ExportButton table="chemical_dosing_logs" label="Export" />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <div>
          <Label htmlFor="dosinghistorylog-plant" className="text-xs text-muted-foreground">Plant</Label>
          <Select
            value={filterPlantId || '__all__'}
            onValueChange={(v) => {
              const nextId = v === '__all__' ? '' : v;
              lastSyncedPlantRef.current = nextId || null;
              setFilterPlantId(nextId);
              setSelectedPlantId(nextId || null);
            }}
          >
            <SelectTrigger className="h-8 text-xs" id="dosinghistorylog-plant"><SelectValue placeholder="All plants" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All plants</SelectItem>
              {plants?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="dosinghistorylog-period" className="text-xs text-muted-foreground">Period</Label>
          <Select value={days} onValueChange={(v: any) => setDays(v)}>
            <SelectTrigger className="h-8 text-xs" id="dosinghistorylog-period"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DAYS_OPTIONS.map(d => (
                <SelectItem key={d} value={d}>{d === 'custom' ? 'Custom range' : `Last ${d} days`}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {days === 'custom' && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="dosinghistorylog-from" className="text-xs text-muted-foreground">From</Label>
            <Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="h-8 text-xs" id="dosinghistorylog-from"/>
          </div>
          <div>
            <Label htmlFor="dosinghistorylog-to" className="text-xs text-muted-foreground">To</Label>
            <Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="h-8 text-xs" id="dosinghistorylog-to"/>
          </div>
        </div>
      )}
    </Card>
  );
}
