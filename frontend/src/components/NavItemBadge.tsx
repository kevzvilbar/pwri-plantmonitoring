import type { NavItem } from '@/navConfig';
import { useAlertBadge } from '@/hooks/useAlertBadge';
import { usePendingApprovalsCount } from '@/hooks/usePendingApprovalsCount';
import { useCan } from '@/hooks/usePermission';
import { cn } from '@/lib/utils';

interface NavItemBadgeProps {
  kind: NonNullable<NavItem['badge']>;
  /** `dot`: no number, for the collapsed sidebar where there is no room. */
  variant?: 'count' | 'dot';
  className?: string;
}

type BadgeLook = Pick<NavItemBadgeProps, 'variant' | 'className'>;

/** Live indicator for a nav item. Subscribes to its own data, so the parent
 *  nav does not re-render when the count changes. */
export function NavItemBadge({ kind, variant = 'count', className }: NavItemBadgeProps) {
  if (kind === 'alerts') return <AlertsBadge variant={variant} className={className} />;
  if (kind === 'approvals') return <ApprovalsBadge variant={variant} className={className} />;
  return null;
}

/** The pill (or, in the collapsed sidebar, the dot) that every badge draws. */
function CountPill({
  count, tone, label, variant, className,
}: BadgeLook & { count: number; tone: string; label: string }) {
  if (variant === 'dot') {
    return <span role="img" aria-label={label} className={cn('h-2 w-2 rounded-full ring-2 ring-sidebar', tone, className)} />;
  }

  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        'min-w-[17px] h-[17px] px-[3px] flex items-center justify-center rounded-full',
        // A count pill is 17px tall; text-xs (12px) leaves no vertical air in
        // it. text-2xs (10px) is the count-pill size the rest of the app uses.
        'text-2xs font-mono-num font-bold text-white leading-none',
        tone,
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

function AlertsBadge({ variant, className }: BadgeLook) {
  const { count, hasCritical } = useAlertBadge();
  if (count === 0) return null;

  return (
    <CountPill
      count={count}
      tone={hasCritical ? 'bg-danger' : 'bg-warn'}
      label={`${count} unacknowledged ${count === 1 ? 'alert' : 'alerts'}`}
      variant={variant}
      className={className}
    />
  );
}

/** Only an Admin can approve accounts (approve_user checks is_admin on the
 *  server), so everyone else gets no badge and runs no query. */
function ApprovalsBadge(look: BadgeLook) {
  return useCan()('admin_users') ? <ApprovalsCount {...look} /> : null;
}

function ApprovalsCount({ variant, className }: BadgeLook) {
  const count = usePendingApprovalsCount();
  if (count === 0) return null;

  return (
    <CountPill
      count={count}
      tone="bg-warn"
      label={`${count} ${count === 1 ? 'account' : 'accounts'} waiting for approval`}
      variant={variant}
      className={className}
    />
  );
}
