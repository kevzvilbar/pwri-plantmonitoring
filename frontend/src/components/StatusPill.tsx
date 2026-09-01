import { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Lamp, type LampTone } from '@/components/ui/Lamp';

export type StatusPillTone =
  | 'default'
  | 'primary'
  | 'accent'
  | 'success'
  | 'good'
  | 'warn'
  | 'danger'
  | 'info'
  | 'muted'
  | 'highlight'
  | 'solar'
  | 'grid'
  | (string & {});

function toLampTone(tone?: string): LampTone {
  switch (tone) {
    case 'good':
    case 'success':
    case 'accent':
      return 'good';
    case 'primary':
    case 'info':
    case 'grid':
      return 'info';
    case 'warn':
    case 'solar':
      return 'warn';
    case 'danger':
      return 'danger';
    case 'highlight':
      return 'live';
    case 'default':
    case 'muted':
    default:
      return 'muted';
  }
}

export interface StatusPillProps {
  tone?: StatusPillTone | string;
  children?: ReactNode;
  className?: string;
  showDot?: boolean;
  pulse?: boolean;
  title?: string;
  'aria-label'?: string;
}

export function StatusPill({
  tone = 'default',
  children,
  className,
  showDot = true,
  pulse = false,
  title,
  'aria-label': ariaLabel,
}: StatusPillProps) {
  const lampTone = toLampTone(tone);
  const isDotOnly = children === '•' || children === '●' || children === '' || children == null;

  if (isDotOnly) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center p-1 rounded-full bg-card/80 border border-border/60",
          className,
        )}
        title={title || tone}
        aria-label={ariaLabel}
      >
        <Lamp tone={lampTone} size={7} pulse={pulse} />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-3xs font-semibold tracking-wide text-foreground/90 bg-muted/40 border border-border/50 whitespace-nowrap leading-none",
        tone === 'warn' && "bg-warn-soft/60 border-warn/30 text-warn",
        tone === 'solar' && "bg-kpi-solar/15 border-kpi-solar/30 text-kpi-solar",
        tone === 'grid' && "bg-kpi-grid/15 border-kpi-grid/30 text-kpi-grid",
        className,
      )}
      title={title}
      aria-label={ariaLabel}
    >
      {showDot && <Lamp tone={lampTone} size={5} pulse={pulse} />}
      <span>{children}</span>
    </span>
  );
}
