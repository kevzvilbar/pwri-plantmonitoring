import { cn } from '@/lib/utils';

export type LampTone = 'good' | 'warn' | 'danger' | 'info' | 'live' | 'muted' | 'accent' | 'highlight';

// Map tone onto semantic CSS custom properties so any theme change propagates automatically
const LAMP_VAR: Record<LampTone, string> = {
  good:      'var(--accent)',
  accent:    'var(--accent)',
  warn:      'var(--warn)',
  danger:    'var(--danger)',
  info:      'var(--info)',
  live:      'var(--highlight)',   // Signal Cyan — actively updating / real-time
  highlight: 'var(--highlight)',
  muted:     'var(--muted-foreground)',
};

export interface LampProps {
  tone?: LampTone;
  pulse?: boolean;
  size?: number;
  className?: string;
}

export function Lamp({
  tone = 'muted',
  pulse = false,
  size = 7,
  className,
}: LampProps) {
  const colorVar = LAMP_VAR[tone] ?? LAMP_VAR.muted;
  const glowSize = Math.max(4, Math.round(size * 0.9));

  return (
    <span
      className={cn(
        'lamp-dot inline-block rounded-full shrink-0 transition-colors',
        pulse && 'animate-live-pulse',
        className,
      )}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        backgroundColor: `hsl(${colorVar})`,
        boxShadow: `0 0 ${glowSize}px hsl(${colorVar} / 0.75)`,
      }}
      aria-hidden
    />
  );
}

