import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/hooks/usePermission', () => ({ useCan: () => () => false, usePermission: () => false }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: false, isManager: false, isDataAnalyst: false }) }));
vi.mock('@/hooks/usePlants', () => ({ usePlants: () => ({ data: [] }) }));
vi.mock('@/hooks/useCustomRoles', () => ({ useMyCustomRole: () => ({ data: null }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({}) }) }) } }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: 0 }), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@/features/wells', () => ({ WellReadingForm: ({ highlightId }: { highlightId?: string | null }) => <div data-testid="well-form">{highlightId}</div> }));
vi.mock('../components/locators/LocatorSection', () => ({ LocatorReadingForm: ({ highlightId }: { highlightId?: string | null }) => <div data-testid="locator-form">{highlightId}</div> }));
vi.mock('../components/blending/BlendingSection', () => ({ BlendingForm: () => <div data-testid="blending-form" /> }));
vi.mock('../components/product/ProductSection', () => ({ ProductForm: ({ highlightId }: { highlightId?: string | null }) => <div data-testid="product-form">{highlightId}</div> }));
vi.mock('../components/power/PowerSection', () => ({ PowerForm: () => <div data-testid="power-form" /> }));
vi.mock('@/lib/shifts', () => ({ getCurrentShift: () => ({ name: 'Shift', timeRange: '' }) }));

import Operations from './OperationsPage';
import { readingsPath } from '@/shared/assetLinks';

const renderAt = (url: string) => render(<MemoryRouter initialEntries={[url]}><Operations /></MemoryRouter>);

describe('OperationsPage ?tab= (P5-4)', () => {
  it('opens Locators by default and for an unknown tab', () => {
    const { unmount } = renderAt('/operations');
    expect(screen.getByTestId('locator-form')).toBeInTheDocument();
    unmount();
    renderAt('/operations?tab=bogus');
    expect(screen.getByTestId('locator-form')).toBeInTheDocument();
  });

  it.each([
    ['well', 'well-form'], ['product', 'product-form'], ['blending', 'blending-form'], ['power', 'power-form'],
  ])('opens the %s tab', (tab, testId) => {
    renderAt(`/operations?tab=${tab}`);
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });

  it.each([
    ['wells', 'well-form'], ['production', 'product-form'], ['bypass', 'blending-form'], ['locators', 'locator-form'],
  ])('older link ?tab=%s still lands on the right tab', (alias, testId) => {
    renderAt(`/operations?tab=${alias}`);
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });

  it('is case-insensitive, and still passes ?highlight= to the form of the open tab', () => {
    renderAt('/operations?tab=WELL&highlight=abc');
    expect(screen.getByTestId('well-form')).toHaveTextContent('abc');
  });
});

/**
 * P5-7: the "Daily Readings" links on well, locator and product-meter cards are
 * built by readingsPath(). Run what it builds through the real page: it must
 * open that asset's tab and hand the row id to that tab's form.
 */
describe('OperationsPage understands readingsPath() links (P5-7)', () => {
  it.each(['well', 'locator', 'product'] as const)('a %s link opens its tab with that row highlighted', (kind) => {
    renderAt(readingsPath(kind, 'row-7'));
    expect(screen.getByTestId(`${kind}-form`)).toHaveTextContent('row-7');
  });
});
