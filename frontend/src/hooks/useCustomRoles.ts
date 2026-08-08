import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { Action, CustomRole, ModuleKey, RoleOverride } from '@/lib/permissions';

// ── List all custom roles (used by the Roles admin tab + the role picker
//    in UsersPanel's RoleSelector) ───────────────────────────────────────────
export function useCustomRoles() {
  return useQuery({
    queryKey: ['custom-roles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('custom_roles')
        .select('id, name, base_role, description')
        .order('name');
      if (error) throw error;
      return (data ?? []) as CustomRole[];
    },
  });
}

// ── Overrides for one custom role ────────────────────────────────────────────
export function useCustomRoleOverrides(customRoleId: string | null) {
  return useQuery({
    queryKey: ['custom-role-overrides', customRoleId],
    enabled: !!customRoleId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('custom_role_overrides')
        .select('module_key, action, allowed')
        .eq('custom_role_id', customRoleId!);
      if (error) throw error;
      return (data ?? []) as RoleOverride[];
    },
  });
}

// ── The signed-in user's own custom role (if their user_roles row carries
//    one) — this is what usePermission() layers on top of PERMISSION_MATRIX.
export function useMyCustomRole() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-custom-role', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<{ role: CustomRole; overrides: RoleOverride[] } | null> => {
      const { data: ur, error: urErr } = await supabase
        .from('user_roles')
        .select('custom_role_id')
        .eq('user_id', user!.id)
        .not('custom_role_id', 'is', null)
        .maybeSingle();
      if (urErr) throw urErr;
      if (!ur?.custom_role_id) return null;

      const [{ data: role, error: roleErr }, { data: overrides, error: ovErr }] = await Promise.all([
        supabase.from('custom_roles').select('id, name, base_role, description').eq('id', ur.custom_role_id).maybeSingle(),
        supabase.from('custom_role_overrides').select('module_key, action, allowed').eq('custom_role_id', ur.custom_role_id),
      ]);
      if (roleErr) throw roleErr;
      if (ovErr) throw ovErr;
      if (!role) return null;
      return { role: role as CustomRole, overrides: (overrides ?? []) as RoleOverride[] };
    },
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────

export function useCreateCustomRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; base_role: CustomRole['base_role']; description?: string }) => {
      const { data: actor } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('custom_roles')
        .insert({ name: input.name, base_role: input.base_role, description: input.description ?? null, created_by: actor.user?.id ?? null })
        .select('id, name, base_role, description')
        .single();
      if (error) throw error;
      return data as CustomRole;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-roles'] }),
  });
}

export function useDeleteCustomRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (customRoleId: string) => {
      const { error } = await supabase.from('custom_roles').delete().eq('id', customRoleId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-roles'] });
      qc.invalidateQueries({ queryKey: ['admin-user-roles'] });
    },
  });
}

/**
 * Persists a full set of (module, action) -> allowed pairs for a custom
 * role in one round trip: rows matching the base role's default are
 * deleted (or never inserted — keeps the table sparse), everything else is
 * upserted. Pass every toggle currently shown in the editor, not just the
 * changed ones — this function does the diffing against `baseline`.
 */
export function useSaveCustomRoleOverrides() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      customRoleId: string;
      /** What should exist after saving: (module,action) -> allowed, only for rows that differ from base */
      toKeep: RoleOverride[];
    }) => {
      const { customRoleId, toKeep } = input;

      const { error: delErr } = await supabase
        .from('custom_role_overrides')
        .delete()
        .eq('custom_role_id', customRoleId);
      if (delErr) throw delErr;

      if (toKeep.length > 0) {
        const { error: insErr } = await supabase.from('custom_role_overrides').insert(
          toKeep.map((o) => ({
            custom_role_id: customRoleId,
            module_key: o.module_key as string,
            action: o.action as string,
            allowed: o.allowed,
          })),
        );
        if (insErr) throw insErr;
      }
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['custom-role-overrides', vars.customRoleId] });
      qc.invalidateQueries({ queryKey: ['my-custom-role'] });
    },
  });
}

export type { CustomRole, RoleOverride, ModuleKey, Action };
