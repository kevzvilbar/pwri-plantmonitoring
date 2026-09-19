// Shared meter-replacement detail lookup for every history surface (Option A).
// Each meter family logs swaps in its own table, linked back to the history
// row via `reading_id`. Exact-only lookup: legacy flag-only rows resolve to
// "no linked record" rather than a neighbour's details.
import { useQuery } from '@tanstack/react-query';
import { fetchReplacementRecords } from './replacementLookup';
import type { NormalizedReplacement, ReplacementTarget } from './replacementTypes';

export function useMeterReplacementDetail(target: ReplacementTarget | null) {
  const query = useQuery({
    queryKey: [
      'meter-replacement-detail',
      target?.kind, target?.readingId, target?.meterIndex ?? null, target?.meterType ?? null,
    ],
    queryFn: () => fetchReplacementRecords(target!),
    enabled: !!target && !!target.readingId && target.kind !== 'blending',
    staleTime: 30_000,
  });
  return {
    records: (query.data ?? []) as NormalizedReplacement[],
    isLoading: query.isLoading,
  };
}
