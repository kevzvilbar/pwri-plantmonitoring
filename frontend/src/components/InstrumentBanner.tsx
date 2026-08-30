import React, { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Lamp, type LampTone } from '@/components/ui/Lamp';
import { LucideIcon } from 'lucide-react';

export interface InstrumentBannerProps {
  tone?: LampTone;
  icon?: LucideIcon | React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  role?: string;
}

const EDGE_LIGHT: Record<LampTone, string> = {
  good:      'edge-light-emerald',
  accent:    'edge-light-emerald',
  warn:      'edge-light-amber',
  danger:    'edge-light-rose',
  info:      'edge-light-sky',
  live:      'edge-light-cyan',
  highlight: 'edge-light-cyan',
  muted:     'edge-light-slate',
};

export function InstrumentBanner({
  tone = 'info',
  icon: Icon,
  children,
  actions,
  className,
  role = 'status',
}: InstrumentBannerProps) {
  const edgeClass = EDGE_LIGHT[tone] ?? EDGE_LIGHT.info;

  return (
    <div
      role={role}
      className={cn(
        'flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-card border border-border/80 text-foreground shadow-[var(--shadow-card)] transition-colors',
        edgeClass,
        className,
      )}
    >
      <Lamp tone={tone} pulse={tone === 'live' || tone === 'danger' || tone === 'warn'} size={7} />
      {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
      <div className="flex-1 text-xs leading-snug text-foreground/90 font-medium">
        {children}
      </div>
      {actions && <div className="shrink-0 flex items-center gap-1.5">{actions}</div>}
    </div>
  );
}

