import React from 'react';
import { cn } from '@/lib/utils';
import { Lamp, type LampTone } from '@/components/ui/Lamp';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { MoreVertical, Clock, X, ArrowUpRight, Copy } from 'lucide-react';
import { toast } from 'sonner';

export type SignalTone = 'critical' | 'warning' | 'info' | 'good' | 'live' | 'muted';

export interface SignalAction {
  label: string;
  onClick: () => void;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: SignalTone;
  disabled?: boolean;
}

export interface SignalProps {
  variant?: 'card' | 'toast' | 'dialog-header' | 'banner';
  tone?: SignalTone | string;
  title: React.ReactNode;
  description?: React.ReactNode;
  tierLabel?: string;
  icon?: React.ComponentType<{ className?: string }>;
  pulse?: boolean;
  plantName?: string;
  source?: string;
  timestamp?: string | number | Date;
  linkPath?: string;
  onNavigate?: (path: string) => void;
  onSnooze?: (durationMs: number) => void;
  onDismiss?: () => void;
  actions?: SignalAction[];
  className?: string;
  children?: React.ReactNode;
  testId?: string;
}

const TONE_MAPPING: Record<string, {
  lampTone: LampTone;
  edgeLightClass: string;
  defaultTier: string;
  chipClass: string;
  titleClass: string;
  bgClass: string;
}> = {
  critical: {
    lampTone: 'danger',
    edgeLightClass: 'edge-light-rose',
    defaultTier: 'CRITICAL',
    chipClass: 'bg-danger/15 text-danger border-danger/30',
    titleClass: 'text-danger',
    bgClass: 'bg-card border-border/80 hover:border-danger/40',
  },
  warning: {
    lampTone: 'warn',
    edgeLightClass: 'edge-light-amber',
    defaultTier: 'WARNING',
    chipClass: 'bg-warn/15 text-amber-500 dark:text-amber-400 border-warn/30',
    titleClass: 'text-foreground',
    bgClass: 'bg-card border-border/80 hover:border-warn/40',
  },
  info: {
    lampTone: 'info',
    edgeLightClass: 'edge-light-sky',
    defaultTier: 'INFO',
    chipClass: 'bg-info/15 text-info border-info/30',
    titleClass: 'text-foreground',
    bgClass: 'bg-card border-border/80 hover:border-primary/40',
  },
  good: {
    lampTone: 'good',
    edgeLightClass: 'edge-light-teal',
    defaultTier: 'NORMAL',
    chipClass: 'bg-accent/15 text-accent border-accent/30',
    titleClass: 'text-foreground',
    bgClass: 'bg-card border-border/80 hover:border-accent/40',
  },
  live: {
    lampTone: 'live',
    edgeLightClass: 'edge-light-cyan',
    defaultTier: 'LIVE',
    chipClass: 'bg-highlight/15 text-highlight border-highlight/30',
    titleClass: 'text-foreground',
    bgClass: 'bg-card border-border/80 hover:border-highlight/40',
  },
  muted: {
    lampTone: 'muted',
    edgeLightClass: 'edge-light-slate',
    defaultTier: 'LOG',
    chipClass: 'bg-muted text-muted-foreground border-border/60',
    titleClass: 'text-muted-foreground',
    bgClass: 'bg-card border-border/70 hover:border-border',
  },
};

export function normalizeTone(tone?: string): string {
  if (!tone) return 'info';
  const lower = tone.toLowerCase();
  if (lower === 'critical' || lower === 'high' || lower === 'danger') return 'critical';
  if (lower === 'warning' || lower === 'warn' || lower === 'medium') return 'warning';
  if (lower === 'low' || lower === 'info') return 'info';
  if (lower === 'good' || lower === 'success' || lower === 'accent') return 'good';
  if (lower === 'live' || lower === 'highlight') return 'live';
  return 'muted';
}

export function Signal({
  variant = 'card',
  tone = 'info',
  title,
  description,
  tierLabel,
  icon: Icon,
  pulse,
  plantName,
  source,
  timestamp,
  linkPath,
  onNavigate,
  onSnooze,
  onDismiss,
  actions = [],
  className,
  children,
  testId,
}: SignalProps) {
  const normTone = normalizeTone(tone);
  const cfg = TONE_MAPPING[normTone] ?? TONE_MAPPING.info;
  const isCritical = normTone === 'critical';
  const isPulse = pulse ?? isCritical;
  const computedTier = tierLabel ?? cfg.defaultTier;

  const formattedTime = React.useMemo(() => {
    if (!timestamp) return null;
    try {
      const d = new Date(timestamp);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return String(timestamp);
    }
  }, [timestamp]);

  // ── VARIANT: Toast ─────────────────────────────────────────────────────────
  if (variant === 'toast') {
    return (
      <div
        className={cn(
          'flex items-center gap-2.5 py-1 px-1.5 rounded-lg border bg-card/95 text-foreground shadow-md',
          cfg.edgeLightClass,
          className,
        )}
        data-testid={testId}
      >
        <Lamp tone={cfg.lampTone} pulse={isPulse} size={8} className="shrink-0" />
        {Icon && <Icon className="h-4 w-4 shrink-0 opacity-80" />}
        <div className="flex-1 min-w-0 pr-1">
          <div className="flex items-center gap-1.5">
            <span className={cn('text-3xs font-mono-num font-bold uppercase tracking-wider px-1 py-0.2 rounded border shrink-0', cfg.chipClass)}>
              {computedTier}
            </span>
            <span className="text-xs font-semibold truncate text-foreground">{title}</span>
          </div>
          {description && (
            <p className="text-2xs text-muted-foreground truncate leading-tight mt-0.5">{description}</p>
          )}
        </div>
      </div>
    );
  }

  // ── VARIANT: Dialog Header ────────────────────────────────────────────────
  if (variant === 'dialog-header') {
    return (
      <div
        className={cn(
          'flex items-start gap-3 p-3 rounded-xl border bg-card/90',
          cfg.edgeLightClass,
          className,
        )}
        data-testid={testId}
      >
        <div className="flex items-center gap-2 mt-0.5 shrink-0">
          <Lamp tone={cfg.lampTone} pulse={isPulse} size={8} />
          {Icon && <Icon className="h-4 w-4 shrink-0 opacity-80" />}
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span className={cn('text-3xs font-mono-num font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0', cfg.chipClass)}>
              {computedTier}
            </span>
            <span className="text-sm font-bold text-foreground leading-tight">{title}</span>
          </div>
          {description && (
            <div className="text-xs text-muted-foreground leading-normal">{description}</div>
          )}
          {children}
        </div>
      </div>
    );
  }

  // ── VARIANT: Inline Banner ────────────────────────────────────────────────
  if (variant === 'banner') {
    return (
      <div
        className={cn(
          'flex flex-col gap-2 text-xs bg-card border border-border/80 p-3.5 rounded-xl shadow-xs transition-colors',
          cfg.edgeLightClass,
          className,
        )}
        data-testid={testId}
      >
        <div className="flex items-start gap-2.5">
          <Lamp tone={cfg.lampTone} pulse={isPulse} size={8} className="mt-1" />
          {Icon && <Icon className="h-4 w-4 shrink-0 mt-0.5 opacity-80" />}
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span className={cn('text-3xs font-mono-num font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0', cfg.chipClass)}>
                {computedTier}
              </span>
              <span className={cn('font-semibold leading-snug', cfg.titleClass)}>
                {title}
              </span>
            </div>
            {description && (
              <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
            )}
          </div>
        </div>
        {children}
      </div>
    );
  }

  // ── VARIANT: Card (Default) ────────────────────────────────────────────────
  const hasActions = onSnooze || onDismiss || actions.length > 0;
  const isClickable = !!linkPath || !!onNavigate;

  return (
    <div
      className={cn(
        'group p-3 rounded-xl border transition-all relative select-none',
        cfg.bgClass,
        cfg.edgeLightClass,
        isClickable ? 'cursor-pointer hover:shadow-xs' : '',
        className,
      )}
      onClick={() => {
        if (onNavigate && linkPath) onNavigate(linkPath);
      }}
      data-testid={testId}
    >
      <div className="flex items-start gap-3">
        {/* Left Glow & Icon Badge */}
        <div className="flex flex-col items-center gap-1.5 shrink-0 mt-0.5">
          <Lamp tone={cfg.lampTone} pulse={isPulse} size={8} />
          {Icon && (
            <div className="h-7 w-7 rounded-lg flex items-center justify-center bg-muted/40 border border-border/50 text-foreground/80">
              <Icon className="h-3.5 w-3.5" />
            </div>
          )}
        </div>

        {/* Content Area */}
        <div className="flex-1 min-w-0">
          {/* Header Row: Tier Chip + Title + Kebab Action Menu */}
          <div className="flex items-start justify-between gap-1.5 mb-1">
            <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
              <span className={cn('text-3xs font-mono-num font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0', cfg.chipClass)}>
                {computedTier}
              </span>
              <h5 className={cn('text-xs font-semibold leading-tight line-clamp-1 break-words', cfg.titleClass)}>
                {title}
              </h5>
            </div>

            {/* Actions Overflow Menu */}
            {hasActions && (
              <div
                className="shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="h-7 w-7 min-h-[28px] min-w-[28px] sm:min-h-[32px] sm:min-w-[32px] rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 flex items-center justify-center transition-colors focus-visible:outline-hidden"
                      aria-label={`Actions for ${typeof title === 'string' ? title : 'alert'}`}
                    >
                      <MoreVertical className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44 p-1 rounded-xl shadow-lg border border-border/80">
                    {onSnooze && (
                      <>
                        <DropdownMenuItem
                          onClick={() => onSnooze(60 * 60 * 1000)}
                          className="text-xs flex items-center gap-2 cursor-pointer py-1.5"
                        >
                          <Clock className="h-3.5 w-3.5 text-warn" />
                          <span>Snooze for 1 hour</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => onSnooze(24 * 60 * 60 * 1000)}
                          className="text-xs flex items-center gap-2 cursor-pointer py-1.5"
                        >
                          <Clock className="h-3.5 w-3.5 text-warn" />
                          <span>Snooze for 24 hours</span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    )}

                    {actions.map((act, i) => {
                      const ActIcon = act.icon;
                      return (
                        <DropdownMenuItem
                          key={i}
                          onClick={act.onClick}
                          disabled={act.disabled}
                          className="text-xs flex items-center gap-2 cursor-pointer py-1.5"
                        >
                          {ActIcon && <ActIcon className="h-3.5 w-3.5" />}
                          <span>{act.label}</span>
                        </DropdownMenuItem>
                      );
                    })}

                    {linkPath && (
                      <DropdownMenuItem
                        onClick={() => {
                          if (navigator?.clipboard) {
                            navigator.clipboard.writeText(window.location.origin + linkPath);
                            toast.success('Alert link copied to clipboard');
                          }
                        }}
                        className="text-xs flex items-center gap-2 cursor-pointer py-1.5"
                      >
                        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>Copy link</span>
                      </DropdownMenuItem>
                    )}

                    {onDismiss && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={onDismiss}
                          className="text-xs text-danger hover:text-danger flex items-center gap-2 cursor-pointer py-1.5 focus:text-danger focus:bg-danger-soft/40"
                        >
                          <X className="h-3.5 w-3.5 text-danger" />
                          <span>Dismiss alert</span>
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>

          {/* Description */}
          {description && (
            <p className="text-xs text-muted-foreground leading-snug mb-2 font-normal line-clamp-2">
              {description}
            </p>
          )}

          {children}

          {/* Metadata Row */}
          <div className="flex items-center gap-1.5 text-3xs font-medium text-muted-foreground flex-wrap pt-0.5">
            {plantName && (
              <span className="px-1.5 py-0.5 rounded bg-muted border border-border/60 text-foreground font-semibold font-mono-num">
                {plantName}
              </span>
            )}
            {source && (
              <span className="px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground font-mono-num">
                {source}
              </span>
            )}
            {formattedTime && (
              <>
                <span>·</span>
                <span className="font-mono-num">{formattedTime}</span>
              </>
            )}
            {linkPath && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  if (onNavigate) onNavigate(linkPath);
                }}
                className="ml-auto text-primary font-semibold hover:underline flex items-center gap-0.5 cursor-pointer"
              >
                View
                <ArrowUpRight className="h-3 w-3" />
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

