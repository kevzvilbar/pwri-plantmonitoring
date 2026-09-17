import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { CostEfficiencyCard } from './CostEfficiencyCard';

// Mock Supabase
vi.mock('@/integrations/supabase/client', () => {
  const createChain = () => {
    const chain: any = {
      select: vi.fn(() => chain),
      in: vi.fn(() => chain),
      gte: vi.fn(() => chain),
      lte: vi.fn(() => chain),
      order: vi.fn(() => chain),
      then: (resolve: any) =>
        Promise.resolve({
          data: [
            {
              production_m3: 620000,
              power_cost: 8480000,
              chem_cost: 711000,
              filter_cost: 25000,
              daily_grid_kwh: 800000,
              daily_solar_kwh: 50000,
              rate_per_kwh: 10.6,
              plant_id: 'plant-1',
            },
          ],
          error: null,
        }).then(resolve),
    };
    return chain;
  };

  return {
    supabase: {
      from: vi.fn(() => createChain()),
    },
  };
});

// Mock useCostComposition
vi.mock('@/hooks/useCostComposition', () => ({
  useCostComposition: vi.fn(() => ({
    data: {
      powerTotal: 8480000,
      chemCostTotal: 711000,
      filterCostTotal: 25000,
      solarTotal: 450000,
      pricedChemTotal: 711000,
      hasChemBreakdown: true,
      hasFilterBreakdown: true,
      unpricedChemicals: [],
    },
    isLoading: false,
  })),
}));

// Mock useOpexBudget
vi.mock('@/hooks/useOpexBudget', () => ({
  useMonthlyOpex: vi.fn(() => ({
    data: [
      {
        month: '2026-09-01',
        budgetId: 'b-1',
        variancePct: 4.2,
      },
    ],
    isLoading: false,
  })),
  opexVarianceTone: vi.fn(() => 'warn'),
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

describe('CostEfficiencyCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Unit Economics & OPEX Efficiency card with core metrics', async () => {
    renderWithProviders(<CostEfficiencyCard plantIds={['plant-1']} />);

    expect(await screen.findByText(/Unit Economics & OPEX Efficiency/i)).toBeInTheDocument();
    expect(await screen.findByText(/Specific Production Cost/i)).toBeInTheDocument();
    expect(await screen.findByText(/Power & Energy Tariff/i)).toBeInTheDocument();
    expect(await screen.findByText(/Solar Value & Savings/i)).toBeInTheDocument();
    expect(await screen.findByText(/Chemical Dosing Intensity/i)).toBeInTheDocument();
    expect(await screen.findByText(/Filter Consumables/i)).toBeInTheDocument();
    expect(await screen.findByText(/Rollup Details/i)).toBeInTheDocument();
  });
});
