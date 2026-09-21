import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchPlantFreshness } from './usePlantFreshness';
import { supabase } from '@/integrations/supabase/client';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

describe('usePlantFreshness (P4-3 & P4-6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty map when plantIds is empty', async () => {
    const res = await fetchPlantFreshness([]);
    expect(res).toEqual({});
  });

  it('P4-6: resolves freshness for plant with no RO trains but with well readings', async () => {
    // plant-1 has RO reading
    // plant-2 has NO RO trains, but has well readings
    // plant-3 has only product meter readings
    const mockFrom = (table: string) => {
      const b: Record<string, any> = {};
      b.select = () => b;
      b.in = vi.fn().mockImplementation((_col: string, _ids: string[]) => {
        if (table === 'ro_train_readings_latest') {
          return Promise.resolve({
            data: [
              { plant_id: 'plant-1', reading_datetime: '2026-09-21T08:00:00Z' },
            ],
            error: null,
          });
        }
        if (table === 'well_readings_latest') {
          return Promise.resolve({
            data: [
              { plant_id: 'plant-2', reading_datetime: '2026-09-21T09:30:00Z' },
            ],
            error: null,
          });
        }
        if (table === 'locator_readings_latest') {
          return Promise.resolve({
            data: [],
            error: null,
          });
        }
        if (table === 'product_meter_readings_latest') {
          return Promise.resolve({
            data: [
              { plant_id: 'plant-3', reading_datetime: '2026-09-21T10:15:00Z' },
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: [], error: null });
      });
      return b;
    };

    (supabase.from as any).mockImplementation(mockFrom);

    const res = await fetchPlantFreshness(['plant-1', 'plant-2', 'plant-3']);

    expect(res['plant-1']?.toISOString()).toBe('2026-09-21T08:00:00.000Z');
    expect(res['plant-2']?.toISOString()).toBe('2026-09-21T09:30:00.000Z');
    expect(res['plant-3']?.toISOString()).toBe('2026-09-21T10:15:00.000Z');
  });

  it('P4-3: identifies silent plant where all sources return no readings', async () => {
    const mockFrom = (_table: string) => {
      const b: Record<string, any> = {};
      b.select = () => b;
      b.in = vi.fn().mockImplementation(() => {
        return Promise.resolve({
          data: [
            { plant_id: 'plant-active', reading_datetime: '2026-09-21T11:00:00Z' },
          ],
          error: null,
        });
      });
      return b;
    };

    (supabase.from as any).mockImplementation(mockFrom);

    const res = await fetchPlantFreshness(['plant-active', 'plant-silent']);

    expect(res['plant-active']?.toISOString()).toBe('2026-09-21T11:00:00.000Z');
    expect(res['plant-silent']).toBeNull(); // Silent plant does not inherit global reading!
  });

  it('picks the latest timestamp when a plant has readings in multiple sources', async () => {
    const mockFrom = (table: string) => {
      const b: Record<string, any> = {};
      b.select = () => b;
      b.in = vi.fn().mockImplementation(() => {
        if (table === 'ro_train_readings_latest') {
          return Promise.resolve({
            data: [{ plant_id: 'plant-1', reading_datetime: '2026-09-21T07:00:00Z' }],
            error: null,
          });
        }
        if (table === 'well_readings_latest') {
          return Promise.resolve({
            data: [{ plant_id: 'plant-1', reading_datetime: '2026-09-21T09:00:00Z' }], // latest
            error: null,
          });
        }
        if (table === 'locator_readings_latest') {
          return Promise.resolve({
            data: [{ plant_id: 'plant-1', reading_datetime: '2026-09-21T08:00:00Z' }],
            error: null,
          });
        }
        return Promise.resolve({ data: [], error: null });
      });
      return b;
    };

    (supabase.from as any).mockImplementation(mockFrom);

    const res = await fetchPlantFreshness(['plant-1']);

    expect(res['plant-1']?.toISOString()).toBe('2026-09-21T09:00:00.000Z');
  });
});

