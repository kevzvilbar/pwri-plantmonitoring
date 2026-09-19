import { describe, it, expect } from 'vitest';
import { missingRequiredMeters, trainMeterFlags } from './trainMeterPresence';

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
