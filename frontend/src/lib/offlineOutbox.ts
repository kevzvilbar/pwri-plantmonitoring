import { useMutationState } from '@tanstack/react-query';

/**
 * Custom hook to retrieve the current count of paused/queued mutations
 * waiting in the offline outbox to be replayed upon reconnection.
 */
export function usePendingOutboxCount(): number {
  const pendingMutations = useMutationState({
    filters: {
      predicate: (mutation) => mutation.state.isPaused || mutation.state.status === 'pending',
    },
    select: (mutation) => mutation.state.isPaused,
  });

  return pendingMutations.filter(Boolean).length;
}
