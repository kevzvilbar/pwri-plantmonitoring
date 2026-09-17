import { describe, it, expect } from 'vitest';
import { statusFromLastDt } from './useFleetStatus';

describe('useFleetStatus statusFromLastDt', () => {
  it('maps null/undefined to offline', () => {
    expect(statusFromLastDt(null)).toBe('offline');
    expect(statusFromLastDt(undefined)).toBe('offline');
  });

  it('maps recent readings to online (<2h)', () => {
    const dt = new Date(Date.now() - 30 * 60_000).toISOString();
    expect(statusFromLastDt(dt)).toBe('online');
  });

  it('maps 2–8h readings to stale', () => {
    const dt = new Date(Date.now() - 5 * 3_600_000).toISOString();
    expect(statusFromLastDt(dt)).toBe('stale');
  });

  it('maps old readings to offline', () => {
    const dt = new Date(Date.now() - 24 * 3_600_000).toISOString();
    expect(statusFromLastDt(dt)).toBe('offline');
  });
});
