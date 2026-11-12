export const DEFAULT_DESIGNATIONS = [
  'Admin',
  'Manager',
  'Supervisor',
  'Operator',
  'Maintenance',
  'Quality Assurance',
  'Data Analyst',
] as const;

export type DefaultDesignation = typeof DEFAULT_DESIGNATIONS[number];

/** The only designation that uses shared-email / multi-username sign-up. */
export const OPERATOR_DESIGNATION = 'Operator' as const;

/** Designations that get unique email + multi-plant support. */
export const NON_OPERATOR_DESIGNATIONS: DefaultDesignation[] = [
  'Admin', 'Manager', 'Supervisor', 'Maintenance', 'Quality Assurance', 'Data Analyst',
];

/**
 * Derive a coarse-grained access level badge from the user's roles.
 * Admin → Full access, Data Analyst → Analyst, Manager → Elevated,
 * Supervisor/Maintenance/QA → Limited, Operator/other → Restricted.
 */
export function accessLevelFromRoles(roles: string[] | undefined | null): {
  label: string;
  tone: 'accent' | 'warn' | 'muted';
} {
  const r = new Set((roles ?? []).map((x) => x.toLowerCase()));
  if (r.has('admin')) return { label: 'Full access', tone: 'accent' };
  if (r.has('data analyst')) return { label: 'Analyst', tone: 'accent' };
  if (r.has('manager')) return { label: 'Elevated', tone: 'accent' };
  if (r.has('supervisor')) return { label: 'Limited', tone: 'warn' };
  return { label: 'Restricted', tone: 'muted' };
}
