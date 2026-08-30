import React from 'react';
import { StatusPill, type StatusPillTone } from '@/components/StatusPill';
import { MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export interface MetaAlert {
  tone?: StatusPillTone;
  icon?: React.ComponentType<{ className?: string }>;
  label: React.ReactNode;
  className?: string;
  onClick?: () => void;
  title?: string;
  testId?: string;
}

export interface MetaOverflowItem {
  icon?: React.ComponentType<{ className?: string }>;
  label: React.ReactNode;
  onClick?: () => void;
  title?: string;
  className?: string;
  testId?: string;
}

interface MetaStripProps {
  primary?: React.ReactNode;
  alerts?: (MetaAlert | null | undefined | false)[];
  overflow?: (MetaOverflowItem | null | undefined | false)[];
  maxVisible?: number;
  className?: string;
}

export function MetaStrip({
  primary,
  alerts = [],
  overflow = [],
  maxVisible = 3,
  className,
}: MetaStripProps) {
  const activeAlerts = alerts.filter(Boolean) as MetaAlert[];
  const activeOverflow = overflow.filter(Boolean) as MetaOverflowItem[];

  // Calculate slots: primary takes 1 slot if present
  const availableSlots = Math.max(1, maxVisible - (primary ? 1 : 0));
  const visibleAlerts = activeAlerts.slice(0, availableSlots);
  const hiddenAlerts = activeAlerts.slice(availableSlots);

  const allOverflowItems = [
    ...hiddenAlerts.map((a) => ({
      icon: a.icon,
      label: a.label,
      onClick: a.onClick,
      title: a.title,
      className: a.tone === 'danger' ? 'text-danger' : a.tone === 'warn' ? 'text-warn' : undefined,
      testId: a.testId,
    })),
    ...activeOverflow,
  ];

  const hasOverflow = allOverflowItems.length > 0;

  return (
    <div className={cn('flex items-center gap-1.5 flex-wrap min-w-0', className)}>
      {primary}

      {visibleAlerts.map((alert, idx) => {
        const Icon = alert.icon;
        if (alert.onClick) {
          return (
            <button
              key={idx}
              type="button"
              onClick={alert.onClick}
              title={alert.title}
              data-testid={alert.testId}
              className={cn(
                'inline-flex items-center gap-1 text-2xs font-semibold px-2 py-0.5 rounded-full transition-colors shrink-0',
                alert.tone === 'danger' && 'bg-danger-soft text-danger border border-danger/40 hover:bg-danger/20',
                alert.tone === 'warn' && 'bg-warn-soft text-warn border border-warn/40 hover:bg-warn/20',
                alert.tone === 'accent' && 'bg-accent-soft text-accent border border-accent/40 hover:bg-accent/20',
                (!alert.tone || alert.tone === 'default') && 'bg-muted text-muted-foreground hover:text-foreground',
                alert.className,
              )}
            >
              {Icon && <Icon className="h-3 w-3 shrink-0" />}
              <span>{alert.label}</span>
            </button>
          );
        }

        return (
          <StatusPill
            key={idx}
            tone={alert.tone || 'default'}
            className={cn('shrink-0', alert.className)}
          >
            {Icon && <Icon className="h-3 w-3 shrink-0" />}
            {alert.label}
          </StatusPill>
        );
      })}

      {hasOverflow && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="More details & actions"
              aria-label="More details & actions"
              className="h-5 px-1.5 rounded-full bg-muted/80 hover:bg-muted text-muted-foreground hover:text-foreground text-3xs font-semibold inline-flex items-center gap-0.5 transition-colors shrink-0"
            >
              <MoreHorizontal className="h-3 w-3" />
              {allOverflowItems.length > 1 && <span>+{allOverflowItems.length}</span>}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[180px] p-1">
            {allOverflowItems.map((item, i) => {
              const Icon = item.icon;
              return (
                <DropdownMenuItem
                  key={i}
                  onClick={item.onClick}
                  className={cn(
                    'text-xs gap-2 py-1.5 px-2 cursor-pointer font-medium',
                    item.className,
                  )}
                  data-testid={item.testId}
                >
                  {Icon && <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" />}
                  <span>{item.label}</span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

