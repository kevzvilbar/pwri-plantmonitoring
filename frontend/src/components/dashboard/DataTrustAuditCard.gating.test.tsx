import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

let allowed = false;
vi.mock('@/hooks/usePermission', () => ({
  useCan: () => () => false,
  usePermission: () => allowed,
}));
vi.mock('@/components/StatusPill', () => ({ StatusPill: ({ children }: any) => <span>{children}</span> }));
vi.mock('@/data/hooks/useCorrections', () => ({
  usePendingCount: () => ({ data: 0 }),
  useCorrectionRequestsCount: () => ({ data: 0 }),
  useEditHistory: () => ({ data: [] }),
}));
vi.mock('@/components/dashboard/ReconciliationHealthCard/useReconciliationHealthTotals', () => ({
  useReconciliationHealthTotals: () => ({ rows: [] }),
}));
vi.mock('@/components/dashboard/ComplianceRadarCard', () => ({
  ComplianceRadarCard: () => null,
}));
vi.mock('@/store/appStore', () => ({
  useAppStore: (sel: any) => sel({ chartRange: '30d', chartFrom: null, chartTo: null }),
}));

import { DataTrustAuditCard } from '@/components/dashboard/DataTrustAuditCard';

/** P2-2: without data_corrections view the card is read-only — its buttons
 *  are disabled so no click can end in an "Access restricted" toast. */
describe('DataTrustAuditCard read-only gating (P2-2)', () => {
  const renderCard = () =>
    render(
      <MemoryRouter>
        <DataTrustAuditCard plantIds={[]} />
      </MemoryRouter>,
    );

  it('disables Review Queue + Full log when the user cannot review', () => {
    allowed = false;
    renderCard();
    expect(screen.getByRole('button', { name: /review queue/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /full log/i })).toBeDisabled();
  });

  it('enables them when the user can review', () => {
    allowed = true;
    renderCard();
    expect(screen.getByRole('button', { name: /review queue/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /full log/i })).toBeEnabled();
  });
});
