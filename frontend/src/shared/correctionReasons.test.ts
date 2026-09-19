import { describe, it, expect } from 'vitest';
import {
  CORRECTION_REASONS,
  MIN_CUSTOM_REASON_LENGTH,
  MIN_FINGERPRINT_LETTERS,
  isReasonComplete,
  resolveReason,
} from './correctionReasons';

// Every "Reason for this edit" surface (CorrectionRequestDialog,
// DataCorrections.tsx's EditValueModal, CorrectionReasonField and all of its
// callers, ReasonDialog, TrainLogModal's timing fix) gates its Save/Confirm
// button on isReasonComplete() and stores resolveReason()'s output. These
// tests pin the two rules that gate is meant to enforce:
//   1. a category must be picked, and
//   2. when 'Other' is picked, the free-text explanation must be a real one
//      (long enough AND containing a letter), not "" / "a" / "12345".

describe('CORRECTION_REASONS', () => {
  it('exposes "Other" exactly once, since isReasonComplete/resolveReason branch on that literal', () => {
    expect(CORRECTION_REASONS.filter((r) => r === 'Other')).toHaveLength(1);
  });

  it('has no duplicate options (a duplicate would render twice in every Select)', () => {
    expect(new Set(CORRECTION_REASONS).size).toBe(CORRECTION_REASONS.length);
  });
});

describe('resolveReason', () => {
  it('returns the preset reason unchanged when it is not "Other"', () => {
    expect(resolveReason('Data entry typo — extra/missing digit', 'ignored')).toBe(
      'Data entry typo — extra/missing digit',
    );
  });

  it('folds the free-text detail into the stored reason for "Other"', () => {
    expect(resolveReason('Other', 'Meter display was blank')).toBe('Meter display was blank');
  });

  it('trims the free-text detail before folding it in', () => {
    expect(resolveReason('Other', '   Meter display was blank   ')).toBe('Meter display was blank');
  });

  it('is a fold, not a validator — an unexplained "Other" still resolves to the bare literal', () => {
    // Documented footgun in the source: callers MUST gate on isReasonComplete()
    // first. This test exists so the behaviour can't change silently.
    expect(resolveReason('Other', '')).toBe('Other');
    expect(resolveReason('Other', '   ')).toBe('Other');
  });
});

describe('isReasonComplete — category selection', () => {
  it('is false when no category has been picked', () => {
    expect(isReasonComplete('', '')).toBe(false);
    expect(isReasonComplete('', 'some detail typed first')).toBe(false);
  });

  it('is true for a preset category even with no free-text detail', () => {
    for (const reason of CORRECTION_REASONS) {
      if (reason === 'Other') continue;
      expect(isReasonComplete(reason, '')).toBe(true);
    }
  });

  it('is false for a category with no letters at all (e.g. a stray numeric code)', () => {
    expect(isReasonComplete('12345', '')).toBe(false);
    expect(isReasonComplete('---', '')).toBe(false);
  });
});

describe('isReasonComplete — "Other" free-text requirement', () => {
  it('is false when "Other" is picked and the detail is empty or whitespace only', () => {
    expect(isReasonComplete('Other', '')).toBe(false);
    expect(isReasonComplete('Other', '     ')).toBe(false);
  });

  it('enforces the shared MIN_CUSTOM_REASON_LENGTH boundary after trimming', () => {
    const short = 'a'.repeat(MIN_CUSTOM_REASON_LENGTH - 1);
    const exact = 'a'.repeat(MIN_CUSTOM_REASON_LENGTH);
    expect(exact).toHaveLength(5); // guards against MIN_CUSTOM_REASON_LENGTH drifting silently
    expect(isReasonComplete('Other', short)).toBe(false);
    expect(isReasonComplete('Other', exact)).toBe(true);
    // Whitespace padding must not be what pushes a too-short detail over the line.
    expect(isReasonComplete('Other', `   ${short}   `)).toBe(false);
  });

  it('rejects a long-enough detail that is digits/punctuation only', () => {
    expect(isReasonComplete('Other', '12345')).toBe(false);
    expect(isReasonComplete('Other', '#####')).toBe(false);
    expect(isReasonComplete('Other', '12345 !!! 67890')).toBe(false);
  });

  it('accepts a long-enough detail that contains a single letter alongside digits/punctuation', () => {
    expect(isReasonComplete('Other', 'meter 2')).toBe(true);
    expect(isReasonComplete('Other', '1234a')).toBe(true);
  });

  it('accepts an ordinary explanation', () => {
    expect(isReasonComplete('Other', 'Blank display, awaiting new meter')).toBe(true);
  });

  it('ignores the detail entirely for every preset reason', () => {
    // The detail textarea/input is only rendered when 'Other' is selected, so a
    // stale value left over from a previous 'Other' pick must not affect a preset.
    expect(isReasonComplete('Meter replaced — baseline reset', '')).toBe(true);
    expect(isReasonComplete('Meter replaced — baseline reset', '12345')).toBe(true);
  });
});

describe('MIN_FINGERPRINT_LETTERS', () => {
  it('is the documented minimum of one letter', () => {
    expect(MIN_FINGERPRINT_LETTERS).toBe(1);
  });
});