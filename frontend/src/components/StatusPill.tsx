import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type StatusPillTone = 'default' | 'accent' | 'success' | 'good' | 'warn' | 'danger' | 'info' | 'muted' | 'highlight';

const lampColors: Record<StatusPillTone, { dot: string; glow: string }> = {
  default:   { dot: 'bg-muted-foreground/60', glow: 'shadow-[0_0_4px_rgba(133,146,160,0.35)]' },
  accent:    { dot: 'bg-emerald-400', glow: 'shadow-[0_0_6px_rgba(52,211,153,0.7)]' },
  success:   { dot: 'bg-emerald-400', glow: 'shadow-[0_0_6px_rgba(52,211,153,0.7)]' },
  good:      { dot: 'bg-emerald-400', glow: 'shadow-[0_0_6px_rgba(52,211,153,0.7)]' },
  warn:      { dot: 'bg-amber-400', glow: 'shadow-[0_0_6px_rgba(251,191,36,0.7)]' },
  danger:    { dot: 'bg-rose-500', glow: 'shadow-[0_0_6px_rgba(244,63,94,0.7)]' },
  info:      { dot: 'bg-sky-400', glow: 'shadow-[0_0_6px_rgba(56,189,248,0.7)]' },
  muted:     { dot: 'bg-muted-foreground/50', glow: 'shadow-[0_0_3px_rgba(133,146,160,0.25)]' },
  highlight: { dot: 'bg-cyan-400', glow: 'shadow-[0_0_6px_rgba(34,211,238,0.7)]' },
};

export function StatusPill({
  tone = 'default',
  children,
  className,
  showDot = true,
}: {
  tone?: StatusPillTone;
  children?: ReactNode;
  className?: string;
  showDot?: boolean;
}) {
  const lamp = lampColors[tone] || lampColors.default;
  const isDotOnly = children === '•' || children === '●' || children === '' || children == null;

  if (isDotOnly) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center p-1 rounded-full bg-background/60 border border-border/50",
          className,
        )}
        title={tone}
      >
        <span
          className={cn(
            "h-2 w-2 rounded-full shrink-0 transition-all",
            lamp.dot,
            lamp.glow,
          )}
          aria-hidden
        />
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
      {showDot && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full shrink-0 transition-all",
            lamp.dot,
            lamp.glow,
          )}
          aria-hidden
        />
      )}
      <span>{children}</span>
    </span>
  );
}
