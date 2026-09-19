import type { EmailChangeTarget } from '@/components/EmailChangeDialog';

export const ALL_ROLES = ['Operator', 'Technician', 'Manager', 'Data Analyst', 'Admin'] as const;
export type AppRole = typeof ALL_ROLES[number];

export const ROLE_ORDER: AppRole[] = ['Admin', 'Data Analyst', 'Manager', 'Technician', 'Operator'];

export const ROLE_PLURAL: Record<AppRole, string> = {
  Admin: 'Admins',
  'Data Analyst': 'Data Analysts',
  Manager: 'Managers',
  Technician: 'Technicians',
  Operator: 'Operators',
};

export const CARD_ROLES: AppRole[] = ['Admin', 'Data Analyst', 'Manager'];
export const TABLE_ROLES: AppRole[] = ['Technician', 'Operator'];
export const OPERATORS_PER_PAGE = 8;

export const ROLE_AVATAR: Record<string, string> = {
  Admin:           'bg-role-admin/15 text-role-admin',
  'Data Analyst':  'bg-role-analyst/15 text-role-analyst',
  Manager:         'bg-role-manager/15 text-role-manager',
  Technician:      'bg-role-technician/15 text-role-technician',
  Operator:        'bg-muted text-muted-foreground',
  'No role':       'bg-muted text-muted-foreground',
};

export const ROLE_PILL: Record<string, string> = {
  Admin:          'bg-role-admin/15 text-role-admin border-role-admin/30',
  'Data Analyst': 'bg-role-analyst/15 text-role-analyst border-role-analyst/30',
  Manager:        'bg-role-manager/15 text-role-manager border-role-manager/30',
  Technician:     'bg-role-technician/15 text-role-technician border-role-technician/30',
  Operator:       'bg-muted text-muted-foreground border-border/60',
  'No role':      'bg-muted text-muted-foreground border-border/60',
};

export function initials(first?: string, last?: string, username?: string): string {
  if (first && last) return `${first[0]}${last[0]}`.toUpperCase();
  if (first) return first.slice(0, 2).toUpperCase();
  if (username) return username.slice(0, 2).toUpperCase();
  return '??';
}

export function primaryRole(roles: string[]): AppRole | null {
  for (const r of ROLE_ORDER) if (roles.includes(r)) return r;
  return null;
}

export function displayName(s: any): string {
  return `${s.first_name ?? ''} ${s.last_name ?? ''} ${s.suffix ?? ''}`.trim() || (s.username ?? '—');
}

export function userLabel(s: any): string {
  return `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim() || (s.username ?? 'user');
}

export const SETUP_SQL = `-- Run once in Supabase Dashboard → SQL Editor
create or replace function public.admin_set_user_password(
  _user_id uuid, _new_password text
)
returns void language plpgsql security definer
set search_path = extensions, public, auth as $$
begin
  if not exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'Admin'
  ) then
    raise exception 'Permission denied: Admin role required';
  end if;
  update auth.users
  set encrypted_password = crypt(_new_password, gen_salt('bf'))
  where id = _user_id;
end;
$$;
grant execute on function public.admin_set_user_password(uuid, text) to authenticated;`;
