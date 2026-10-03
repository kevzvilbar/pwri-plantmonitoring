import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ShiftRoundProgress } from './ShiftRoundProgress';

// Mock Supabase client
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
    })),
  },
}));

vi.mock('@/lib/shifts', () => ({
  getCurrentShift: vi.fn(() => ({
    code: 'A',
    name: 'Shift A (Morning)',
    label: 'Shift A',
    timeRange: '07:00 – 15:00',
    startHour: 7,
    endHour: 15,
    tone: 'accent',
  })),
}));

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  );
}

describe('ShiftRoundProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders prompt to select a plant when plantId is null', () => {
    renderWithClient(
      <ShiftRoundProgress
        plantId={null}
        activeTab="locator"
        onSelectTab={vi.fn()}
      />
    );
    expect(screen.getByText(/Select a plant to view today’s shift round checklist/i)).toBeInTheDocument();
  });

  it('renders section buttons and handles tab change when plant is selected', () => {
    const handleSelect = vi.fn();
    renderWithClient(
      <ShiftRoundProgress
        plantId="plant-123"
        activeTab="locator"
        onSelectTab={handleSelect}
      />
    );

    expect(screen.getByText(/Shift Round Walk-List/i)).toBeInTheDocument();
    expect(screen.getByText(/Shift A \(Morning\)/i)).toBeInTheDocument();

    const wellButton = screen.getByRole('button', { name: /Wells/i });
    expect(wellButton).toBeInTheDocument();

    fireEvent.click(wellButton);
    expect(handleSelect).toHaveBeenCalledWith('well');
  });
});
