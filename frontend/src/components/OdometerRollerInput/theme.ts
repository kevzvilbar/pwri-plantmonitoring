export type OdometerAlertState = 'neutral' | 'ok' | 'warn' | 'error';

export const ODO_THEME: Record<OdometerAlertState, {
  cell: string; cellActive: string;
  digit: string; digitActive: string;
  decCell: string; decDigit: string;
  dot: string; glow: string;
}> = {
  neutral: {
    cell:        'bg-muted/90 border-border',
    cellActive:  'bg-highlight-soft/90   border-highlight   ',
    digit:       'text-foreground/80',
    digitActive: 'text-highlight  ',
    decCell:     'bg-muted/50  border-border/50',
    decDigit:    'text-muted-foreground/70',
    dot:         'text-muted-foreground',
    glow:        'ring-2 ring-highlight/50',
  },
  ok: {
    cell:        'bg-accent-soft/90 border-accent/70',
    cellActive:  'bg-accent-soft/90 border-accent ',
    digit:       'text-accent',
    digitActive: 'text-accent',
    decCell:     'bg-accent-soft/50  border-accent/50',
    decDigit:    'text-accent/60',
    dot:         'text-accent',
    glow:        'ring-2 ring-accent/50',
  },
  warn: {
    cell:        'bg-warn-soft/90  border-warn/70 ',
    cellActive:  'bg-warn-soft/90 border-warn   ',
    digit:       'text-warn ',
    digitActive: 'text-warn ',
    decCell:     'bg-warn-soft/50  border-warn/50',
    decDigit:    'text-warn/60',
    dot:         'text-warn ',
    glow:        'ring-2 ring-warn/50',
  },
  error: {
    cell:        'bg-danger-soft/90   border-danger/70  ',
    cellActive:  'bg-danger-soft/90  border-danger     ',
    digit:       'text-danger  ',
    digitActive: 'text-danger  ',
    decCell:     'bg-danger-soft/50   border-danger/50 ',
    decDigit:    'text-danger/60',
    dot:         'text-danger  ',
    glow:        'ring-2 ring-danger/50',
  },
} as const;
