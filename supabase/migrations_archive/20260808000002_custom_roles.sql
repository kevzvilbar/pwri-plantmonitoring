-- =============================================================================
-- Migration: 20260808_custom_roles.sql
-- Custom role editor: lets an Admin create a NAMED role (e.g. "Plant
-- supervisor") that starts as a copy of one of the five system roles
-- (Operator/Technician/Manager/Data Analyst/Admin) and overrides individual
-- module permissions from there.
--
-- Design choice: a custom role does NOT get its own value in the app_role
-- enum, and does NOT change how any of the ~34 existing RLS policies work.
-- Every user assigned a custom role still carries a normal user_roles row
-- keyed to that role's base_role, so every Postgres-level security check in
-- this schema (is_admin(), is_manager_or_admin(), has_role(), etc.) keeps
-- working unchanged. custom_role_id is purely an additional pointer the
-- frontend uses to compute which modules to show/hide and which buttons to
-- enable — see frontend/src/lib/permissions.ts (effectivePermission()) and
-- frontend/src/pages/admin/RolesPanel.tsx.
--
-- Adds:
--   1. custom_roles              — id, name, base_role, description
--   2. custom_role_overrides     — sparse (module_key, action, allowed) rows;
--                                   only rows that differ from the base
--                                   role's PERMISSION_MATRIX default exist
--   3. user_roles.custom_role_id — nullable pointer, set alongside the
--                                   existing `role` column when an admin
--                                   assigns someone a custom role
--   4. A guard trigger blocking overrides on admin_users / admin_migrations
--      — mirrors "Admin console access can only be granted to the Admin
--      role, to prevent accidental lockout" so a direct API/SQL write can't
--      bypass what the UI already greys out.
-- =============================================================================

-- ── 1. custom_roles ──────────────────────────────────────────────────────────
CREATE TABLE public.custom_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  base_role   public.app_role NOT NULL,
  description TEXT,
  created_by  UUID REFERENCES public.user_profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_custom_roles_updated BEFORE UPDATE ON public.custom_roles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.custom_roles IS
  'Named permission presets an Admin builds on top of a system role '
  '(base_role). Does not participate in RLS directly — see migration header.';

-- ── 2. custom_role_overrides ─────────────────────────────────────────────────
-- Sparse by design: a row only exists where the custom role's effective
-- permission differs from PERMISSION_MATRIX[base_role][module_key][action].
-- Keeping it sparse is what makes "3 overrides from base" a simple COUNT(*).
CREATE TABLE public.custom_role_overrides (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  custom_role_id UUID NOT NULL REFERENCES public.custom_roles(id) ON DELETE CASCADE,
  module_key     TEXT NOT NULL,
  action         TEXT NOT NULL CHECK (action IN ('view','edit','budget','delete')),
  allowed        BOOLEAN NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (custom_role_id, module_key, action)
);
CREATE INDEX idx_custom_role_overrides_role ON public.custom_role_overrides(custom_role_id);

-- ── 3. Guard: admin_users / admin_migrations can never be overridden ────────
-- Matches PERMISSION_MATRIX's admin_users/admin_migrations entries (Admin
-- only) and REDIRECTS in frontend/src/lib/permissions.ts. Defense-in-depth:
-- the RolesPanel UI already disables these rows, this makes it a hard rule.
CREATE OR REPLACE FUNCTION public.fn_guard_custom_role_override()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.module_key IN ('admin_users', 'admin_migrations') THEN
    RAISE EXCEPTION
      'admin_users and admin_migrations cannot be overridden by a custom role (Admin-only, to prevent accidental lockout)';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_guard_custom_role_override
  BEFORE INSERT OR UPDATE ON public.custom_role_overrides
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_custom_role_override();

-- ── 4. user_roles gets a pointer to the custom role (if any) ────────────────
ALTER TABLE public.user_roles
  ADD COLUMN custom_role_id UUID REFERENCES public.custom_roles(id) ON DELETE SET NULL;

CREATE INDEX idx_user_roles_custom_role ON public.user_roles(custom_role_id) WHERE custom_role_id IS NOT NULL;

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.custom_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_role_overrides ENABLE ROW LEVEL SECURITY;

-- Every signed-in user can read role definitions — needed to compute their
-- own effective permissions client-side. Same trust model as
-- PERMISSION_MATRIX already being shipped in the JS bundle today.
CREATE POLICY custom_roles_select ON public.custom_roles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY custom_role_overrides_select ON public.custom_role_overrides
  FOR SELECT TO authenticated USING (true);

-- Only Admin may create, rename, re-base, or delete custom roles, and only
-- Admin may add/change/remove overrides.
CREATE POLICY custom_roles_admin_write ON public.custom_roles
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY custom_role_overrides_admin_write ON public.custom_role_overrides
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- ── Known limitations (v1) ───────────────────────────────────────────────────
-- 1. A user can only hold one custom_role_id at a time (it lives on the same
--    user_roles row as their base role, and RoleSelector-style UIs replace
--    that row wholesale). Fine today since the app already treats "primary
--    role" as singular everywhere (see primaryRole() in UsersPanel.tsx).
-- 2. Per-plant scoping and the Data-Analyst-only REDIRECTS behavior are
--    still governed entirely by frontend/src/lib/permissions.ts, same as
--    before this migration — this only adds the override layer on top.
-- 3. No history/audit trail on override changes yet. If that's needed,
--    reading_edit_audit_log's pattern (table_name/record_id/old/new jsonb)
--    is the natural fit — add 'custom_role_overrides' to its CHECK
--    constraint the same way 20260727_hamas_phase0_roles_and_audit.sql did
--    for locator_readings.

NOTIFY pgrst, 'reload schema';
