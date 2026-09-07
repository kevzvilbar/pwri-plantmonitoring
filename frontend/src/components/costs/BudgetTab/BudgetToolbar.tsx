import { PlantPicker } from '@/components/costs/PlantPicker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function BudgetToolbar({ plantId, setPlantId, year, setYear }: {
  plantId: string;
  setPlantId: (id: string) => void;
  year: number;
  setYear: (y: number) => void;
}) {
  return (
    <div className="p-1.5 rounded-xl border border-border/50 bg-card flex flex-wrap gap-2 items-center justify-between">
      <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-sm">
        <div className="flex-1">
          <PlantPicker value={plantId} onChange={setPlantId} id="budgettab-plant" />
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-2xs text-muted-foreground font-semibold">Year:</span>
        <Select value={String(year)} onValueChange={(v) => setYear(+v)}>
          <SelectTrigger id="budgettab-year" className="h-8 w-24 rounded-lg text-xs font-medium bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[year - 1, year, year + 1].map((y) => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
