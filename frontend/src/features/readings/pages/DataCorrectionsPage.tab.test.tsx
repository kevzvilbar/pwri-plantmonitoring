import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/hooks/usePermission', () => ({
  useCan: () => () => false,
  usePermission: () => false,
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ isAdmin: true, isManager: true, isDataAnalyst: false }),
}));
vi.mock('@/hooks/usePlants', () => ({ usePlants: () => ({ data: [] }) }));
vi.mock('@/hooks/useCustomRoles', () => ({ useMyCustomRole: () => ({ data: null }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: () => ({ select: () => ({ count: 'exact', head: true }) }) },
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: 0 }) }));
vi.mock('@/features/readings/hooks/useCorrections', () => ({
  usePendingCount: () => ({ data: 0 }),
  useCorrectionRequestsCount: () => ({ data: 0 }),
  useInboxCount: () => ({ data: 0 }),
}));
// The tab bodies run their own query chains — not under test here.
vi.mock('../dataCorrections/tabs/PendingReviewTab', () => ({ PendingReviewTab: () => null }));
vi.mock('../dataCorrections/tabs/CorrectionInboxTab', () => ({ CorrectionInboxTab: () => null }));
vi.mock('../dataCorrections/tabs/EditHistoryTab', () => ({ EditHistoryTab: () => null }));
vi.mock('../dataCorrections/tabs/OperatorStatsTab', () => ({ OperatorStatsTab: () => null }));

import DataCorrectionsPage from '@/features/readings/pages/DataCorrectionsPage';

/** P2-4: ?tab= drives the active tab; unknown values fall back to pending. */
describe('DataCorrectionsPage ?tab= (P2-4)', () => {
  const renderAt = (entry: string) =>
    render(
      <MemoryRouter initialEntries={[entry]}>
        <DataCorrectionsPage />
      </MemoryRouter>,
    );

  it('selects the history tab for ?tab=history', () => {
    const { unmount } = renderAt('/data-corrections?tab=history');
    expect(screen.getByRole('tab', { name: /history/i })).toHaveAttribute('data-state', 'active');
    unmount();
  });

  it('falls back to pending for an unknown tab', () => {
    const { unmount } = renderAt('/data-corrections?tab=bogus');
    expect(screen.getByRole('tab', { name: /pending reviews/i })).toHaveAttribute('data-state', 'active');
    unmount();
  });
});
