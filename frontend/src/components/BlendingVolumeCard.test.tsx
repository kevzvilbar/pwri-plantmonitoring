import { describe, it, expect, beforeAll } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { BlendingVolumeCard } from './BlendingVolumeCard';

beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

describe('BlendingVolumeCard', () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  it('renders Pattern A ghost baseline with contextual pill when zero data', () => {
    const { getByTestId, getByText } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <BlendingVolumeCard plantIds={['plant-1']} />
        </MemoryRouter>
      </QueryClientProvider>
    );

    // KPI tiles are present with zero formatting
    expect(getByTestId('blending-today')).toBeDefined();
    expect(getByTestId('blending-total')).toBeDefined();
    expect(getByTestId('blending-avg')).toBeDefined();

    // Pattern A empty state pill and CTA button are rendered
    expect(getByText('Zero Blending Injections Recorded')).toBeDefined();
    expect(getByText('Log blending entry →')).toBeDefined();

    // Data Summary action button is present
    expect(getByTestId('blending-data-summary-button')).toBeDefined();
    expect(getByText('Data Summary')).toBeDefined();
  });

  it('opens Blending Data Summary modal when Data Summary button is clicked', async () => {
    const { getByTestId, findByTestId } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <BlendingVolumeCard plantIds={['plant-1']} />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const summaryBtn = getByTestId('blending-data-summary-button');
    summaryBtn.click();

    const popup = await findByTestId('dsm-popup-blending');
    expect(popup).toBeDefined();
  });
});



