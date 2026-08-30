import React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ClusterAction {
  id?: string;
  icon?: React.ComponentType<{ className?: string }>;
  label?: string;
  title?: string;
  onClick: () => void;
  variant?: 'default' | 'danger' | 'warn' | 'accent' | 'primary';
  disabled?: boolean;
  testId?: string;
}

interface ControlClusterProps {
  actions: (ClusterAction | null | undefined | false)[];
  className?: string;
  size?: 'sm' | 'default';
}

export function ControlCluster({
  actions,
  className,
  size = 'default',
}: ControlClusterProps) {
  const activeActions = actions.filter(Boolean) as ClusterAction[];
  if (!activeActions.length) return null;

  const isSm = size === 'sm';

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full bg-muted/60 border border-border/80 divide-x divide-border/60 p-0.5 shadow-xs shrink-0',
        className,
      )}
    >
      {activeActions.map((action, i) => {
        const Icon = action.icon;
        const colorCls =
          action.variant === 'danger'
            ? 'text-danger hover:text-danger hover:bg-danger-soft/60'
            : action.variant === 'warn'
            ? 'text-warn hover:text-warn hover:bg-warn-soft/60'
            : action.variant === 'accent'
            ? 'text-accent hover:text-accent hover:bg-accent-soft/60'
            : action.variant === 'primary'
            ? 'text-primary hover:text-primary hover:bg-primary-soft/60'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/80';

        return (
          <button
            key={action.id || i}
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
            title={action.title || action.label}
            aria-label={action.title || action.label}
            data-testid={action.testId}
            className={cn(
              'inline-flex items-center justify-center font-semibold transition-all rounded-full select-none',
              isSm ? 'h-7 px-2 text-2xs gap-1' : 'h-8 sm:h-9 px-2.5 sm:px-3 text-xs gap-1.5',
              colorCls,
              action.disabled && 'opacity-40 pointer-events-none',
            )}
          >
            {Icon && <Icon className={isSm ? 'h-3 w-3' : 'h-3.5 w-3.5'} />}
            {action.label && <span>{action.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

