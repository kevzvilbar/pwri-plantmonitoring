import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { _resetApiHealth, isBreakerOpen } from './apiHealth';
import { supabaseFetch } from './supabaseFetch';

const REST = 'https://x.supabase.co/rest/v1/wells?select=id';

describe('supabaseFetch', () => {
  beforeEach(() => _resetApiHealth());
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('short-circuits REST reads with a synthetic 503 once the breaker is open, without calling the network', async () => {
    const net = vi.fn(async () => new Response('', { status: 503 }));
    vi.stubGlobal('fetch', net);
    for (let i = 0; i < 8; i++) await supabaseFetch(REST);
    expect(isBreakerOpen()).toBe(true);
    net.mockClear();
    const res = await supabaseFetch(REST);
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('PGRST002');
    expect(net).not.toHaveBeenCalled();
  });

  it('never blocks writes or non-REST calls while open', async () => {
    const net = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', net);
    for (let i = 0; i < 8; i++) {
      net.mockResolvedValueOnce(new Response('', { status: 503 }));
      await supabaseFetch(REST);
    }
    expect(isBreakerOpen()).toBe(true);
    await supabaseFetch('https://x.supabase.co/rest/v1/wells', { method: 'POST', body: '{}' });
    await supabaseFetch('https://x.supabase.co/auth/v1/token');
    expect(net).toHaveBeenCalledTimes(10);
  });

  it('counts thrown network errors as failures but ignores aborts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    for (let i = 0; i < 8; i++) await supabaseFetch(REST).catch(() => {});
    expect(isBreakerOpen()).toBe(true);
    _resetApiHealth();
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw abort; }));
    for (let i = 0; i < 20; i++) await supabaseFetch(REST).catch(() => {});
    expect(isBreakerOpen()).toBe(false);
  });
});

