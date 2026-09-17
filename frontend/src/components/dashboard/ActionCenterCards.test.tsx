import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { PendingReviewCard } from './PendingReviewCard';
import { PMDueSoonCard } from './PMDueSoonCard';

// Mock Supabase
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ count: 0, data: [] }),
    })),
  },
}));

// Mock usePlants
vi.mock('@/hooks/usePlants', () => ({
  usePlants: vi.fn(() => ({
    data: [{ id: 'plant-1', name: 'Plant 1' }],
  })),
}));

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>{ui}</BrowserRouter>
    </QueryClientProvider>,
  );
}

describe('Action Center Cards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('PendingReviewCard', () => {
    it('renders with pending-review-card testid and all-clear state by default', () => {
      renderWithProviders(<PendingReviewCard plantIds={['plant-1']} />);
      expect(screen.getByTestId('pending-review-card')).toBeDefined();
      expect(screen.getByText('Pending review')).toBeDefined();
      expect(screen.getByText('All clear')).toBeDefined();
    });
  });

  describe('PMDueSoonCard', () => {
    it('renders with pm-due-soon-card testid and up-to-date state by default', () => {
      renderWithProviders(<PMDueSoonCard plantIds={['plant-1']} />);
      expect(screen.getByTestId('pm-due-soon-card')).toBeDefined();
      expect(screen.getByText('PM due soon')).toBeDefined();
      expect(screen.getByText('Up to date')).toBeDefined();
    });
  });
});
