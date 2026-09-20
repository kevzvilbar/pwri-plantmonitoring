import { useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useMyCustomRole } from '@/hooks/useCustomRoles';
import { effectivePermission, hasPermission, type Action, type ModuleKey } from '@/lib/permissions';
import type { Can } from '@/navConfig';

// Effective-permission predicate for the signed-in user. Use this (or
// usePermission) for anything that shows or hides UI. Never call the base
// hasPermission() directly there: it ignores custom-role overrides.
//
// If the signed-in user's user_roles row carries a custom_role_id (set via
// the Admin → Roles editor), this resolves against that custom role's base
// role + overrides instead of the raw PERMISSION_MATRIX lookup — see
// effectivePermission() in lib/permissions.ts.
//
// Returns a stable function while roles and the custom role are unchanged,
// so it is safe in dependency arrays.
export function useCan(): Can {
  const { roles } = useAuth();
  const { data: custom } = useMyCustomRole();
  return useMemo<Can>(
    () => (moduleKey: ModuleKey, action: Action = 'view') =>
      custom
        ? effectivePermission(custom.role.base_role, custom.overrides, moduleKey, action)
        : hasPermission(roles, moduleKey, action),
    [roles, custom],
  );
}

// Drop-in replacement for ad hoc checks like `isManager || isAdmin`.
// Usage: const canEdit = usePermission('costs', 'edit');
export function usePermission(moduleKey: ModuleKey, action: Action = 'view'): boolean {
  return useCan()(moduleKey, action);
}
