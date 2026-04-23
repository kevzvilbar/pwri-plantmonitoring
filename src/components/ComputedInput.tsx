import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Read-only input for auto-calculated values.
 * Uses a distinct background + border so users can tell at a glance
 * which fields they need to type into vs. which are derived.
 */
export const ComputedInput = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, value, ...props }, ref) => (
    <input
      ref={ref}
      readOnly
      tabIndex={-1}
      value={value ?? ''}
      className={cn(
        'flex h-10 w-full rounded-md border border-dashed border-primary/40 bg-primary/10 px-3 py-2 text-sm font-mono-num font-semibold text-primary cursor-default focus:outline-none',
        className,
      )}
      {...props}
    />
  ),
);
ComputedInput.displayName = 'ComputedInput';
