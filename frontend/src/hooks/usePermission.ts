import { useAuth } from '@/hooks/useAuth';
import { hasPermission, type Action, type ModuleKey } from '@/lib/permissions';

// Drop-in replacement for ad hoc checks like `isManager || isAdmin`.
// Usage: const canEdit = usePermission('costs', 'edit');
export function usePermission(moduleKey: ModuleKey, action: Action = 'view'): boolean {
  const { roles } = useAuth();
  return hasPermission(roles, moduleKey, action);
}
