import { useMemo } from 'react';
import { useCan } from '@/hooks/usePermission';
import { buildNavConfig, type NavGroup } from '@/navConfig';

/** The navigation the signed-in user should see, custom-role overrides applied. */
export function useNavGroups(): NavGroup[] {
  const can = useCan();
  return useMemo(() => buildNavConfig(can), [can]);
}
