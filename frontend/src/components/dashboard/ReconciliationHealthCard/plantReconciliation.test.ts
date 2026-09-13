import { describe, it, expect } from 'vitest';
import {
  resolveReconcilablePlantIds,
  buildPlantReconciliationRows,
  type ReconciliationBuildInput,
} from './plantReconciliation';

const iso = (d: string) => `${d}T12:00:00`;

function baseInput(overrides: Partial<ReconciliationBuildInput> = {}): ReconciliationBuildInput {
  return {
    roReadings: [],
    productReadings: [],
    roTrains: [],
    productMeters: [],
    plants: [{ id: 'p1', name: 'Plant A' }],
    reconcilablePlantIds: new Set(['p1']),
    secondaryTrainIds: new Set(),
    ...overrides,
  };
}

const train = (id: string, plantId: string, unitType = 'primary', name = `RO-${id}`) => ({
  id, plant_id: plantId, train_number: 1, name, unit_type: unitType,
});
const meter = (id: string, plantId: string, name = id, isDerived = false) => ({
  id, plant_id: plantId, name, is_derived: isDerived,
});

describe('resolveReconcilablePlantIds', () => {
  it('includes plants whose saved config is a dedicated product meter', () => {
    const ids = resolveReconcilablePlantIds([{ id: 'p1' }], [{ plant_id: 'p1', config: { ro_production_source: 'product' } }]);
    expect(ids.has('p1')).toBe(true);
  });

  it('excludes permeate (= production) and both-source plants', () => {
    const ids = resolveReconcilablePlantIds(
      [{ id: 'p1' }, { id: 'p2' }],
      [
        { plant_id: 'p1', config: { ro_production_source: 'permeate' } },
        { plant_id: 'p2', config: { ro_production_source: 'both' } },
      ],
    );
    expect(ids.has('p1')).toBe(false);
    expect(ids.has('p2')).toBe(false);
  });

  it('treats a null or missing ro_production_source as the DEFAULT_METER_CONFIG default (product)', () => {
    const ids = resolveReconcilablePlantIds(
      [{ id: 'p1' }, { id: 'p2' }],
      [
        { plant_id: 'p1', config: null },
        { plant_id: 'p2', config: {} },
      ],
    );
    expect(ids.has('p1')).toBe(true);
    expect(ids.has('p2')).toBe(true);
  });

  it('includes plants with no saved config row at all (default is product)', () => {
    const ids = resolveReconcilablePlantIds([{ id: 'p1' }], []);
    expect(ids.has('p1')).toBe(true);
  });
});

describe('buildPlantReconciliationRows', () => {
  it('groups train permeate and product meter deltas per plant and sums them', () => {
    const input = baseInput({
      roTrains: [train('t1', 'p1'), train('t2', 'p1')],
      productMeters: [meter('m1', 'p1', 'Mother meter')],
      roReadings: [
        { train_id: 't1', permeate_meter_delta: 5000, reading_datetime: iso('2026-08-01') },
        { train_id: 't2', permeate_meter_delta: 4800, reading_datetime: iso('2026-08-01') },
      ],
      productReadings: [
        { meter_id: 'm1', current_reading: 9600, previous_reading: 0, daily_volume: 9600, reading_datetime: iso('2026-08-01') },
      ],
    });
    const rows = buildPlantReconciliationRows(input);
    expect(rows).toHaveLength(1);
    expect(rows[0].plantId).toBe('p1');
    expect(rows[0].plantName).toBe('Plant A');
    expect(rows[0].result.totalTrainPermeate).toBe(9800);
    expect(rows[0].result.totalProductMeter).toBe(9600);
    expect(rows[0].result.deltaVariance).toBe(200);
    expect(rows[0].result.status).toBe('marginal');
  });

  it('excludes secondary (2nd-pass) trains from the permeate total', () => {
    const input = baseInput({
      roTrains: [train('t1', 'p1'), train('t2', 'p1', 'secondary')],
      productMeters: [meter('m1', 'p1', 'Mother meter')],
      secondaryTrainIds: new Set(['t2']),
      roReadings: [
        { train_id: 't1', permeate_meter_delta: 5000, reading_datetime: iso('2026-08-01') },
        { train_id: 't2', permeate_meter_delta: 4800, reading_datetime: iso('2026-08-01') },
      ],
      productReadings: [
        { meter_id: 'm1', current_reading: 5000, previous_reading: 0, daily_volume: 5000, reading_datetime: iso('2026-08-01') },
      ],
    });
    const rows = buildPlantReconciliationRows(input);
    expect(rows).toHaveLength(1);
    expect(rows[0].result.totalTrainPermeate).toBe(5000);
    expect(rows[0].result.status).toBe('balanced');
  });

  it('skips meter-replacement rows and clamps negative stored deltas to 0', () => {
    const input = baseInput({
      roTrains: [train('t1', 'p1')],
      productMeters: [meter('m1', 'p1', 'Mother meter')],
      roReadings: [
        { train_id: 't1', permeate_meter_delta: 1000, reading_datetime: iso('2026-08-01') },
        { train_id: 't1', permeate_meter_delta: -50, reading_datetime: iso('2026-08-02') },
        { train_id: 't1', permeate_meter_delta: 500, reading_datetime: iso('2026-08-03'), is_meter_replacement: true },
      ],
      productReadings: [
        { meter_id: 'm1', current_reading: 1500, previous_reading: 0, daily_volume: 1500, reading_datetime: iso('2026-08-03') },
      ],
    });
    const rows = buildPlantReconciliationRows(input);
    expect(rows).toHaveLength(1);
    expect(rows[0].result.totalTrainPermeate).toBe(1000);
  });

  it('sorts worst variance first', () => {
    const input = baseInput({
      roTrains: [train('t1', 'p1'), train('t2', 'p2'), train('t3', 'p3')],
      productMeters: [
        meter('m1', 'p1', 'Mother meter'), meter('m2', 'p2', 'Mother meter'), meter('m3', 'p3', 'Mother meter'),
      ],
      plants: [
        { id: 'p1', name: 'Plant A' },
        { id: 'p2', name: 'Plant B' },
        { id: 'p3', name: 'Plant C' },
      ],
      reconcilablePlantIds: new Set(['p1', 'p2', 'p3']),
      roReadings: [
        { train_id: 't1', permeate_meter_delta: 1000, reading_datetime: iso('2026-08-01') },
        { train_id: 't2', permeate_meter_delta: 1000, reading_datetime: iso('2026-08-01') },
        { train_id: 't3', permeate_meter_delta: 1000, reading_datetime: iso('2026-08-01') },
      ],
      productReadings: [
        // 0% variance (balanced)
        { meter_id: 'm1', current_reading: 1000, previous_reading: 0, daily_volume: 1000, reading_datetime: iso('2026-08-01') },
        // 11.1% — alert
        { meter_id: 'm2', current_reading: 900, previous_reading: 0, daily_volume: 900, reading_datetime: iso('2026-08-01') },
        // 2.6% — marginal
        { meter_id: 'm3', current_reading: 975, previous_reading: 0, daily_volume: 975, reading_datetime: iso('2026-08-01') },
      ],
    });
    const rows = buildPlantReconciliationRows(input);
    expect(rows.map((r) => r.plantId)).toEqual(['p2', 'p3', 'p1']);
  });

  it('drops plants that are not reconciliable by config even when they have data', () => {
    const input = baseInput({
      roTrains: [train('t1', 'p1')],
      productMeters: [meter('m1', 'p1', 'Mother meter')],
      reconcilablePlantIds: new Set(), // e.g. plant p1 is configured 'both' / 'permeate'
      roReadings: [{ train_id: 't1', permeate_meter_delta: 1000, reading_datetime: iso('2026-08-01') }],
      productReadings: [
        { meter_id: 'm1', current_reading: 1000, previous_reading: 0, daily_volume: 1000, reading_datetime: iso('2026-08-01') },
      ],
    });
    expect(buildPlantReconciliationRows(input)).toEqual([]);
  });

  it('drops plants whose meters have no readings in the window', () => {
    const input = baseInput({
      roTrains: [train('t1', 'p1')],
      productMeters: [meter('m1', 'p1', 'Mother meter')],
      // deliberately no roReadings / productReadings
    });
    expect(buildPlantReconciliationRows(input)).toEqual([]);
  });
});