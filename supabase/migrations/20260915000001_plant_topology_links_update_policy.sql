-- plant_topology_links had INSERT/DELETE/SELECT RLS policies but no UPDATE policy.
-- saveTopologyLinks() (frontend/src/data/mutations/plantTopology.ts) upserts links with
-- onConflict: 'plant_id,from_id,to_id' — matching the table's own unique constraint. Any
-- time a save hits an existing link (i.e. re-saving a plant that already has a topology),
-- Postgres falls into the UPDATE path of the upsert, finds zero applicable UPDATE policies,
-- and rejects with "new row violates row-level security policy (USING expression)".
-- Fix: add an UPDATE policy mirroring the same Admin/Manager check already used by the
-- INSERT and DELETE policies on this table.
-- Applied live via Supabase MCP on 2026-09-15; this file keeps the repo in sync with that.

CREATE POLICY "topology_links_update" ON "public"."plant_topology_links"
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = ANY (ARRAY['Admin'::public.app_role, 'Manager'::public.app_role])
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = ANY (ARRAY['Admin'::public.app_role, 'Manager'::public.app_role])
  )
);
