import React from 'react';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { QuickUnitOption } from './quickUnits';

// ── Chemical card helper ─────────────────────────────────────────────────────
//
// By default the unit is a fixed label. Pass `unitOptions` (with `unitId` and
// `onUnitChange`) to let the operator pick the unit the amount is typed in, and
// `hint` to show what will actually be saved (for example "= 50 kg").
export function ChemCard({
  name, icon, value, onChange, unit, accent = 'default', inputProps = {},
  unitOptions, unitId, onUnitChange, hint,
}: {
  name: string; icon: React.ReactNode; value: string;
  onChange: (v: string) => void; unit: string;
  accent?: 'teal' | 'amber' | 'olive' | 'default';
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
  unitOptions?: QuickUnitOption[];
  unitId?: string;
  onUnitChange?: (id: string) => void;
  hint?: string;
}) {
  const hasVal = value !== '' && +value !== 0;
  const pickable = !!unitOptions && unitOptions.length > 1 && !!onUnitChange;
  const selected = pickable ? (unitOptions!.find((o) => o.id === unitId) ?? unitOptions![0]) : undefined;
  // Sections (Weight / Volume) only when the list really has more than one.
  const groupNames = pickable
    ? Array.from(new Set(unitOptions!.map((o) => o.group).filter((g): g is NonNullable<typeof g> => !!g)))
    : [];
  const renderUnit = (o: QuickUnitOption) => (
    <SelectItem key={o.id} value={o.id} className="text-xs">
      {o.label}
    </SelectItem>
  );
  const borders: Record<string, string> = {
    teal:    'border-primary bg-primary-soft/40',
    amber:   'border-warn bg-warn-soft/40',
    olive:   'border-warn bg-warn-soft/40',
    default: 'border-primary/30 bg-primary/5',
  };
  const bars: Record<string, string> = {
    teal: 'bg-primary', amber: 'bg-warn', olive: 'bg-warn', default: 'bg-primary/60',
  };
  return (
    <div className={cn('rounded-lg border-2 p-2 space-y-1.5 transition-colors', hasVal ? borders[accent] : 'border-border bg-muted/10')}>
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-xs font-semibold leading-tight">{name}</span>
      </div>
      {pickable && selected ? (
        <div className="flex items-center gap-1">
          <Input type="number" step="any" value={value} onChange={e => onChange(e.target.value)}
            placeholder="Inputs" className="h-8 min-w-0 flex-1 text-sm placeholder:text-2xs placeholder:text-muted-foreground/50"
            {...inputProps} />
          <Select value={selected.id} onValueChange={onUnitChange}>
            <SelectTrigger
              aria-label={`${name} unit`}
              className="h-8 w-auto min-w-[3.75rem] max-w-[6.5rem] shrink-0 gap-1 px-2 text-xs"
            >
              <SelectValue>
                <span className="truncate">{selected.shortLabel}</span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {groupNames.length > 1 ? (
                <>
                  {unitOptions!.filter((o) => !o.group).map(renderUnit)}
                  {groupNames.map((g) => (
                    <SelectGroup key={g}>
                      <SelectLabel className="py-1 pl-2 text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {g === 'Weight' ? 'By weight' : 'By volume'}
                      </SelectLabel>
                      {unitOptions!.filter((o) => o.group === g).map(renderUnit)}
                    </SelectGroup>
                  ))}
                </>
              ) : (
                unitOptions!.map(renderUnit)
              )}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <div className="relative">
          <Input type="number" step="any" value={value} onChange={e => onChange(e.target.value)}
            placeholder="Inputs" className="h-8 text-sm pr-7 placeholder:text-2xs placeholder:text-muted-foreground/50"
            {...inputProps} />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">{unit}</span>
        </div>
      )}
      {hint && <p className="px-0.5 text-3xs font-mono text-muted-foreground">{hint}</p>}
      <div className="h-0.5 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full rounded-full transition-all duration-300', bars[accent], hasVal ? 'w-1/2' : 'w-0')} />
      </div>
    </div>
  );
}
