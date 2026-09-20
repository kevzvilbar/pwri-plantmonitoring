// Which in-app page each manual chapter describes. The reader's "Open module"
// button goes there, but only when the user is allowed to open that page (see
// canOpenRoute in navConfig.ts). The map itself knows nothing about roles.
export const CHAPTER_ROUTE_MAP: Record<string, string> = {
  dashboard: '/',
  plants: '/plants',
  operations: '/operations',
  'ro-trains': '/ro-trains',
  topology: '/topology',
  'pm-schedule': '/maintenance',
  incidents: '/incidents',
  costs: '/costs',
  employees: '/employees',
  'smart-import': '/import',
  exports: '/exports',
  'data-analysis': '/data-analysis',
  'data-corrections': '/data-corrections',
  'manager-scorecard': '/manager-scorecard',
  'alerts-triage': '/alerts',
  compliance: '/compliance',
  'admin-console': '/admin',
  profile: '/profile',
};

/**
 * Absolute link that opens the manual at a chapter: /help?chapter=<id>.
 * The router runs under `basename={BASE_URL}`, so the link must include it.
 */
export function chapterLink(
  chapterId: string,
  origin: string = window.location.origin,
  base: string = import.meta.env.BASE_URL,
): string {
  const root = base.endsWith('/') ? base : `${base}/`;
  return `${origin}${root}help?chapter=${encodeURIComponent(chapterId)}`;
}
