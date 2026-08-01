import { cn } from '@/lib/utils';
import { AlertTriangle, CloudOff, Inbox, Loader2, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ReactNode } from 'react';

type Props = {
  loading?: boolean;
  error?: unknown;
  isEmpty?: boolean;
  onRetry?: () => void;
  /**
   * The feature is known to be unusable right now — no backend deployed,
   * or this action needs service-role/server-side access that can never
   * run in the browser. Distinct from `error`: this isn't a surprise
   * failure, so it renders calmer, informational styling (info/blue)
   * instead of the red "something broke" treatment used for `error`.
   * Only pass `onRetry` alongside this if retrying could plausibly help
   * (e.g. "backend might be back up now") — omit it for permanent cases
   * like a privileged write that structurally can't run client-side.
   */
  unavailable?: boolean;
  unavailableTitle?: string;
  unavailableDescription?: string;
  /** When to show built-in message; pass children as the content otherwise */
  children?: ReactNode;
  /** Empty-state label */
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
};

/**
 * A single component that renders unavailable / loading / error / empty /
 * content states consistently across the app. Use like:
 *   <DataState loading={isLoading} error={error} isEmpty={!data?.length}>
 *     {children}
 *   </DataState>
 *
 * Or, for a feature that structurally can't work right now (no backend
 * deployed, needs privileged server-side access):
 *   <DataState unavailable unavailableTitle="AI service unavailable"
 *     unavailableDescription="Chat needs the backend, which isn't reachable.">
 *     ...
 *   </DataState>
 */
export function DataState({
  loading, error, isEmpty, onRetry,
  unavailable, unavailableTitle = 'Unavailable right now', unavailableDescription,
  children, emptyTitle = 'Nothing here yet', emptyDescription,
  className,
}: Props) {
  if (unavailable) {
    return (
      <div className={cn('rounded-md border border-info bg-info-soft/50 p-4 text-sm', className)}>
        <div className="flex items-start gap-2">
          <CloudOff className="h-4 w-4 text-info mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-medium text-foreground">{unavailableTitle}</div>
            {unavailableDescription && (
              <div className="text-xs text-muted-foreground mt-0.5">{unavailableDescription}</div>
            )}
          </div>
          {onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RotateCw className="h-3 w-3 mr-1" /> Try again
            </Button>
          )}
        </div>
      </div>
    );
  }
  if (loading) {
    return (
      <div className={cn('flex items-center justify-center py-10 text-muted-foreground', className)}>
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
      </div>
    );
  }
  if (error) {
    const msg = (error instanceof Error ? error.message : String(error)) || 'Failed to load';
    return (
      <div className={cn('rounded-md border border-danger bg-danger-soft/50 p-4 text-sm', className)}>
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-danger mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="font-medium text-danger">Could not load data</div>
            <div className="text-xs text-danger/80 mt-0.5 break-words">{msg}</div>
          </div>
          {onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
          )}
        </div>
      </div>
    );
  }
  if (isEmpty) {
    return (
      <div className={cn('rounded-md border border-dashed py-10 text-center text-muted-foreground', className)}>
        <Inbox className="h-6 w-6 mx-auto opacity-60" />
        <div className="mt-2 text-sm font-medium text-foreground">{emptyTitle}</div>
        {emptyDescription && <div className="text-xs mt-1">{emptyDescription}</div>}
      </div>
    );
  }
  return <>{children}</>;
}
