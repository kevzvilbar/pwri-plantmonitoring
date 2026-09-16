-- ─────────────────────────────────────────────────────────────────────────────
-- Plant topology layout configuration: custom nodes, custom columns,
-- position overrides, column widths, and custom palette items.
--
-- Why
-- ───
-- Topology links are saved to Supabase (plant_topology_links), but custom
-- nodes, custom columns, column widths, and node position overrides were
-- stored strictly in the operator's browser localStorage.
--
-- If an engineer customized columns or moved nodes on one device, another
-- operator on a different computer saw links connected to non-existent nodes
-- or misaligned columns.
--
-- This table persists the entire schematic layout per plant with full RLS.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "public"."plant_topology_config" (
    "plant_id" "uuid" NOT NULL,
    "custom_nodes" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "custom_columns" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "position_overrides" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "column_widths" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "palette_items" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "plant_topology_config_pkey" PRIMARY KEY ("plant_id"),
    CONSTRAINT "plant_topology_config_plant_id_fkey"
        FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE
);

ALTER TABLE "public"."plant_topology_config" OWNER TO "postgres";

ALTER TABLE "public"."plant_topology_config" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "topology_config_select" ON "public"."plant_topology_config"
FOR SELECT USING ("auth"."role"() = 'authenticated');

CREATE POLICY "topology_config_insert" ON "public"."plant_topology_config"
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = ANY (ARRAY['Admin'::public.app_role, 'Manager'::public.app_role])
  )
);

CREATE POLICY "topology_config_update" ON "public"."plant_topology_config"
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

CREATE POLICY "topology_config_delete" ON "public"."plant_topology_config"
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = ANY (ARRAY['Admin'::public.app_role, 'Manager'::public.app_role])
  )
);

GRANT ALL ON TABLE "public"."plant_topology_config" TO "anon";
GRANT ALL ON TABLE "public"."plant_topology_config" TO "authenticated";
GRANT ALL ON TABLE "public"."plant_topology_config" TO "service_role";

