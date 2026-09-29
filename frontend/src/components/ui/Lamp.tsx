import { cn } from '@/lib/utils';

export type LampTone = 'good' | 'warn' | 'danger' | 'info' | 'live' | 'muted' | 'accent' | 'highlight';
export type LampShape = 'circle' | 'triangle' | 'octagon' | 'square' | 'auto';

// Map tone onto semantic CSS custom properties so any theme change propagates automatically
const LAMP_VAR: Record<LampTone, string> = {
  good:      'var(--ok, var(--accent))',
  accent:    'var(--ok, var(--accent))',
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
  shape?: LampShape;
  className?: string;
}

export function Lamp({
  tone = 'muted',
  pulse = false,
  size = 7,
  shape = 'auto',
  className,
}: LampProps) {
  const colorVar = LAMP_VAR[tone] ?? LAMP_VAR.muted;
  const glowSize = Math.max(4, Math.round(size * 0.9));

  // Determine geometric shape for non-color status differentiation (WCAG 1.4.1 / ISA-101)
  const resolvedShape = shape === 'auto'
    ? (tone === 'danger' ? 'octagon' : tone === 'warn' ? 'triangle' : 'circle')
    : shape;

  let clipPath: string | undefined;
  let borderRadius = '9999px';

  if (resolvedShape === 'triangle') {
    clipPath = 'polygon(50% 0%, 0% 100%, 100% 100%)';
    borderRadius = '1px';
  } else if (resolvedShape === 'octagon') {
    clipPath = 'polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%)';
    borderRadius = '2px';
  } else if (resolvedShape === 'square') {
    borderRadius = '2px';
  }

  return (
    <span
      className={cn(
        'lamp-dot inline-block shrink-0 transition-colors',
        pulse && 'animate-live-pulse',
        className,
      )}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius,
        clipPath,
        backgroundColor: `hsl(${colorVar})`,
        boxShadow: `0 0 ${glowSize}px hsl(${colorVar} / 0.75)`,
      }}
      aria-hidden
    />
  );
}

