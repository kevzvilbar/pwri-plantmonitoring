import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Role } from '@/lib/permissions';
import { clickEverything, operatorCanOpen } from '@/test/clickEverything';

vi.setConfig({ testTimeout: 30000 });

let mockRoles: Role[] = ['Operator'];
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ roles: mockRoles }) }));
vi.mock('@/hooks/useCustomRoles', () => ({ useMyCustomRole: () => ({ data: null }) }));
vi.mock('@/data/hooks/useCorrections', () => ({
  usePendingCount: () => ({ data: 3 }),
  useCorrectionRequestsCount: () => ({ data: 0 }),
  useEditHistory: () => ({ data: [] }),
}));
vi.mock('@/components/dashboard/ComplianceRadarCard', () => ({ ComplianceRadarCard: () => null }));
vi.mock('@/components/dashboard/ReconciliationHealthCard/useReconciliationHealthTotals', () => ({
  useReconciliationHealthTotals: () => ({
    rows: [{ plantId: 'p1', plantName: 'Plant One', result: { status: 'alert', variancePct: 12.5, totalTrainPermeate: 1000, totalProductMeter: 880 } }],
    isLoading: false, error: null, chartRange: '30d', chartFrom: null, chartTo: null, startKey: '2026-08-21', endKey: '2026-09-20',
  }),
}));
vi.mock('@/integrations/supabase/client', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'in', 'eq', 'gte', 'lte', 'order', 'limit']) chain[m] = () => chain;
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({
      data: [{ production_m3: 620000, power_cost: 8480000, chem_cost: 711000, filter_cost: 25000, daily_grid_kwh: 800000, daily_solar_kwh: 50000, rate_per_kwh: 10.6, plant_id: 'p1' }],
      count: 0, error: null,
    }).then(resolve);
  return { supabase: { from: () => chain } };
});
vi.mock('@/hooks/useCostComposition', () => ({
  useCostComposition: () => ({
    data: { powerTotal: 8480000, chemCostTotal: 711000, filterCostTotal: 25000, solarTotal: 450000, pricedChemTotal: 711000, hasChemBreakdown: true, hasFilterBreakdown: true, unpricedChemicals: [] },
    isLoading: false,
  }),
}));
vi.mock('@/hooks/useOpexBudget', () => ({
  useMonthlyOpex: () => ({ data: [{ month: '2026-09-01', budgetId: 'b-1', variancePct: 4.2 }], isLoading: false }),
  opexVarianceTone: () => 'warn',
}));

import { DataTrustAuditCard } from './DataTrustAuditCard';
import { CostEfficiencyCard } from './CostEfficiencyCard';
import { ReconciliationHealthCard } from './ReconciliationHealthCard';

const withQuery = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
);

/**
 * routes.navTargets.test.ts proves a navigation target EXISTS. It cannot prove
 * the user may OPEN it, and an Operator is bounced to "/" with an "Access
 * restricted" toast from every page outside ProtectedRoute's list. The Dashboard
 * shows these cards to Operators, so click everything as one and see where it goes.
 */
describe.each([
  {
    name: 'DataTrustAuditCard',
    ui: () => <DataTrustAuditCard plantIds={['p1']} />,
    ready: undefined,
    adminReaches: ['/compliance', '/data-corrections'],
  },
  {
    name: 'CostEfficiencyCard',
    ui: () => withQuery(<CostEfficiencyCard plantIds={['p1']} />),
    ready: () => screen.findByText(/Rollup Details/i),
    adminReaches: ['/costs?tab=rollup', '/costs?tab=power', '/costs?tab=budget'],
  },
  {
    name: 'ReconciliationHealthCard',
    ui: () => <ReconciliationHealthCard plantIds={['p1']} />,
    ready: undefined,
    adminReaches: ['/topology'],
  },
])('$name on the Dashboard', ({ ui, ready, adminReaches }) => {
  it('no click by an Operator ends on a page an Operator cannot open', async () => {
    mockRoles = ['Operator'];
    const reached = await clickEverything(ui, ready);
    expect(reached.filter((url) => !operatorCanOpen(url))).toEqual([]);
  });

  it('an Admin still reaches those pages (so the check above is not just clicking nothing)', async () => {
    mockRoles = ['Admin'];
    const reached = await clickEverything(ui, ready);
    expect(reached).toEqual(expect.arrayContaining(adminReaches));
  });
});
