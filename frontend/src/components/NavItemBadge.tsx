import type { NavItem } from '@/navConfig';
import { useAlertBadge } from '@/hooks/useAlertBadge';
import { cn } from '@/lib/utils';

interface NavItemBadgeProps {
  kind: NonNullable<NavItem['badge']>;
  /** `dot`: no number, for the collapsed sidebar where there is no room. */
  variant?: 'count' | 'dot';
  className?: string;
}

/** Live indicator for a nav item. Subscribes to its own data, so the parent
 *  nav does not re-render when the count changes. */
export function NavItemBadge({ kind, variant = 'count', className }: NavItemBadgeProps) {
  return kind === 'alerts' ? <AlertsBadge variant={variant} className={className} /> : null;
}

function AlertsBadge({ variant, className }: Pick<NavItemBadgeProps, 'variant' | 'className'>) {
  const { count, hasCritical } = useAlertBadge();
  if (count === 0) return null;

  const tone = hasCritical ? 'bg-danger' : 'bg-warn';
  const label = `${count} unacknowledged ${count === 1 ? 'alert' : 'alerts'}`;

  if (variant === 'dot') {
    return <span role="img" aria-label={label} className={cn('h-2 w-2 rounded-full ring-2 ring-sidebar', tone, className)} />;
  }

  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        'min-w-[17px] h-[17px] px-[3px] flex items-center justify-center rounded-full',
        'text-3xs font-mono-num font-bold text-white leading-none',
        tone,
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
