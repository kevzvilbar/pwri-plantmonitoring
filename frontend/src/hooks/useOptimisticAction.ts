import { useState, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';

interface UseOptimisticActionOptions<T> {
  initialState: T;
  onMutate: (nextState: T) => Promise<void>;
  successMessage?: string;
  errorMessage?: string;
  resetAfterMs?: number; // e.g. 2000ms for "Copied!" states
}

export function useOptimisticAction<T>({
  initialState,
  onMutate,
  successMessage,
  errorMessage = 'Action failed. Changes reverted.',
  resetAfterMs,
}: UseOptimisticActionOptions<T>) {
  const [state, setState] = useState<T>(initialState);
  const [isPending, setIsPending] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Sync state if initialState changes externally
  useEffect(() => {
    setState(initialState);
  }, [initialState]);

  const execute = useCallback(
    async (nextState: T) => {
      const prevState = state;
      // Optimistic update: Apply immediately with 0 delay
      setState(nextState);
      setIsPending(true);
      setStatus('idle');

      if (timeoutRef.current) clearTimeout(timeoutRef.current);

      try {
        await onMutate(nextState);
        setStatus('success');
        if (successMessage) {
          toast.success(successMessage);
        }

        if (resetAfterMs) {
          timeoutRef.current = setTimeout(() => {
            setStatus('idle');
            setState(initialState);
          }, resetAfterMs);
        }
      } catch (err: any) {
        // Action reversal on backend failure
        setState(prevState);
        setStatus('error');
        toast.error(errorMessage || err?.message || 'Action failed.');
      } finally {
        setIsPending(false);
      }
    },
    [state, onMutate, successMessage, resetAfterMs, initialState, errorMessage],
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return {
    state,
    execute,
    isPending,
    status,
    isSuccess: status === 'success',
    isError: status === 'error',
  };
}

