import { describe, it, expect } from 'vitest';
import { describeFreshness } from './freshness';

const MINUTE = 60_000;
const HOUR   = 60 * MINUTE;

// Use a fixed "now" for all tests to avoid timing flakiness.
const NOW = new Date('2026-09-20T10:00:00.000Z').getTime();

function tsAt(msAgo: number): Date {
  return new Date(NOW - msAgo);
}

describe('describeFreshness', () => {
  it('returns unknown for null timestamp', () => {
    const result = describeFreshness(null, NOW);
    expect(result.tone).toBe('unknown');
    expect(result.label).toBe('No recent readings');
  });

  it('returns unknown for undefined timestamp', () => {
    const result = describeFreshness(undefined, NOW);
    expect(result.tone).toBe('unknown');
  });

  it('returns fresh for a reading 45 min ago', () => {
    const result = describeFreshness(tsAt(45 * MINUTE), NOW);
    expect(result.tone).toBe('fresh');
    expect(result.label).toContain('Updated');
    expect(result.label).toContain('45 min ago');
  });

  it('returns aging for a reading 2 h ago', () => {
    const result = describeFreshness(tsAt(2 * HOUR), NOW);
    expect(result.tone).toBe('aging');
    expect(result.label).toContain('2 h ago');
  });

  it('returns stale for a reading 5 h ago', () => {
    const result = describeFreshness(tsAt(5 * HOUR), NOW);
    expect(result.tone).toBe('stale');
    expect(result.label).toContain('5 h ago');
  });

  it('boundary: exactly 90 min ago is aging (not fresh)', () => {
    const result = describeFreshness(tsAt(90 * MINUTE), NOW);
    expect(result.tone).toBe('aging');
  });

  it('boundary: exactly 4 h ago is stale (not aging)', () => {
    const result = describeFreshness(tsAt(4 * HOUR), NOW);
    expect(result.tone).toBe('stale');
  });

  it('clamps future timestamps (clock skew) to fresh with 0-age label', () => {
    // timestamp 1 minute in the future — ageMs clamped to 0 → fresh
    const result = describeFreshness(tsAt(-1 * MINUTE), NOW);
    expect(result.tone).toBe('fresh');
    expect(result.label).toContain('1 min ago');
  });
});

