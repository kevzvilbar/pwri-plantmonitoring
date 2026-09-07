import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateTimePicker } from '@/components/ui/date-picker';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { CIP_CHEM_ACCENTS, CIP_CUSTOM_ACCENT, CIP_BUILTIN_DB_MAP } from '../../../ro-trains';

export function DosingAndTimeCard({
  cipChemicals,
  chemicals,
  setChemVal,
  start,
  setStart,
  end,
  setEnd,
  formDuration,
}: {
  cipChemicals: Array<{ name: string; unit: string }>;
  chemicals: Record<string, string>;
  setChemVal: (name: string, val: string) => void;
  start: string;
  setStart: (val: string) => void;
  end: string;
  setEnd: (val: string) => void;
  formDuration: number | null;
}) {
  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">Dosing & Time</h4>
        {cipChemicals.length > 0 && (
          <span className="text-2xs text-muted-foreground">
            {cipChemicals.length} chemical{cipChemicals.length !== 1 ? 's' : ''} configured
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {cipChemicals.map(chem => {
          const val = chemicals[chem.name] ?? '';
          const accent = CIP_CHEM_ACCENTS[chem.name] ?? CIP_CUSTOM_ACCENT;
          const isBuiltin = !!CIP_BUILTIN_DB_MAP[chem.name];
          return (
            <div
              key={chem.name}
              className={cn(
                'rounded-lg border-2 p-2 space-y-1.5 transition-colors',
                val ? accent.border : 'border-border bg-muted/20',
              )}
            >
              <div className="flex items-center gap-1.5">
                <span className={cn(
                  'inline-flex items-center justify-center w-5 h-5 rounded-full text-3xs font-bold',
                  accent.badge,
                )}>
                  {isBuiltin ? chem.name.slice(0, 2).toUpperCase() : '✦'}
                </span>
                <span className="text-xs font-semibold">{chem.name} ({chem.unit})</span>
              </div>
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  step="any"
                  value={val}
                  onChange={e => setChemVal(chem.name, e.target.value)}
                  className="h-7 text-sm flex-1"
                  placeholder="0"
                />
                <span className="text-xs text-muted-foreground shrink-0">{chem.unit}</span>
              </div>
              <div className="h-0.5 rounded-full bg-muted overflow-hidden">
                <div className={cn('h-full rounded-full transition-all', accent.bar, val ? 'w-1/2' : 'w-0')} />
              </div>
            </div>
          );
        })}
        {cipChemicals.length === 0 && (
          <div className="col-span-2 rounded-lg border border-dashed border-muted-foreground/30 p-4 text-center text-xs text-muted-foreground">
            No CIP chemicals configured for this plant.
            Go to <strong>Plant Configuration → CIP Chemicals</strong> to add them.
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="ciplog-start-d-t" className="text-xs text-muted-foreground">Start Date & Time</Label>
          <DateTimePicker
            value={start}
            onChange={setStart}
            placeholder="Select start time..."
            size="sm"
            className="w-full font-mono-num"
            id="ciplog-start-d-t"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ciplog-end-d-t" className="text-xs text-muted-foreground">End Date & Time</Label>
          <DateTimePicker
            value={end}
            onChange={setEnd}
            placeholder="Select end time..."
            size="sm"
            className="w-full font-mono-num"
            id="ciplog-end-d-t"
          />
        </div>
      </div>
      {formDuration != null && formDuration > 0 && (
        <p className="text-2xs text-muted-foreground">
          Duration: <span className="font-semibold text-foreground">{formDuration} min</span>
        </p>
      )}
    </Card>
  );
}