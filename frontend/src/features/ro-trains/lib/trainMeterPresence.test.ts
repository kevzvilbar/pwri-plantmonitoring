import { describe, it, expect } from 'vitest';
import {
  missingRequiredMeters,
  trainMeterFlags,
  streamIsMeasured,
  missingMeasuredStreams,
  countMeasuredStreams,
} from './trainMeterPresence';

const ALL = { feed: true, permeate: true, reject: true };

describe('missingRequiredMeters', () => {
  it('requires all three meters when all three are configured', () => {
    expect(missingRequiredMeters(ALL, { feed: '', permeate: '', reject: '' }))
      .toEqual(['feed', 'permeate', 'reject']);
  });

  it('does NOT let one configured meter be skipped just because the other two are filled', () => {
    // Regression: the old "any 2 of 3" rule let Reject go blank here.
    expect(missingRequiredMeters(ALL, { feed: '6000', permeate: '3082857', reject: '' }))
      .toEqual(['reject']);
    expect(missingRequiredMeters(ALL, { feed: '', permeate: '3082857', reject: '900' }))
      .toEqual(['feed']);
    expect(missingRequiredMeters(ALL, { feed: '6000', permeate: '', reject: '900' }))
      .toEqual(['permeate']);
  });

  it('flags Feed and Reject when only Permeate was entered (the Train 3 · RO3 log rows)', () => {
    expect(missingRequiredMeters(ALL, { feed: '', permeate: '3082857', reject: '' }))
      .toEqual(['feed', 'reject']);
  });

  it('passes when every configured meter has a reading', () => {
    expect(missingRequiredMeters(ALL, { feed: '6000', permeate: '3082857', reject: '900' })).toEqual([]);
  });

  it('treats 0 as a valid reading but whitespace / null / undefined as missing', () => {
    expect(missingRequiredMeters(ALL, { feed: '0', permeate: '0', reject: '0' })).toEqual([]);
    expect(missingRequiredMeters(ALL, { feed: '  ', permeate: null, reject: undefined }))
      .toEqual(['feed', 'permeate', 'reject']);
  });

  it('never asks for an unmetered stream — that one is the auto-calculated one', () => {
    // Reject not installed → Reject = Feed − Permeate; Feed + Permeate required.
    const noReject = { feed: true, permeate: true, reject: false };
    expect(missingRequiredMeters(noReject, { feed: '6000', permeate: '3082857', reject: '' })).toEqual([]);
    expect(missingRequiredMeters(noReject, { feed: '', permeate: '3082857', reject: '' })).toEqual(['feed']);

    // Feed not installed → Feed = Permeate + Reject; Permeate + Reject required.
    const noFeed = { feed: false, permeate: true, reject: true };
    expect(missingRequiredMeters(noFeed, { feed: '', permeate: '3082857', reject: '900' })).toEqual([]);
    expect(missingRequiredMeters(noFeed, { feed: '', permeate: '3082857', reject: '' })).toEqual(['reject']);

    // Permeate not installed → Permeate = Feed − Reject; Feed + Reject required.
    const noPerm = { feed: true, permeate: false, reject: true };
    expect(missingRequiredMeters(noPerm, { feed: '6000', permeate: '', reject: '900' })).toEqual([]);
    expect(missingRequiredMeters(noPerm, { feed: '6000', permeate: '', reject: '' })).toEqual(['reject']);
  });

  it('works end-to-end with a train row straight from Plant Configuration', () => {
    const train = { has_feed_meter: true, has_permeate_meter: true, has_reject_meter: true };
    expect(missingRequiredMeters(trainMeterFlags(train), { feed: '', permeate: '10', reject: '' }))
      .toEqual(['feed', 'reject']);

    const rejectNotInstalled = { ...train, has_reject_meter: false };
    expect(missingRequiredMeters(trainMeterFlags(rejectNotInstalled), { feed: '5', permeate: '10', reject: '' }))
      .toEqual([]);
  });

  it('defaults to all-required when the train has no config (legacy trains)', () => {
    expect(missingRequiredMeters(trainMeterFlags(null), { feed: '', permeate: '', reject: '' }))
      .toEqual(['feed', 'permeate', 'reject']);
  });
});

describe('streamIsMeasured', () => {
  it('returns true when a manual meter reading is non-empty', () => {
    expect(streamIsMeasured({ hasManualMeter: true, isEM: false, meterReading: '6000', emFlow: '' })).toBe(true);
    expect(streamIsMeasured({ hasManualMeter: true, isEM: false, meterReading: '0', emFlow: '' })).toBe(true);
  });

  it('returns false when a manual meter reading is empty or whitespace', () => {
    expect(streamIsMeasured({ hasManualMeter: true, isEM: false, meterReading: '', emFlow: '' })).toBe(false);
    expect(streamIsMeasured({ hasManualMeter: true, isEM: false, meterReading: '  ', emFlow: '' })).toBe(false);
    expect(streamIsMeasured({ hasManualMeter: true, isEM: false, meterReading: null, emFlow: '' })).toBe(false);
  });

  it('returns true when EM flow is strictly above 0', () => {
    expect(streamIsMeasured({ hasManualMeter: false, isEM: true, meterReading: '', emFlow: '113.5' })).toBe(true);
    expect(streamIsMeasured({ hasManualMeter: false, isEM: true, meterReading: '', emFlow: '0.001' })).toBe(true);
  });

  it('returns false when EM flow is 0 — this was the loophole (SRP RO5 fingerprint)', () => {
    expect(streamIsMeasured({ hasManualMeter: false, isEM: true, meterReading: '', emFlow: '0' })).toBe(false);
    expect(streamIsMeasured({ hasManualMeter: false, isEM: true, meterReading: '', emFlow: '0.0' })).toBe(false);
  });

  it('returns false when EM flow is negative or missing', () => {
    expect(streamIsMeasured({ hasManualMeter: false, isEM: true, meterReading: '', emFlow: '-5' })).toBe(false);
    expect(streamIsMeasured({ hasManualMeter: false, isEM: true, meterReading: '', emFlow: '' })).toBe(false);
    expect(streamIsMeasured({ hasManualMeter: false, isEM: true, meterReading: '', emFlow: null })).toBe(false);
  });

  it('returns true on a mixed-path stream (has manual meter AND EM) when either is present', () => {
    // Manual meter filled, EM blank
    expect(streamIsMeasured({ hasManualMeter: true, isEM: true, meterReading: '3082857', emFlow: '' })).toBe(true);
    // EM filled, manual blank
    expect(streamIsMeasured({ hasManualMeter: true, isEM: true, meterReading: '', emFlow: '112' })).toBe(true);
    // Both blank → not measured
    expect(streamIsMeasured({ hasManualMeter: true, isEM: true, meterReading: '', emFlow: '0' })).toBe(false);
  });
});

describe('missingMeasuredStreams', () => {
  const ALL_FLAGS = { feed: true, permeate: true, reject: true };
  const ALL_EM = { feedIsEM: true, permIsEM: true, rejIsEM: true };
  const NO_EM = { feedIsEM: false, permIsEM: false, rejIsEM: false };

  it('SRP RO5 fingerprint: reject EM = 0 counts as missing even when permeate and feed are present', () => {
    // RO5 config: feed not installed (inferred), permeate + reject both EM-configured
    const meterFlags = { feed: false, permeate: true, reject: true };
    const emFlags = { feedIsEM: true, permIsEM: true, rejIsEM: true };
    const meterReadings = { feed: '', permeate: '', reject: '' };
    const emReadings = { feed: '113', permeate: '113', reject: '0' }; // reject typed as 0

    expect(missingMeasuredStreams(meterFlags, emFlags, meterReadings, emReadings))
      .toEqual(['reject']);
  });

  it('hard blocks when 2 configured streams are unmeasured', () => {
    const meterReadings = { feed: '', permeate: '', reject: '' };
    const emReadings = { feed: '0', permeate: '113', reject: '0' };
    expect(missingMeasuredStreams(ALL_FLAGS, ALL_EM, meterReadings, emReadings))
      .toEqual(['feed', 'reject']); // length >= 2 → hard block
  });

  it('does not block when exactly one stream is unmeasured (it will be inferred)', () => {
    const meterReadings = { feed: '', permeate: '', reject: '' };
    const emReadings = { feed: '150', permeate: '113', reject: '0' };
    expect(missingMeasuredStreams(ALL_FLAGS, ALL_EM, meterReadings, emReadings))
      .toEqual(['reject']); // length 1 → infer, prompt reason
  });

  it('passes when all configured EM streams are above 0', () => {
    const meterReadings = { feed: '', permeate: '', reject: '' };
    const emReadings = { feed: '150', permeate: '113', reject: '37' };
    expect(missingMeasuredStreams(ALL_FLAGS, ALL_EM, meterReadings, emReadings))
      .toEqual([]);
  });

  it('passes for manual-meter trains with all readings present', () => {
    const meterReadings = { feed: '6000', permeate: '3082857', reject: '900' };
    const emReadings = { feed: '', permeate: '', reject: '' };
    expect(missingMeasuredStreams(ALL_FLAGS, NO_EM, meterReadings, emReadings))
      .toEqual([]);
  });

  it('never flags an uninstalled stream', () => {
    const meterFlags = { feed: false, permeate: true, reject: true }; // feed not installed
    const meterReadings = { feed: '', permeate: '3082857', reject: '900' };
    const emReadings = { feed: '', permeate: '', reject: '' };
    expect(missingMeasuredStreams(meterFlags, NO_EM, meterReadings, emReadings))
      .toEqual([]); // feed is inferred, permeate + reject are present
  });
});

describe('countMeasuredStreams — absolute 2-out-of-3 water balance rule', () => {
  const ALL_FLAGS = { feed: true, permeate: true, reject: true };
  const ALL_EM = { feedIsEM: true, permIsEM: true, rejIsEM: true };
  const NO_EM = { feedIsEM: false, permIsEM: false, rejIsEM: false };

  it('counts 3 when all 3 streams are measured (manual or EM)', () => {
    const count = countMeasuredStreams(
      ALL_FLAGS,
      ALL_EM,
      { feed: '', permeate: '', reject: '' },
      { feed: '150', permeate: '113', reject: '37' },
    );
    expect(count).toBe(3);
  });

  it('counts 2 when 2 streams are measured and 1 is unmeasured', () => {
    const count = countMeasuredStreams(
      ALL_FLAGS,
      ALL_EM,
      { feed: '', permeate: '', reject: '' },
      { feed: '150', permeate: '113', reject: '' },
    );
    expect(count).toBe(2);
    expect(count >= 2).toBe(true); // Water balance valid: 3rd can be inferred
  });

  it('SRP RO5 scenario: only Permeate measured, Reject EM typed as 0 -> count is 1 (HARD BLOCK)', () => {
    // Feed uninstalled, Permeate and Reject are EM
    const meterFlags = { feed: false, permeate: true, reject: true };
    const count = countMeasuredStreams(
      meterFlags,
      ALL_EM,
      { feed: '', permeate: '', reject: '' },
      { feed: '', permeate: '113', reject: '0' }, // reject = 0 is not measured!
    );
    expect(count).toBe(1);
    expect(count < 2).toBe(true); // Fails 2-of-3 rule: HARD BLOCK, cannot save even with reason
  });

  it('counts 1 when only 1 manual meter is entered -> fails 2-of-3 rule', () => {
    const count = countMeasuredStreams(
      ALL_FLAGS,
      NO_EM,
      { feed: '', permeate: '3082857', reject: '' },
      { feed: '', permeate: '', reject: '' },
    );
    expect(count).toBe(1);
    expect(count < 2).toBe(true); // HARD BLOCK
  });

  it('counts 0 when all fields are empty -> fails 2-of-3 rule', () => {
    const count = countMeasuredStreams(
      ALL_FLAGS,
      NO_EM,
      { feed: '', permeate: '', reject: '' },
      { feed: '', permeate: '', reject: '' },
    );
    expect(count).toBe(0);
    expect(count < 2).toBe(true); // HARD BLOCK
  });

  it('handles mixed trains: 1 manual meter + 1 EM flow -> count is 2 (valid water balance)', () => {
    // Permeate is manual meter, Reject is EM
    const meterFlags = { feed: false, permeate: true, reject: true };
    const emFlags = { feedIsEM: false, permIsEM: false, rejIsEM: true };
    const count = countMeasuredStreams(
      meterFlags,
      emFlags,
      { feed: '', permeate: '3082857', reject: '' },
      { feed: '', permeate: '', reject: '37' },
    );
    expect(count).toBe(2);
    expect(count >= 2).toBe(true); // Valid! Feed can be inferred as Permeate + Reject
  });
});


