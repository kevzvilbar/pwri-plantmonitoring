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
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({}) }) }) },
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: { total: 3, wells: 1, locators: 1, productMeters: 0, corrections: 1 } }),
}));

import { PendingReviewCard } from '@/components/dashboard/PendingReviewCard';

/** P2-2: without data_corrections view the card is read-only — footer buttons
 *  disabled and row clicks navigate nowhere. */
describe('PendingReviewCard read-only gating (P2-2)', () => {
  const renderCard = () =>
    render(
      <MemoryRouter>
        <PendingReviewCard plantIds={[]} />
      </MemoryRouter>,
    );

  it('disables the footer CTA when the user cannot review', () => {
    allowed = false;
    mockNavigate.mockClear();
    renderCard();
    expect(screen.getByRole('button', { name: /review flagged readings/i })).toBeDisabled();
  });

  it('enables it and navigates when the user can review', () => {
    allowed = true;
    mockNavigate.mockClear();
    renderCard();
    const cta = screen.getByRole('button', { name: /review flagged readings/i });
    expect(cta).toBeEnabled();
    cta.click();
    expect(mockNavigate).toHaveBeenCalledWith('/data-corrections');
  });
});
