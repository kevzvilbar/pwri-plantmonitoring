import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { DataTrustAuditCard } from './DataTrustAuditCard';

// Mock Supabase
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
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

// Mock useCorrections
vi.mock('@/data/hooks/useCorrections', () => ({
  usePendingCount: vi.fn(() => ({ data: 0 })),
  useCorrectionRequestsCount: vi.fn(() => ({ data: 0 })),
  useEditHistory: vi.fn(() => ({ data: [] })),
}));

// Mock ComplianceRadarCard
vi.mock('@/components/dashboard/ComplianceRadarCard', () => ({
  ComplianceRadarCard: () => <div data-testid="mock-compliance-radar">Compliance Radar Card</div>,
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

describe('DataTrustAuditCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders reporting confidence header and audit gates by default', () => {
    renderWithProviders(<DataTrustAuditCard plantIds={['plant-1']} />);
    expect(screen.getByTestId('data-trust-audit-card')).toBeDefined();
    expect(screen.getByText('Reporting Confidence & Audit Gates')).toBeDefined();
    expect(screen.getByText('Telemetry Capture Gate')).toBeDefined();
    expect(screen.getByText('Mass Balance Gate')).toBeDefined();
    expect(screen.getByText('Data Integrity Gate')).toBeDefined();
    expect(screen.getByText('Quality Standards Gate')).toBeDefined();
  });

  it('allows switching to Compliance Radar view', () => {
    renderWithProviders(<DataTrustAuditCard plantIds={['plant-1']} />);
    const radarBtn = screen.getByRole('button', { name: /compliance radar/i });
    fireEvent.click(radarBtn);
    expect(screen.getByText('Compliance Radar')).toBeDefined();
  });
});
