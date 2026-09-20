/**
 * Phase 2 (P2-5): post-login redirect that preserves deep links.
 *
 * ProtectedRoute saves `{ from: location }` when bouncing to /auth.
 * AuthPage/LoginForm must send the user back to `pathname + search + hash`,
 * not bare '/'. Only same-origin absolute paths are accepted — anything else
 * (relative, protocol-relative `//host`, scheme, empty) falls back so a
 * crafted `from` can never become an open redirect.
 */
export function getPostLoginPath(from: unknown, fallback = '/'): string {
  const loc = from as { pathname?: unknown; search?: unknown; hash?: unknown } | null | undefined;
  const pathname = typeof loc?.pathname === 'string' ? loc.pathname : '';
  // Same-origin absolute path only. Rejects '', 'a/b', '//evil', and any
  // backslash (browsers normalize '/\evil' to '//evil' — a protocol-relative
  // URL — so '/\evil.com' must not pass as a "safe" in-app path).
  if (!pathname.startsWith('/')) return fallback;
  const second = pathname.slice(1, 2);
  if (second === '/' || second === '\\') return fallback;
  if (pathname.includes('\\')) return fallback;
  // Encoded slashes/backslashes could smuggle the same bypass.
  const lowered = pathname.toLowerCase();
  if (lowered.includes('%2f') || lowered.includes('%5c')) return fallback;
  const rawSearch = typeof loc?.search === 'string' ? loc.search : '';
  const rawHash = typeof loc?.hash === 'string' ? loc.hash : '';
  const search = rawSearch.startsWith('?') ? rawSearch : '';
  const hash = rawHash.startsWith('#') ? rawHash : '';
  return `${pathname}${search}${hash}`;
}
