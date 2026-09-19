import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/components/ui/sonner';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectSeparator,
} from '@/components/ui/select';
import { useCustomRoles } from '@/hooks/useCustomRoles';
import { friendlyError } from '@/lib/supabaseErrors';
import { ALL_ROLES, type AppRole, primaryRole } from './constants';
import { OPERATOR_DESIGNATION, accessLevelFromRoles } from '@/components/DesignationCombobox';

function RoleSelector({ userId, currentRoles, onChanged }: {
  userId: string;
  currentRoles: string[];
  onChanged: () => void;
}) {
  const pRole: AppRole = primaryRole(currentRoles) ?? 'Operator';
  const { data: customRoles = [] } = useCustomRoles();

  const { data: currentCustomRoleId } = useQuery({
    queryKey: ['user-custom-role-id', userId],
    queryFn: async () => {
      const { data } = await supabase.from('user_roles').select('custom_role_id').eq('user_id', userId).maybeSingle();
      return data?.custom_role_id ?? null;
    },
  });

  const value = currentCustomRoleId ? `custom:${currentCustomRoleId}` : pRole;

  const handleChange = async (v: string) => {
    if (v === value) return;
    const isCustom = v.startsWith('custom:');
    const customRole = isCustom ? customRoles.find((r) => r.id === v.slice('custom:'.length)) : undefined;
    if (isCustom && !customRole) return;
    const newRole: AppRole = isCustom ? (customRole!.base_role as AppRole) : (v as AppRole);

    const { error: delErr } = await supabase.from('user_roles').delete().eq('user_id', userId);
    if (delErr) { toast.error(friendlyError(delErr)); return; }
    const { error: insErr } = await supabase.from('user_roles').insert({
      user_id: userId,
      role: newRole,
      custom_role_id: isCustom ? customRole!.id : null,
    });
    if (insErr) { toast.error(friendlyError(insErr)); return; }
    toast.success(`Role updated to ${isCustom ? customRole!.name : newRole}`);
    onChanged();
  };

  return (
    <Select value={value} onValueChange={handleChange}>
      <SelectTrigger className="h-7 text-xs w-36"><SelectValue /></SelectTrigger>
      <SelectContent>
        {ALL_ROLES.map((r) => (
          <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>
        ))}
        {customRoles.length > 0 && (
          <>
            <SelectSeparator />
            {customRoles.map((cr) => (
              <SelectItem key={cr.id} value={`custom:${cr.id}`} className="text-xs">{cr.name}</SelectItem>
            ))}
          </>
        )}
      </SelectContent>
    </Select>
  );
}

export { RoleSelector };
