import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PlantHeroBanner } from './PlantHeroBanner';

afterEach(() => cleanup());

vi.mock('@/pages/Compliance', () => ({
  loadThresholds: vi.fn().mockResolvedValue({}),
}));
vi.mock('./config/ProductMeters', () => ({
  ProductMetersStat: () => null,
}));

function renderHero(lastReadingAt: Date | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PlantHeroBanner
        plant={{ id: 'plant-1', name: 'Test Plant', status: 'Active', address: '' }}
        trainCounts={{ active: 1, total: 1 }}
        lastReadingAt={lastReadingAt}
        onEdit={() => {}}
        onBack={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe('PlantHeroBanner freshness (P4-3)', () => {
  it('binds the badge to a fresh reading, not plant.status', () => {
    renderHero(new Date(Date.now() - 10 * 60_000));
    expect(screen.getByText('Live Telemetry')).toBeTruthy();
    // Wall-clock text like "10:24:33 AM PHT" must be gone; freshness labels
    // read like "Updated 10 min ago" / "No recent readings".
    expect(screen.getByText(/Updated .* ago/)).toBeTruthy();
    expect(screen.queryByText(/\d{1,2}:\d{2}:\d{2} [AP]M PHT/)).toBeNull();
  });

  it('shows stale (not Live) for an old reading on an Active plant', () => {
    renderHero(new Date(Date.now() - 6 * 60 * 60_000));
    expect(screen.getByText('Stale Data')).toBeTruthy();
    expect(screen.queryByText('Live Telemetry')).toBeNull();
  });

  it('shows unknown when there are no readings', () => {
    renderHero(null);
    // Unknown prints the tone label only — there is no age to add, so the
    // string appears exactly once.
    expect(screen.getByText('No recent readings')).toBeTruthy();
    expect(screen.queryByText('Live Telemetry')).toBeNull();
  });
});
