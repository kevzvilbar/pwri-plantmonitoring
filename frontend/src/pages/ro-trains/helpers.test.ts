import { describe, it, expect } from 'vitest';
import { canEditEntry, EDIT_WINDOW_HOURS, deriveTrainStatus } from './helpers';

// Covers canEditEntry's permission model, including the noTimeLimit
// parameter added for the 2026-08-18 fix: Kevz asked for the reading-edit
// time window removed specifically for RO Train / Pretreatment readings
// (EditRoReadingDialog.tsx, EditPretreatReadingDialog.tsx, TrainLogModal.tsx
// all now pass noTimeLimit=true), while every other reading type
// (well/locator/power/product/blending/CIP/dosing) keeps the default 8h
// window unchanged, since none of those callers pass the new argument.

const OPERATOR_ID = 'operator-1';
const OTHER_OPERATOR_ID = 'operator-2';

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

describe('canEditEntry', () => {
  it('full-access roles can always edit, regardless of owner, age, or noTimeLimit', () => {
    const row = { recorded_by: OTHER_OPERATOR_ID, created_at: hoursAgo(1000) };
    expect(canEditEntry(row, true, OPERATOR_ID)).toBe(true);
    expect(canEditEntry(row, true, OPERATOR_ID, true)).toBe(true);
  });

  it('blocks editing someone else\'s entry for non-full-access roles', () => {
    const row = { recorded_by: OTHER_OPERATOR_ID, created_at: hoursAgo(1) };
    expect(canEditEntry(row, false, OPERATOR_ID)).toBe(false);
    expect(canEditEntry(row, false, OPERATOR_ID, true)).toBe(false);
  });

  it('blocks a pending-review entry even with noTimeLimit — removing the time window is not the same as bypassing an active review', () => {
    const row = { recorded_by: OPERATOR_ID, created_at: hoursAgo(1), norm_status: 'pending_review' };
    expect(canEditEntry(row, false, OPERATOR_ID)).toBe(false);
    expect(canEditEntry(row, false, OPERATOR_ID, true)).toBe(false);
  });

  describe('default behavior (noTimeLimit omitted) — every reading type except RO Train/Pretreatment', () => {
    it('allows editing an own entry within the window', () => {
      const row = { recorded_by: OPERATOR_ID, created_at: hoursAgo(EDIT_WINDOW_HOURS - 1) };
      expect(canEditEntry(row, false, OPERATOR_ID)).toBe(true);
    });

    it('blocks editing an own entry past the window', () => {
      const row = { recorded_by: OPERATOR_ID, created_at: hoursAgo(EDIT_WINDOW_HOURS + 1) };
      expect(canEditEntry(row, false, OPERATOR_ID)).toBe(false);
    });
  });

  describe('noTimeLimit=true — RO Train / Pretreatment readings only', () => {
    it('allows editing an own entry well past the normal window', () => {
      const row = { recorded_by: OPERATOR_ID, created_at: hoursAgo(EDIT_WINDOW_HOURS * 100) };
      expect(canEditEntry(row, false, OPERATOR_ID, true)).toBe(true);
    });

    it('allows editing an own entry with no created_at at all (age is irrelevant once the window is off)', () => {
      const row = { recorded_by: OPERATOR_ID, created_at: null };
      expect(canEditEntry(row, false, OPERATOR_ID, true)).toBe(true);
    });
  });
});

describe('deriveTrainStatus', () => {
  it('returns Offline when train is null or undefined', () => {
    expect(deriveTrainStatus(null, null)).toBe('Offline');
  });

  it('preserves explicit Maintenance status regardless of readings', () => {
    const train = { status: 'Maintenance' };
    const recent = { reading_datetime: new Date().toISOString() };
    expect(deriveTrainStatus(train, recent)).toBe('Maintenance');
    expect(deriveTrainStatus(train, null)).toBe('Maintenance');
  });

  it('preserves explicit Offline status even if recent reading exists', () => {
    const train = { status: 'Offline' };
    const recent = { reading_datetime: new Date().toISOString() };
    expect(deriveTrainStatus(train, recent)).toBe('Offline');
  });

  it('marks train as Running if last reading is within 1 hour', () => {
    const train = { status: 'Running' };
    const reading30m = { reading_datetime: new Date(Date.now() - 30 * 60 * 1000).toISOString() };
    expect(deriveTrainStatus(train, reading30m)).toBe('Running');

    const reading59m = { reading_datetime: new Date(Date.now() - 59 * 60 * 1000).toISOString() };
    expect(deriveTrainStatus(train, reading59m)).toBe('Running');
  });

  it('auto-flags train as Offline if last reading is older than 1 hour', () => {
    const train = { status: 'Running' };
    const reading61m = { reading_datetime: new Date(Date.now() - 61 * 60 * 1000).toISOString() };
    expect(deriveTrainStatus(train, reading61m)).toBe('Offline');

    const reading2h = { reading_datetime: new Date(Date.now() - 2 * 3600 * 1000).toISOString() };
    expect(deriveTrainStatus(train, reading2h)).toBe('Offline');
  });

  it('auto-flags train as Offline if no readings exist at all', () => {
    const train = { status: 'Running' };
    expect(deriveTrainStatus(train, null)).toBe('Offline');
    expect(deriveTrainStatus(train, {})).toBe('Offline');
  });
});
