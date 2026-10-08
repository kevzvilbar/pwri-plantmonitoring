import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRoDrillData } from './useTrendChartRoDrill';

const base = {
  hasRoDrill: true,
  metric: 'chlorine',
  viewGran: 'daily',
  startKey: '2026-10-01',
  endKey: '2026-10-08',
  roTrainNames: new Map([['A', 'RO Train 1'], ['B', 'RO Train 2']]),
  setSelectedTrainIds: () => {},
  trainSearch: '',
  selectedTrainIds: null as Set<string> | null,
};
const r = (train_id: string, iso: string, v: number | null, extra: Record<string, unknown> = {}) => ({
  train_id, reading_datetime: iso, chlorine_residual_mg_l: v, ...extra,
});

describe('useRoDrillData: chlorine Hourly stays per train', () => {
  it('returns one series per train and never a pooled value', () => {
    const roReadings = [
      r('A', '2026-10-08T01:00:00Z', 0.8),
      r('B', '2026-10-08T01:30:00Z', 1.4),
    ];
    const { result } = renderHook(() => useRoDrillData({ ...base, roDrillMode: 'by-hour', roReadings }));
    const { rows, series } = result.current.roHourByTrainData;
    expect(series.map((s: { trainId: string }) => s.trainId).sort()).toEqual(['A', 'B']);
    expect(rows[0]['val:A']).toBe(0.8);
    expect(rows[0]['val:B']).toBe(1.4);
    expect(rows[0]).not.toHaveProperty('value');
  });

  it('drops retracted rows and unverified suspects, keeps normalized ones', () => {
    const roReadings = [
      r('A', '2026-10-08T01:00:00Z', 1.0),
      r('A', '2026-10-08T02:00:00Z', 8.3),                                    // suspect
      r('A', '2026-10-08T03:00:00Z', 8.3, { norm_status: 'retracted' }),      // retracted
      r('A', '2026-10-08T04:00:00Z', 8.3, { norm_status: 'normalized' }),     // verified
      r('A', '2026-10-08T05:00:00Z', null),                                   // blank
    ];
    const { result } = renderHook(() => useRoDrillData({ ...base, roDrillMode: 'by-hour', roReadings }));
    expect(result.current.roHourByTrainData.rows.map((x: Record<string, number>) => x['val:A'])).toEqual([1.0, 8.3]);
  });

  it('honours the train filter', () => {
    const roReadings = [r('A', '2026-10-08T01:00:00Z', 0.8), r('B', '2026-10-08T01:00:00Z', 1.4)];
    const { result } = renderHook(() =>
      useRoDrillData({ ...base, roDrillMode: 'by-hour', roReadings, selectedTrainIds: new Set(['B']) }));
    expect(result.current.roHourByTrainData.series.map((s: { trainId: string }) => s.trainId)).toEqual(['B']);
  });

  it('is empty outside chlorine Hourly (other metrics and modes are untouched)', () => {
    const roReadings = [r('A', '2026-10-08T01:00:00Z', 0.8)];
    const daily = renderHook(() => useRoDrillData({ ...base, roDrillMode: 'default', roReadings }));
    expect(daily.result.current.roHourByTrainData.rows).toEqual([]);
    const tds = renderHook(() => useRoDrillData({ ...base, metric: 'tds', roDrillMode: 'by-hour', roReadings }));
    expect(tds.result.current.roHourByTrainData.rows).toEqual([]);
  });
});
