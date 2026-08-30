import React, { useState, useRef, useCallback } from 'react';
import { Button, ButtonProps } from '@/components/ui/button';
import { Loader2, Check, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AsyncButtonProps extends Omit<ButtonProps, 'onClick'> {
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => Promise<any> | void;
  successDuration?: number; // duration to show success checkmark in ms (default 1500)
  loadingText?: string;
}

export const AsyncButton = React.forwardRef<HTMLButtonElement, AsyncButtonProps>(
  (
    {
      children,
      onClick,
      disabled,
      className,
      successDuration = 1500,
      loadingText,
      ...props
    },
    ref,
  ) => {
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const isBusy = status === 'loading';
    const isSuccess = status === 'success';
    const isError = status === 'error';
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    const handleClick = useCallback(
      async (e: React.MouseEvent<HTMLButtonElement>) => {
        if (isBusy || disabled || !onClick) return;

        // Disable on first tap to prevent double-submit
        setStatus('loading');

        try {
          await onClick(e);
          // Resolve to explicit terminal success state
          setStatus('success');
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          timeoutRef.current = setTimeout(() => {
            setStatus('idle');
          }, successDuration);
        } catch (err) {
          // Terminal error state before re-enabling
          setStatus('error');
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          timeoutRef.current = setTimeout(() => {
            setStatus('idle');
          }, successDuration);
        }
      },
      [disabled, isBusy, onClick, successDuration],
    );

    return (
      <Button
        ref={ref}
        disabled={disabled || isBusy}
        onClick={handleClick}
        className={cn(
          'relative transition-all duration-200 min-h-[40px] sm:min-h-0',
          isSuccess && 'bg-accent text-accent-foreground hover:bg-accent/90',
          isError && 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
          className,
        )}
        aria-busy={isBusy}
        aria-live="polite"
        {...props}
      >
        {isBusy ? (
          <span className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            <span>{loadingText || children}</span>
          </span>
        ) : isSuccess ? (
          <span className="flex items-center gap-1.5 animate-scale-in">
            <Check className="h-4 w-4 stroke-[2.5]" />
            <span>Saved</span>
          </span>
        ) : isError ? (
          <span className="flex items-center gap-1.5 animate-shake">
            <AlertCircle className="h-4 w-4 stroke-[2.5]" />
            <span>Failed</span>
          </span>
        ) : (
          children
        )}
      </Button>
    );
  },
);

AsyncButton.displayName = 'AsyncButton';

