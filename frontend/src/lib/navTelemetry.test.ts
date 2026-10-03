import { beforeEach, describe, expect, it, vi } from 'vitest';

const insert = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: vi.fn(() => ({ insert })) },
}));

import {
  ROUTE_PATTERNS, __queueLengthForTests, __resetNavTelemetryForTests, flushPageViews,
  isTrackingEnabled, normalizeRoute, primaryRole, recordPageView, sanitizeTab,
} from './navTelemetry';

const UUID = '3f2b9c1e-1111-4222-8333-444455556666';

beforeEach(() => {
  __resetNavTelemetryForTests();
  insert.mockReset();
  insert.mockResolvedValue({ error: null });
  sessionStorage.clear();
});

describe('normalizeRoute', () => {
  it('replaces ids with parameter names', () => {
    expect(normalizeRoute(`/plants/${UUID}`)).toBe('/plants/:id');
    expect(normalizeRoute(`/plants/${UUID}/wells/${UUID}`)).toBe('/plants/:id/wells/:wellId');
  });
  it('keeps static routes, ignores trailing slash, query and hash', () => {
    expect(normalizeRoute('/')).toBe('/');
    expect(normalizeRoute('/costs/')).toBe('/costs');
    expect(normalizeRoute('/costs?tab=budget#x')).toBe('/costs');
  });
  it('reports unknown paths as /* and never echoes them', () => {
    expect(normalizeRoute(`/secret/${UUID}`)).toBe('/*');
  });
  it('every pattern maps to itself', () => {
    for (const p of ROUTE_PATTERNS) {
      expect(normalizeRoute(p.replace(':id', UUID).replace(':wellId', UUID))).toBe(p);
    }
  });
});

describe('sanitizeTab / primaryRole', () => {
  it('accepts simple tab ids only', () => {
    expect(sanitizeTab('?tab=budget')).toBe('budget');
    expect(sanitizeTab('?tab=Bad Value')).toBeNull();
    expect(sanitizeTab('?tab=' + 'a'.repeat(40))).toBeNull();
    expect(sanitizeTab('?plant=abc')).toBeNull();
  });
  it('picks the highest role', () => {
    expect(primaryRole(['Operator', 'Manager'])).toBe('Manager');
    expect(primaryRole(['Operator'])).toBe('Operator');
    expect(primaryRole([])).toBeNull();
  });
});

describe('recordPageView / flushPageViews', () => {
  it('queues a row with no ids and flushes it in one insert', async () => {
    recordPageView({ pathname: `/plants/${UUID}`, search: `?tab=wells&plant=${UUID}`, role: 'Manager' });
    await flushPageViews();
    expect(insert).toHaveBeenCalledTimes(1);
    const [rows] = insert.mock.calls[0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ route: '/plants/:id', tab: 'wells', role: 'Manager', device: 'desktop' });
    expect(JSON.stringify(rows)).not.toContain(UUID);
    expect(Object.keys(rows[0]).sort()).toEqual(['device', 'role', 'route', 'session_id', 'tab']);
  });
  it('counts the same page twice in a row once, but a return visit again', () => {
    const view = (pathname: string) => recordPageView({ pathname, search: '', role: null });
    view('/alerts'); view('/alerts'); view('/costs'); view('/alerts');
    expect(__queueLengthForTests()).toBe(3);
  });
  it('flushes automatically at 10 rows', () => {
    for (let i = 0; i < 10; i++) {
      recordPageView({ pathname: i % 2 ? '/alerts' : '/costs', search: '', role: null });
    }
    expect(insert).toHaveBeenCalledTimes(1);
    expect(__queueLengthForTests()).toBe(0);
  });
  it('swallows insert failures and drops the batch', async () => {
    insert.mockRejectedValue(new Error('boom'));
    recordPageView({ pathname: '/alerts', search: '', role: null });
    await expect(flushPageViews()).resolves.toBeUndefined();
    expect(__queueLengthForTests()).toBe(0);
  });
  it('keeps the queue while offline', async () => {
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    recordPageView({ pathname: '/alerts', search: '', role: null });
    await flushPageViews();
    expect(insert).not.toHaveBeenCalled();
    expect(__queueLengthForTests()).toBe(1);
    spy.mockRestore();
  });
  it('reuses one session id per tab', async () => {
    recordPageView({ pathname: '/alerts', search: '', role: null });
    recordPageView({ pathname: '/costs', search: '', role: null });
    await flushPageViews();
    const [rows] = insert.mock.calls[0];
    expect(rows[0].session_id).toBe(rows[1].session_id);
    expect(rows[0].session_id.length).toBeGreaterThanOrEqual(8);
  });
});

describe('opt-out', () => {
  it('records nothing when Do Not Track is on', () => {
    // jsdom has no navigator.doNotTrack, so define it for this test only.
    Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true });
    try {
      expect(isTrackingEnabled()).toBe(false);
      recordPageView({ pathname: '/alerts', search: '', role: null });
      expect(__queueLengthForTests()).toBe(0);
    } finally {
      delete (navigator as { doNotTrack?: string }).doNotTrack;
    }
    expect(isTrackingEnabled()).toBe(true);
  });
});
