/**
 * navTelemetry.ts: anonymous page-view telemetry for the IA review
 * (docs/IA-NAV-USERFLOW-CRITIQUE-AND-PLAN.md, IA0-1).
 *
 * What is recorded per view: a normalised route PATTERN (never a real id),
 * the `?tab=` value, the user's highest role, mobile or desktop, and a random
 * id that lives in sessionStorage (one per browser tab, gone when it closes).
 * Never recorded: user id, plant id, query values other than `tab`, free text.
 *
 * Telemetry must never affect the app: every failure is swallowed, nothing
 * goes through the offline outbox, and a lost batch is simply dropped.
 *
 * Off switches: VITE_NAV_TELEMETRY=off at build time, or the browser's
 * Do Not Track setting.
 */
import { supabase } from '@/integrations/supabase/client';

/** Every route in App.tsx. A path that matches none is reported as '/*'. */
export const ROUTE_PATTERNS = [
  '/', '/plants', '/plants/:id', '/plants/:id/wells/:wellId', '/hydraulics',
  '/operations', '/ro-trains', '/topology', '/data-analysis', '/costs',
  '/maintenance', '/incidents', '/employees', '/data-corrections',
  '/manager-scorecard', '/scorecard', '/import', '/exports', '/compliance',
  '/alerts', '/admin', '/profile', '/help', '/my-corrections', '/chemicals',
] as const;

const ROLE_PRIORITY = ['Admin', 'Manager', 'Data Analyst', 'Technician', 'Operator'] as const;
const TAB_RE = /^[a-z0-9-]{1,32}$/;
const FLUSH_AT = 10;
const MAX_QUEUE = 50;

export interface PageViewRow {
  session_id: string;
  route: string;
  tab: string | null;
  role: string | null;
  device: 'mobile' | 'desktop';
}

/** '/plants/3f2b…/wells/9a1c…' → '/plants/:id/wells/:wellId'. */
export function normalizeRoute(pathname: string): string {
  const path = (pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/');
  const segs = path.split('/').slice(1);
  for (const pattern of ROUTE_PATTERNS) {
    const pSegs = pattern === '/' ? [''] : pattern.split('/').slice(1);
    const aSegs = path === '/' ? [''] : segs;
    if (pSegs.length !== aSegs.length) continue;
    if (pSegs.every((p, i) => p.startsWith(':') || p === aSegs[i])) return pattern;
  }
  return '/*';
}

export function sanitizeTab(search: string): string | null {
  const raw = new URLSearchParams(search).get('tab');
  return raw && TAB_RE.test(raw) ? raw : null;
}

export function primaryRole(roles: readonly string[] | null | undefined): string | null {
  return ROLE_PRIORITY.find((r) => roles?.includes(r)) ?? null;
}

/** Same breakpoint as BottomNav (md:hidden = 768px). */
export function deviceClass(): 'mobile' | 'desktop' {
  try {
    return window.matchMedia('(max-width: 767px)').matches ? 'mobile' : 'desktop';
  } catch {
    return 'desktop';
  }
}

export function isTrackingEnabled(): boolean {
  if (import.meta.env.VITE_NAV_TELEMETRY === 'off') return false;
  try {
    const dnt = navigator.doNotTrack ?? (window as { doNotTrack?: string }).doNotTrack;
    if (dnt === '1' || dnt === 'yes') return false;
  } catch { /* ignore */ }
  return true;
}

let memorySessionId: string | null = null;
export function getSessionId(): string {
  try {
    const existing = sessionStorage.getItem('pwri.nav.sid');
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem('pwri.nav.sid', id);
    return id;
  } catch {
    memorySessionId ??= `m${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    return memorySessionId;
  }
}

let queue: PageViewRow[] = [];
let lastKey = '';

export function recordPageView(input: { pathname: string; search: string; role: string | null }): void {
  if (!isTrackingEnabled()) return;
  const route = normalizeRoute(input.pathname);
  const tab = sanitizeTab(input.search);
  const key = `${route}|${tab ?? ''}`;
  // Same page twice in a row (StrictMode double effect, auth settling): count once.
  if (key === lastKey) return;
  lastKey = key;
  queue.push({ session_id: getSessionId(), route, tab, role: input.role, device: deviceClass() });
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
  if (queue.length >= FLUSH_AT) void flushPageViews();
}

export async function flushPageViews(): Promise<void> {
  if (queue.length === 0) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return; // keep, retry later
  const batch = queue;
  queue = [];
  try {
    await supabase.from('nav_page_views').insert(batch);
  } catch {
    /* telemetry is best effort: drop the batch */
  }
}

/** Test helper. */
export function __resetNavTelemetryForTests(): void {
  queue = [];
  lastKey = '';
  memorySessionId = null;
}
export function __queueLengthForTests(): number {
  return queue.length;
}
