import { describe, it, expect } from 'vitest';
import { AUTO_OFFLINE_THRESHOLD_HOURS, shouldAutoFlagTrainOffline } from './useTrainAutoOffline';

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

