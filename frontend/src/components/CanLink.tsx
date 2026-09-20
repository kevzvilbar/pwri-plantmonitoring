import type { ReactNode } from 'react';
import { useCan } from '@/hooks/usePermission';
import type { Action, ModuleKey } from '@/lib/permissions';

/**
 * Phase 2 (P2-1): permission-gated wrapper so pages never show a link/button
 * the signed-in user cannot open. Uses useCan() (effective permission with
 * custom-role overrides), never base hasPermission() directly.
 *
 * Renders nothing when the user lacks `action` on `module`.
 */
export function CanLink({
  module,
  action = 'view',
  children,
}: {
  module: ModuleKey;
  action?: Action;
  children: ReactNode;
}) {
  const can = useCan();
  if (!can(module, action)) return null;
  return <>{children}</>;
}
