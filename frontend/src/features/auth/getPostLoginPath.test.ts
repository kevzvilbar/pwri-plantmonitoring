import { describe, it, expect } from 'vitest';
import { getPostLoginPath } from '@/features/auth/getPostLoginPath';

describe('getPostLoginPath (P2-5)', () => {
  it('preserves pathname + query + hash', () => {
    expect(
      getPostLoginPath({ pathname: '/data-corrections', search: '?tab=history', hash: '#row-1' }),
    ).toBe('/data-corrections?tab=history#row-1');
  });

  it('keeps bare pathnames and drops malformed search/hash', () => {
    expect(getPostLoginPath({ pathname: '/alerts' })).toBe('/alerts');
    expect(getPostLoginPath({ pathname: '/alerts', search: 'tab=x', hash: 'x' })).toBe('/alerts');
  });

  it('rejects open redirects and falls back to /', () => {
    for (const from of [
      undefined,
      null,
      {},
      { pathname: '' },
      { pathname: 'relative/path' },
      { pathname: '//evil.com/phish' },
      { pathname: 'https://evil.com/' },
      { pathname: '/\\evil.com' },
    ]) {
      expect(getPostLoginPath(from), JSON.stringify(from)).toBe('/');
    }
  });

  it('honours a custom fallback', () => {
    expect(getPostLoginPath(undefined, '/onboarding')).toBe('/onboarding');
  });
});
