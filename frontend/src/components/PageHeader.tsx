import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  /** Descriptive line under the title. Always rendered at text-sm — the one
   *  page-header decision that used to vary (text-xs on some pages, text-sm
   *  on others) for what is functionally the same element. */
  subtitle?: ReactNode;
  /** Optional leading icon tile, e.g. AI Assistant's gradient sparkle icon —
   *  rendered as its own block to the left of the title+subtitle. */
  icon?: ReactNode;
  /** Optional small icon rendered inline inside the <h1> itself, before the
   *  title text (e.g. Compliance's ShieldCheck, Data Analysis's FlaskConical).
   *  Use this instead of `icon` when the icon should sit on the title's own
   *  baseline rather than as a separate tile. */
  titleIcon?: ReactNode;
  /** Optional right-aligned controls (buttons, a menu) next to the title. */
  actions?: ReactNode;
  className?: string;
}

/**
 * Standard page title block. Every top-level page should render this once,
 * as the first child of its `space-y-4 animate-fade-in` root wrapper —
 * see any page in pages/ for the surrounding convention.
 */
export function PageHeader({ title, subtitle, icon, titleIcon, actions, className }: PageHeaderProps) {
  const titleBlock = (
    <div>
      <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
        {titleIcon}
        {title}
      </h1>
      {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
    </div>
  );

  return (
    <div className={cn('flex items-start justify-between gap-3 flex-wrap', className)}>
      {icon ? (
        <div className="flex items-center gap-2">
          {icon}
          {titleBlock}
        </div>
      ) : titleBlock}
      {actions}
    </div>
  );
}
