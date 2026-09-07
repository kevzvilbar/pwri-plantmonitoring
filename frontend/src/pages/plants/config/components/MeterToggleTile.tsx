import type { ReactNode } from 'react';
import { Switch } from '@/components/ui/switch';

export function MeterToggleTile({
  icon, title, subtitle, checked, onToggle, canEdit,
  accentColor = 'teal',
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  checked: boolean;
  onToggle: (v: boolean) => void;
  canEdit: boolean;
  accentColor?: 'teal' | 'amber' | 'blue' | 'purple';
}) {
  const colors = {
    teal:   { on: 'border-primary/60 bg-primary-soft/70', icon: 'bg-primary-soft', sw: 'data-[state=checked]:bg-primary' },
    amber:  { on: 'border-warn/60 bg-warn-soft/70', icon: 'bg-warn-soft', sw: 'data-[state=checked]:bg-warn' },
    blue:   { on: 'border-info/60 bg-info-soft/70', icon: 'bg-info-soft', sw: 'data-[state=checked]:bg-info' },
    purple: { on: 'border-kpi-ro/60 bg-kpi-ro/70', icon: 'bg-kpi-ro/15', sw: 'data-[state=checked]:bg-kpi-ro' },
  }[accentColor];

  return (
    <label className={[
      'flex items-center justify-between gap-3 p-3 rounded-lg border transition-colors',
      checked ? colors.on : 'border-border bg-muted/30',
      canEdit ? 'cursor-pointer' : 'cursor-default',
    ].join(' ')}>
      <div className="flex items-center gap-2.5 min-w-0">
        <div className={`flex items-center justify-center h-8 w-8 rounded-full shrink-0 ${checked ? colors.icon : 'bg-muted'}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{title}</div>
          <div className="text-xs text-muted-foreground leading-tight">{subtitle}</div>
        </div>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={canEdit ? onToggle : undefined}
        disabled={!canEdit}
        className={`h-8 w-14 sm:h-5 sm:w-9 shrink-0 [&>span]:h-6 [&>span]:w-6 sm:[&>span]:h-4 sm:[&>span]:w-4 [&>span]:data-[state=checked]:translate-x-6 sm:[&>span]:data-[state=checked]:translate-x-4 ${colors.sw}`}
      />
    </label>
  );
}
