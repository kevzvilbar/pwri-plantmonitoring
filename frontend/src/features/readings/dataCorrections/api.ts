/**
 * pages/dataCorrections/api.ts
 *
 * Backward-compatible re-exports from the centralized data layer
 * (@/data/queries/corrections and @/data/mutations/corrections).
 */
export {
  PENDING_FETCH_LIMIT_PER_TABLE,
  guessMeterMax,
} from './types';

export {
  fetchPending,
  fetchCorrectionRequests,
} from '@/data/queries/corrections';

export {
  supersedeOtherCorrectionRequests,
} from '@/data/mutations/corrections';