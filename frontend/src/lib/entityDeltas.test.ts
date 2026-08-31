import { describe, it, expect } from 'vitest';
import { computeEntityDeltas } from './entityDeltas';

const iso = (d: string) => new Date(`${d}T08:00:00Z`).toISOString();

describe('computeEntityDeltas', () => {
  it('diffs consecutive readings for the same entity', () => {
    const readings = [
      { well_id: 'w1', reading_datetime: iso('2026-07-01'), current_reading: 1000, previous_reading: 900 },
      { well_id: 'w1', reading_datetime: iso('2026-07-02'), current_reading: 1150, previous_reading: 1000 },
    ];
    const out = computeEntityDeltas(readings, 'well_id', null);
    expect(out.map((o) => o.delta)).toEqual([100, 150]);
  });

  it('keys deltas per entity so two meters at the same plant never bleed into each other', () => {
    // Root cause of the -4,853,089 bug this mirrors TrendChart.tsx to avoid:
    // two wells' readings interleaved and (incorrectly) diffed against each
    // other if grouped by plant_id instead of well_id.
    const readings = [
      { well_id: 'w1', reading_datetime: iso('2026-07-01'), current_reading: 100, previous_reading: 0 },
      { well_id: 'w2', reading_datetime: iso('2026-07-01'), current_reading: 50000, previous_reading: 49900 },
      { well_id: 'w1', reading_datetime: iso('2026-07-02'), current_reading: 220, previous_reading: 100 },
    ];
    const out = computeEntityDeltas(readings, 'well_id', null);
    const total = out.reduce((s, o) => s + o.delta, 0);
    // 100 (w1 day1) + 100 (w2 day1) + 120 (w1 day2) = 320 — not a cross-well
    // diff like 50000 - 220 or similar.
    expect(total).toBe(320);
  });

  it('zeroes the replacement row and, by default, the row immediately after it', () => {
    const readings = [
      { well_id: 'w1', reading_datetime: iso('2026-07-01'), current_reading: 500, previous_reading: 400 },
      { well_id: 'w1', reading_datetime: iso('2026-07-02'), current_reading: 0, is_meter_replacement: true },
      { well_id: 'w1', reading_datetime: iso('2026-07-03'), current_reading: 12 },
      { well_id: 'w1', reading_datetime: iso('2026-07-04'), current_reading: 40 },
    ];
    const out = computeEntityDeltas(readings, 'well_id', null);
    expect(out.map((o) => o.delta)).toEqual([100, 0, 0, 28]);
  });

  it('with skipAfterRepl, diffs the row right after a replacement normally against the new baseline', () => {
    // RO permeate fallback path shape: repl row sets the new meter's start
    // value, and the very next reading should diff against THAT, not be
    // zeroed — otherwise real production immediately after a swap vanishes.
    const readings = [
      { train_id: 't1', reading_datetime: iso('2026-07-01'), current_reading: 227368, is_meter_replacement: true },
      { train_id: 't1', reading_datetime: iso('2026-07-02'), current_reading: 228106 },
    ];
    const out = computeEntityDeltas(readings, 'train_id', null, { skipAfterRepl: true });
    expect(out.map((o) => o.delta)).toEqual([0, 738]);
  });

  it('treats direct-mode entities\' current_reading as the volume itself, never a diff', () => {
    const readings = [
      { locator_id: 'l1', reading_datetime: iso('2026-07-01'), current_reading: 42, previous_reading: 9999 },
      { locator_id: 'l1', reading_datetime: iso('2026-07-02'), current_reading: 17 },
    ];
    const out = computeEntityDeltas(readings, 'locator_id', 'daily_volume', { directModeIds: new Set(['l1']) });
    expect(out.map((o) => o.delta)).toEqual([42, 17]);
  });

  it('clamps a backwards reading to 0 instead of propagating a negative spike', () => {
    const readings = [
      { well_id: 'w1', reading_datetime: iso('2026-07-01'), current_reading: 1000, previous_reading: 900 },
      { well_id: 'w1', reading_datetime: iso('2026-07-02'), current_reading: 500 }, // meter reset, not flagged
    ];
    const out = computeEntityDeltas(readings, 'well_id', null);
    expect(out[1].delta).toBe(0);
    expect(out[1].rawDelta).toBe(-500);
  });

  it('self-heals a stale stored daily_volume once a live predecessor is known (Coke/Parkmall Aug 7-10 shape)', () => {
    const readings = [
      { locator_id: 'l1', reading_datetime: iso('2026-08-06'), current_reading: 1010, daily_volume: 10, previous_reading: 1000 },
      { locator_id: 'l1', reading_datetime: iso('2026-08-07'), current_reading: 1020, daily_volume: 20, previous_reading: 1000 },
      { locator_id: 'l1', reading_datetime: iso('2026-08-08'), current_reading: 1030, daily_volume: 30, previous_reading: 1000 },
    ];
    const out = computeEntityDeltas(readings, 'locator_id', 'daily_volume');
    // Without the self-heal this would be 10 + 20 + 30 = 60 (cumulative-looking).
    expect(out.map((o) => o.delta)).toEqual([10, 10, 10]);
  });

  it('excludes retracted readings from the delta sequence and volume calculations', () => {
    const readings = [
      { well_id: 'w1', reading_datetime: iso('2026-07-01'), current_reading: 1000, previous_reading: 900 },
      { well_id: 'w1', reading_datetime: iso('2026-07-02'), current_reading: 1500, norm_status: 'retracted' },
      { well_id: 'w1', reading_datetime: iso('2026-07-03'), current_reading: 1100 },
    ];
    const out = computeEntityDeltas(readings, 'well_id', null);
    expect(out.map((o) => o.delta)).toEqual([100, 100]);
  });
});
