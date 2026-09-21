import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useDashboardAlerts, type ROAlertReading } from './useDashboardAlerts';
import type { PlantAlert } from '@/store/alertStore';

// Mock Supabase
function builder() {
  const b: Record<string, unknown> = {};
  const chain = () => (..._args: unknown[]) => b;
  for (const m of ['select', 'gte', 'lt', 'eq', 'in', 'order', 'limit']) b[m] = chain();
  b.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: [], error: null });
  return b;
}
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => builder() } }));
vi.mock('@/hooks/useReadingGaps', () => ({ useReadingGaps: () => ({ wellGaps: [], locatorGaps: [] }), gapDescription: () => '' }));
vi.mock('@/hooks/useTrainHourlyGaps', () => ({ useTrainHourlyGaps: () => [] }));
vi.mock('@/hooks/useTrainAutoOffline', () => ({ useTrainAutoOffline: () => [] }));

describe('useDashboardAlerts TDS compliance threshold & condition clearance (Bug 3)', () => {
  let addAlertsMock: ReturnType<typeof vi.fn>;
  let clearConditionAlertsMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    addAlertsMock = vi.fn();
    clearConditionAlertsMock = vi.fn();
  });

  function setup(
    latestRO: ROAlertReading[],
    thresholdsByPlant?: Record<string, any>,
  ) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    return renderHook(
      () =>
        useDashboardAlerts({
          selectedPlantId: 'plant-1',
          addAlerts: addAlertsMock,
          clearConditionAlerts: clearConditionAlertsMock,
          plants: [{ id: 'plant-1', name: 'Plant One' }],
          plantIds: ['plant-1'],
          latestRO,
          roAvgFlowByTrain: new Map(),
          recentPretreatment: [],
          latestPumpReadings: [],
          powerAvgByPlant: new Map(),
          prevPowerRowByPlant: new Map(),
          todayPower: [],
          powerIsStale: false,
          nrw: null,
          nrwBreached: false,
          qualityTrainMeta2: new Map(),
          thresholdsByPlant,
        } as unknown as Parameters<typeof useDashboardAlerts>[0]),
      { wrapper },
    );
  }

  it('raises critical alert when TDS exceeds compliance threshold (default 500 ppm)', () => {
    const reading: ROAlertReading = {
      train_id: 'train-1',
      train_number: 1,
      plant_id: 'plant-1',
      permeate_tds: 520, // > 500 ppm
    };

    setup([reading]);

    expect(addAlertsMock).toHaveBeenCalled();
    const alerts: PlantAlert[] = addAlertsMock.mock.calls[0][0];
    const tdsAlert = alerts.find((a) => a.id === 'tds-train-1-1');
    expect(tdsAlert).toBeDefined();
    expect(tdsAlert?.severity).toBe('critical');
    expect(tdsAlert?.title).toContain('520 ppm');

    // Warning and legacy IDs are cleared
    expect(clearConditionAlertsMock).toHaveBeenCalledWith(
      expect.arrayContaining(['tds-warn-train-1-1', 'high-tds-train-1']),
    );
  });

  it('raises warning alert when TDS approaches compliance threshold (e.g. >= 90% of max)', () => {
    const reading: ROAlertReading = {
      train_id: 'train-1',
      train_number: 1,
      plant_id: 'plant-1',
      permeate_tds: 460, // 460 >= 450 (90% of 500)
    };

    setup([reading]);

    expect(addAlertsMock).toHaveBeenCalled();
    const alerts: PlantAlert[] = addAlertsMock.mock.calls[0][0];
    const warnAlert = alerts.find((a) => a.id === 'tds-warn-train-1-1');
    expect(warnAlert).toBeDefined();
    expect(warnAlert?.severity).toBe('warning');

    // Critical and legacy IDs are cleared
    expect(clearConditionAlertsMock).toHaveBeenCalledWith(
      expect.arrayContaining(['tds-train-1-1', 'high-tds-train-1']),
    );
  });

  it('clears all TDS condition alerts when TDS is within normal limits', () => {
    const reading: ROAlertReading = {
      train_id: 'train-1',
      train_number: 1,
      plant_id: 'plant-1',
      permeate_tds: 150, // normal
    };

    setup([reading]);

    // Critical, warning, and legacy IDs should be sent to clearConditionAlerts
    expect(clearConditionAlertsMock).toHaveBeenCalledWith(
      expect.arrayContaining(['tds-train-1-1', 'tds-warn-train-1-1', 'high-tds-train-1']),
    );
  });

  it('honours plant-specific configured compliance threshold', () => {
    // Custom threshold for plant-1: permeate_tds_max = 650 ppm
    const customThresholds = {
      'plant-1': {
        permeate_tds_max: 650,
      },
    };

    const reading: ROAlertReading = {
      train_id: 'train-1',
      train_number: 1,
      plant_id: 'plant-1',
      permeate_tds: 520, // 520 < 650 * 0.9 = 585 -> normal under 650 limit!
    };

    setup([reading], customThresholds);

    // Should clear rather than raise critical
    expect(clearConditionAlertsMock).toHaveBeenCalledWith(
      expect.arrayContaining(['tds-train-1-1', 'tds-warn-train-1-1', 'high-tds-train-1']),
    );
  });
});
