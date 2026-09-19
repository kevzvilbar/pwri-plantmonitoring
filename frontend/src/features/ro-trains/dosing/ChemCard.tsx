import React from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// ── Chemical card helper ─────────────────────────────────────────────────────
export function ChemCard({
  name, icon, value, onChange, unit, accent = 'default', inputProps = {},
}: {
  name: string; icon: React.ReactNode; value: string;
  onChange: (v: string) => void; unit: string;
  accent?: 'teal' | 'amber' | 'olive' | 'default';
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
}) {
  const hasVal = value !== '' && +value !== 0;
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
      <div className="relative">
        <Input type="number" step="any" value={value} onChange={e => onChange(e.target.value)}
          placeholder="Inputs" className="h-8 text-sm pr-7 placeholder:text-2xs placeholder:text-muted-foreground/50"
          {...inputProps} />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">{unit}</span>
      </div>
      <div className="h-0.5 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full rounded-full transition-all duration-300', bars[accent], hasVal ? 'w-1/2' : 'w-0')} />
      </div>
    </div>
  );
}
