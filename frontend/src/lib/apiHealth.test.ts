import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  _resetApiHealth, gateRead, isBreakerOpen, isTransientBackendError, queryRetry,
  recordBackendFailure, recordBackendSuccess, backoffDelay,
} from './apiHealth';

describe('apiHealth', () => {
  beforeEach(() => _resetApiHealth());
  afterEach(() => vi.useRealTimers());

  it('classifies transient vs wrong-query errors', () => {
    expect(isTransientBackendError({ code: 'PGRST002', message: 'schema cache' })).toBe(true);
    expect(isTransientBackendError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isTransientBackendError({ message: 'Service Unavailable' })).toBe(true);
    expect(isTransientBackendError({ code: '42703', message: 'column x does not exist' })).toBe(false);
    expect(isTransientBackendError({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isTransientBackendError(null)).toBe(false);
  });

  it('retries outages at most twice, never wrong queries', () => {
    const outage = { code: 'PGRST002', message: 'x' };
    expect(queryRetry(0, outage)).toBe(true);
    expect(queryRetry(1, outage)).toBe(true);
    expect(queryRetry(2, outage)).toBe(false);
    expect(queryRetry(0, { code: '42703', message: 'column does not exist' })).toBe(false);
    expect(queryRetry(0, { code: 'PGRST301', message: 'JWT expired' })).toBe(true);
    expect(queryRetry(1, { code: 'PGRST301', message: 'JWT expired' })).toBe(false);
  });

  it('backs off exponentially with bounded jitter', () => {
    expect(backoffDelay(0, () => 0.5)).toBe(1000);
    expect(backoffDelay(1, () => 0.5)).toBe(2000);
    expect(backoffDelay(10, () => 0.5)).toBe(30_000);
    expect(backoffDelay(2, () => 0)).toBe(2000);
    expect(backoffDelay(2, () => 1)).toBe(6000);
  });

  it('trips after a failure burst, blocks reads, then allows exactly one probe', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    expect(gateRead()).toBe('allow');
    for (let i = 0; i < 8; i++) recordBackendFailure();
    expect(isBreakerOpen()).toBe(true);
    expect(gateRead()).toBe('block');

    vi.setSystemTime(1_000_000 + 31_000); // 30 s cooldown over
    expect(gateRead()).toBe('probe');
    expect(gateRead()).toBe('block'); // single-flight
    recordBackendSuccess();
    expect(isBreakerOpen()).toBe(false);
    expect(gateRead()).toBe('allow');
  });

  it('doubles the cooldown when the probe fails', () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    for (let i = 0; i < 8; i++) recordBackendFailure();
    vi.setSystemTime(2_000_000 + 31_000);
    expect(gateRead()).toBe('probe');
    recordBackendFailure(); // probe failed → 60 s
    vi.setSystemTime(2_000_000 + 31_000 + 59_000);
    expect(gateRead()).toBe('block');
    vi.setSystemTime(2_000_000 + 31_000 + 61_000);
    expect(gateRead()).toBe('probe');
  });

  it('does not trip on a few scattered failures', () => {
    vi.useFakeTimers();
    vi.setSystemTime(3_000_000);
    for (let i = 0; i < 7; i++) recordBackendFailure();
    expect(isBreakerOpen()).toBe(false);
    vi.setSystemTime(3_000_000 + 25_000); // window expired
    recordBackendFailure();
    expect(isBreakerOpen()).toBe(false);
  });
});

