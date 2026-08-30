import { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Lamp, type LampTone } from '@/components/ui/Lamp';

export type StatusPillTone = 'default' | 'primary' | 'accent' | 'success' | 'good' | 'warn' | 'danger' | 'info' | 'muted' | 'highlight' | (string & {});

function toLampTone(tone?: string): LampTone {
  switch (tone) {
    case 'good':
    case 'success':
    case 'accent':
      return 'good';
    case 'primary':
    case 'info':
      return 'info';
    case 'warn':
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

export function StatusPill({
  tone = 'default',
  children,
  className,
  showDot = true,
  pulse = false,
}: {
  tone?: StatusPillTone | string;
  children?: ReactNode;
  className?: string;
  showDot?: boolean;
  pulse?: boolean;
}) {
  const lampTone = toLampTone(tone);
  const isDotOnly = children === '•' || children === '●' || children === '' || children == null;

  if (isDotOnly) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center p-1 rounded-full bg-card/80 border border-border/60",
          className,
        )}
        title={tone}
      >
        <Lamp tone={lampTone} size={7} pulse={pulse} />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-2xs font-medium tracking-wide text-foreground/90 bg-muted/40 border border-border/50 whitespace-nowrap",
        className,
      )}
    >
      {showDot && <Lamp tone={lampTone} size={6} pulse={pulse} />}
      <span>{children}</span>
    </span>
  );
}
