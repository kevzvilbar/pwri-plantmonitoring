import { useMutationState } from '@tanstack/react-query';

export interface OutboxEntry {
  mutationId: number;
  mutationKey: string;
  isPaused: boolean;
  status: string;
  submittedAt: number;
  variables: unknown;
}

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

/**
 * Custom hook to retrieve detailed info about queued offline mutations
 * for display in the Outbox inspection modal.
 */
export function usePendingOutboxItems(): OutboxEntry[] {
  return useMutationState({
    filters: {
      predicate: (mutation) => mutation.state.isPaused || mutation.state.status === 'pending',
    },
    select: (mutation) => ({
      mutationId: mutation.mutationId,
      mutationKey: Array.isArray(mutation.options.mutationKey)
        ? mutation.options.mutationKey.join(' · ')
        : String(mutation.options.mutationKey ?? 'Mutation'),
      isPaused: mutation.state.isPaused,
      status: mutation.state.status,
      submittedAt: mutation.state.submittedAt,
      variables: mutation.state.variables,
    }),
  });
}
