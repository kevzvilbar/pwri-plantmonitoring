// Routes an Operator is allowed to visit. Everything else redirects to /.
// Maintained by hand; checked by navConfig.test.ts (P1-6) against
// buildNavConfig output: an Operator-visible nav item whose route is missing
// from this list fails the test. P1-7 would derive this from ROUTE_MAP + nav items directly, but the test ensures this list stays in sync.
export const OPERATOR_ALLOWED_PATHS = [
  '/',
  '/plants',
  '/hydraulics',
  '/operations',
  '/ro-trains',
  '/maintenance',
  '/incidents',
  '/employees',
  '/profile',
  '/help',  // The manual: opened from every role's avatar menu
  '/my-corrections',  // Operators raise correction requests, so they follow them up
  '/alerts',  // Added: Operators receive alarms and need to triage them
];
