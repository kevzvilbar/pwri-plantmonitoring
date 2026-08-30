import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type StatusPillTone = 'default' | 'accent' | 'success' | 'good' | 'warn' | 'danger' | 'info' | 'muted' | 'highlight';

const tones: Record<StatusPillTone, string> = {
  default:   'bg-secondary text-secondary-foreground',
  accent:    'bg-accent-soft text-accent',
  success:   'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20',
  good:      'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20',
  warn:      'bg-warn-soft text-warn-foreground',
  danger:    'bg-danger-soft text-danger',
  info:      'bg-info-soft text-info',
  muted:     'bg-muted text-muted-foreground',
  highlight: 'bg-highlight-soft text-highlight',
};

export function StatusPill({ tone = 'default', children, className }: { tone?: StatusPillTone; children: ReactNode; className?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium leading-none whitespace-nowrap",
      tones[tone], className,
    )}>
      {children}
    </span>
  );
}
