import { describe, it, expect } from 'vitest';
import {
  AUTO_OFFLINE_THRESHOLD_HOURS,
  shouldAutoFlagTrainOffline,
  latestReadingByTrain,
  computeTrainGaps,
  needsUnboundedConfirmation,
  reconcileOfflineCandidate,
  buildUptimeReportsByTrain,
  isGapExempted,
  type RawTrainRow,
  type UptimeReportRow,
} from './useTrainAutoOffline';

describe('useTrainAutoOffline threshold & auto-flagging guards', () => {
  it('enforces a minimum threshold of 2 hours', () => {
    expect(AUTO_OFFLINE_THRESHOLD_HOURS).toBe(2);
  });

  it('does NOT auto-flag when gap is less than 2 hours', () => {
    expect(shouldAutoFlagTrainOffline(0, 'Running')).toBe(false);
    expect(shouldAutoFlagTrainOffline(0.5, 'Running')).toBe(false);
    expect(shouldAutoFlagTrainOffline(1.0, 'Running')).toBe(false);
    expect(shouldAutoFlagTrainOffline(1.5, 'Running')).toBe(false);
    expect(shouldAutoFlagTrainOffline(1.99, 'Running')).toBe(false);
  });

  it('auto-flags when gap is 2 hours or more for a Running train', () => {
    expect(shouldAutoFlagTrainOffline(2.0, 'Running')).toBe(true);
    expect(shouldAutoFlagTrainOffline(2.1, 'Running')).toBe(true);
    expect(shouldAutoFlagTrainOffline(5.0, 'Running')).toBe(true);
    expect(shouldAutoFlagTrainOffline(Infinity, 'Running')).toBe(true);
  });

  it('does NOT auto-flag when train is already Offline or in Maintenance', () => {
    expect(shouldAutoFlagTrainOffline(2.0, 'Offline')).toBe(false);
    expect(shouldAutoFlagTrainOffline(2.5, 'Offline')).toBe(false);
    expect(shouldAutoFlagTrainOffline(2.0, 'Maintenance')).toBe(false);
    expect(shouldAutoFlagTrainOffline(10.0, 'Maintenance')).toBe(false);
  });
});

describe('latestReadingByTrain', () => {
  it('keeps the max reading_datetime per train regardless of input order', () => {
    const lastBy = latestReadingByTrain([
      { train_id: 'train-7', reading_datetime: '2026-09-12T05:01:00Z' },
      { train_id: 'train-7', reading_datetime: '2026-09-12T04:06:00Z' },
      { train_id: 'train-7', reading_datetime: '2026-09-12T05:04:00Z' }, // latest, in the middle
      { train_id: 'train-9', reading_datetime: '2026-09-12T01:00:00Z' },
    ]);
    expect(lastBy.get('train-7')).toBe('2026-09-12T05:04:00Z');
    expect(lastBy.get('train-9')).toBe('2026-09-12T01:00:00Z');
  });

  it('merges rows from both the RO and Pre-Treatment tables for the same train', () => {
    const roRows = [{ train_id: 'train-7', reading_datetime: '2026-09-12T05:04:00Z' }];
    const preRows = [{ train_id: 'train-7', reading_datetime: '2026-09-12T06:00:00Z' }]; // newer
    const lastBy = latestReadingByTrain([...roRows, ...preRows]);
    expect(lastBy.get('train-7')).toBe('2026-09-12T06:00:00Z');
  });

  it('ignores null reading_datetime values', () => {
    const lastBy = latestReadingByTrain([{ train_id: 'train-7', reading_datetime: null }]);
    expect(lastBy.has('train-7')).toBe(false);
  });
});

describe('computeTrainGaps', () => {
  const trains: RawTrainRow[] = [
    { id: 'train-7', train_number: 7, plant_id: 'plant-1', status: 'Running' },
  ];

  it('computes hours_gap from now minus the last reading', () => {
    const nowMs = new Date('2026-09-12T06:03:00Z').getTime();
    const lastBy = new Map([['train-7', '2026-09-12T05:04:00Z']]); // 59 minutes earlier
    const [gap] = computeTrainGaps(trains, lastBy, nowMs);
    expect(gap.hours_gap).toBeCloseTo(59 / 60, 2);
    expect(shouldAutoFlagTrainOffline(gap.hours_gap, gap.current_status)).toBe(false);
  });

  it('reports Infinity when the train has no entry in lastBy', () => {
    const nowMs = new Date('2026-09-12T06:03:00Z').getTime();
    const [gap] = computeTrainGaps(trains, new Map(), nowMs);
    expect(gap.hours_gap).toBe(Infinity);
  });
});

describe('needsUnboundedConfirmation / reconcileOfflineCandidate (the reported bug)', () => {
  // Reproduces the production incident: Train 7 had a real reading at 13:04,
  // but the windowed ("since" = requesting-device-clock - 24h) fetch missed
  // it — e.g. because that device's clock was ahead — so the candidate
  // arrived with hours_gap===Infinity even though the train was only ~1h
  // stale. It should NOT get auto-flagged once the unbounded confirmation
  // lookup turns up that recent reading.
  const nowMs = new Date('2026-09-12T14:03:00Z').getTime(); // "now" when the check ran
  const staleCandidate = {
    train_id: 'train-7', train_number: 7, plant_id: 'plant-1',
    last_reading_at: null, hours_gap: Infinity, current_status: 'Running',
  };

  it('flags an Infinity candidate as needing confirmation', () => {
    expect(needsUnboundedConfirmation(staleCandidate)).toBe(true);
  });

  it('does NOT flag a finite-gap candidate as needing confirmation', () => {
    expect(needsUnboundedConfirmation({ ...staleCandidate, hours_gap: 3, last_reading_at: '2026-09-12T11:03:00Z' })).toBe(false);
  });

  it('drops the candidate when the unbounded lookup finds a reading under the threshold (the false positive)', () => {
    const reconciled = reconcileOfflineCandidate(staleCandidate, '2026-09-12T13:04:00Z', nowMs);
    expect(reconciled).toBeNull();
  });

  it('keeps the candidate, with corrected fields, when the unbounded lookup finds an old-but-still-stale reading', () => {
    const reconciled = reconcileOfflineCandidate(staleCandidate, '2026-09-12T10:00:00Z', nowMs); // ~4h old
    expect(reconciled).not.toBeNull();
    expect(reconciled!.hours_gap).toBeCloseTo(4.05, 1);
    expect(reconciled!.last_reading_at).toBe('2026-09-12T10:00:00Z');
  });

  it('keeps the candidate as Infinity when the unbounded lookup also finds nothing (genuinely never read)', () => {
    const reconciled = reconcileOfflineCandidate(staleCandidate, null, nowMs);
    expect(reconciled).not.toBeNull();
    expect(reconciled!.hours_gap).toBe(Infinity);
  });

  it('passes finite-gap candidates through untouched (no confirmation needed)', () => {
    const finite = { ...staleCandidate, hours_gap: 5, last_reading_at: '2026-09-12T09:03:00Z' };
    expect(reconcileOfflineCandidate(finite, 'irrelevant', nowMs)).toBe(finite);
  });
});

describe('buildUptimeReportsByTrain / isGapExempted ("Report Running" exemption)', () => {
  const report = (train_id: string, covered_from: string, covered_until: string): UptimeReportRow => ({
    train_id, covered_from, covered_until,
  });

  it('groups multiple reports for the same train under one key', () => {
    const map = buildUptimeReportsByTrain([
      report('train-7', '2026-09-01T00:00:00Z', '2026-09-01T04:00:00Z'),
      report('train-7', '2026-09-05T00:00:00Z', '2026-09-05T04:00:00Z'),
      report('train-9', '2026-09-01T00:00:00Z', '2026-09-01T04:00:00Z'),
    ]);
    expect(map.get('train-7')).toHaveLength(2);
    expect(map.get('train-9')).toHaveLength(1);
  });

  it('exempts a gap whose start falls strictly inside a reported window', () => {
    const map = buildUptimeReportsByTrain([report('train-7', '2026-09-12T10:00:00Z', '2026-09-12T14:00:00Z')]);
    expect(isGapExempted(map, 'train-7', '2026-09-12T12:00:00Z')).toBe(true);
  });

  it('treats the window bounds as inclusive on both ends', () => {
    const map = buildUptimeReportsByTrain([report('train-7', '2026-09-12T10:00:00Z', '2026-09-12T14:00:00Z')]);
    expect(isGapExempted(map, 'train-7', '2026-09-12T10:00:00Z')).toBe(true); // == covered_from
    expect(isGapExempted(map, 'train-7', '2026-09-12T14:00:00Z')).toBe(true); // == covered_until
  });

  it('does NOT exempt a gap starting before covered_from', () => {
    const map = buildUptimeReportsByTrain([report('train-7', '2026-09-12T10:00:00Z', '2026-09-12T14:00:00Z')]);
    expect(isGapExempted(map, 'train-7', '2026-09-12T09:59:59Z')).toBe(false);
  });

  it('does NOT exempt a gap starting after covered_until — an attestation is not a standing exemption', () => {
    const map = buildUptimeReportsByTrain([report('train-7', '2026-09-12T10:00:00Z', '2026-09-12T14:00:00Z')]);
    expect(isGapExempted(map, 'train-7', '2026-09-12T14:00:01Z')).toBe(false);
  });

  it('does NOT exempt when gapStart is null (Infinity-hours-gap candidate, never reconciled)', () => {
    const map = buildUptimeReportsByTrain([report('train-7', '2026-09-12T10:00:00Z', '2026-09-12T14:00:00Z')]);
    expect(isGapExempted(map, 'train-7', null)).toBe(false);
  });

  it('does NOT exempt a train with no filed reports at all', () => {
    const map = buildUptimeReportsByTrain([]);
    expect(isGapExempted(map, 'train-7', '2026-09-12T12:00:00Z')).toBe(false);
  });

  it('does NOT exempt a different train even when its report window would otherwise match', () => {
    const map = buildUptimeReportsByTrain([report('train-9', '2026-09-12T10:00:00Z', '2026-09-12T14:00:00Z')]);
    expect(isGapExempted(map, 'train-7', '2026-09-12T12:00:00Z')).toBe(false);
  });

  it('finds a match among several reports for the same train when only one covers the gap', () => {
    const map = buildUptimeReportsByTrain([
      report('train-7', '2026-09-01T00:00:00Z', '2026-09-01T04:00:00Z'), // too old
      report('train-7', '2026-09-12T10:00:00Z', '2026-09-12T14:00:00Z'), // this one covers it
      report('train-7', '2026-09-20T00:00:00Z', '2026-09-20T04:00:00Z'), // too new
    ]);
    expect(isGapExempted(map, 'train-7', '2026-09-12T12:00:00Z')).toBe(true);
  });

  it('end-to-end: an exempted candidate is filtered out of the auto-flag list, an unrelated one is not', () => {
    // Mirrors the actual filter chain in useTrainAutoOffline's queryFn.
    const trains: RawTrainRow[] = [
      { id: 'train-7', train_number: 7, plant_id: 'plant-1', status: 'Running' }, // exempted gap
      { id: 'train-9', train_number: 9, plant_id: 'plant-1', status: 'Running' }, // genuine gap
    ];
    const nowMs = new Date('2026-09-12T13:00:00Z').getTime();
    const lastBy = new Map([
      ['train-7', '2026-09-12T10:30:00Z'], // 2.5h stale, but covered by a filed report
      ['train-9', '2026-09-12T10:30:00Z'], // 2.5h stale, no report filed
    ]);
    const reportsByTrain = buildUptimeReportsByTrain([
      report('train-7', '2026-09-12T10:00:00Z', '2026-09-12T14:00:00Z'),
    ]);

    const flagged = computeTrainGaps(trains, lastBy, nowMs)
      .filter((g) => shouldAutoFlagTrainOffline(g.hours_gap, g.current_status))
      .filter((g) => !isGapExempted(reportsByTrain, g.train_id, g.last_reading_at));

    expect(flagged.map((g) => g.train_id)).toEqual(['train-9']);
  });
});

