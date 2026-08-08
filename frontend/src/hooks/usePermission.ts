import { useAuth } from '@/hooks/useAuth';
import { useMyCustomRole } from '@/hooks/useCustomRoles';
import { effectivePermission, hasPermission, type Action, type ModuleKey } from '@/lib/permissions';

// Drop-in replacement for ad hoc checks like `isManager || isAdmin`.
// Usage: const canEdit = usePermission('costs', 'edit');
//
// If the signed-in user's user_roles row carries a custom_role_id (set via
// the Admin → Roles editor), this resolves against that custom role's base
// role + overrides instead of the raw PERMISSION_MATRIX lookup — see
// effectivePermission() in lib/permissions.ts.
export function usePermission(moduleKey: ModuleKey, action: Action = 'view'): boolean {
  const { roles } = useAuth();
  const { data: custom } = useMyCustomRole();
  if (custom) return effectivePermission(custom.role.base_role, custom.overrides, moduleKey, action);
  return hasPermission(roles, moduleKey, action);
}
