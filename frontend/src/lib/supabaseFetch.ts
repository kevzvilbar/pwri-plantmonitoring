/**
 * supabaseFetch.ts — fetch wrapper handed to supabase-js (`global.fetch`).
 *
 * Feeds the circuit breaker in apiHealth.ts and, while the breaker is open,
 * answers REST *reads* locally with a synthetic 503 instead of calling the
 * network. Writes, auth, storage and realtime are never blocked.
 */
import { gateRead, recordBackendFailure, recordBackendSuccess } from '@/lib/apiHealth';

const REST_MARKER = '/rest/v1/';

function describe(input: RequestInfo | URL, init?: RequestInit): { isRestRead: boolean } {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? (input as Request).method : 'GET') ?? 'GET').toUpperCase();
  return { isRestRead: url.includes(REST_MARKER) && (method === 'GET' || method === 'HEAD') };
}

function blockedResponse(): Response {
  return new Response(
    JSON.stringify({
      code: 'PGRST002',
      details: null,
      hint: null,
      message: 'Backend temporarily unavailable (client circuit breaker). Retrying shortly.',
    }),
    { status: 503, statusText: 'Service Unavailable', headers: { 'Content-Type': 'application/json' } },
  );
}

export const supabaseFetch: typeof fetch = async (input, init) => {
  const { isRestRead } = describe(input, init);
  let gate: ReturnType<typeof gateRead> = 'allow';
  if (isRestRead) {
    gate = gateRead();
    if (gate === 'block') return blockedResponse();
  }

  try {
    const res = await fetch(input, init);
    if (isRestRead || gate === 'probe') {
      if (res.status >= 500) recordBackendFailure();
      else recordBackendSuccess();
    }
    return res;
  } catch (err) {
    // Network failure / DNS / CORS-preflight rejection. Aborts are navigation noise.
    const aborted = (err as { name?: string })?.name === 'AbortError';
    if (!aborted && (isRestRead || gate === 'probe')) recordBackendFailure();
    else if (gate === 'probe') recordBackendSuccess(); // don't leave the probe flag stuck on abort
    throw err;
  }
};

