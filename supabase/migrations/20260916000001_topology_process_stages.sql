-- ─────────────────────────────────────────────────────────────────────────────
-- Plant topology: per-plant process stage templates, product tank banks,
-- chemical dosing points, and RO array vessel/element counts.
--
-- Why
-- ───
-- buildTopology() (frontend/src/pages/plantTopology/shared.ts) derived every
-- plant's process line from ONE hard-coded column order:
--
--   well → rawMeter → rawTank → rawWaterPump → mediaFilter → bagCartridge
--        → hpPump → feedMeter → roTrain → permeate/reject → productTank
--        → bulk → locator
--
-- Real lines don't all look like that. A plant can put its media filter and a
-- first bag-filter bank UPSTREAM of the raw tank, run a degasifier between
-- them, and carry a second bag-filter bank on the tank discharge. None of that
-- was expressible, and neither were chemical dosing injection points, a bank of
-- N product tanks, or a reject line reused for tanker refilling.
--
-- This migration is ADDITIVE. Any plant with no plant_process_stages rows keeps
-- the existing hard-coded order byte-for-byte (see DEFAULT_PROCESS_STAGES in
-- shared.ts), and any plant with no product_tanks rows keeps the synthetic
-- single `producttank-<plantId>` node. Nothing changes until a plant is given
-- a template.
--
-- RLS note: all four policies (SELECT/INSERT/UPDATE/DELETE) are written for
-- every new table. 20260915000001_plant_topology_links_update_policy.sql exists
-- because a missing UPDATE policy silently broke upserts on an existing table;
-- not repeating that here.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Process stage template ────────────────────────────────────────────────
-- One row per column in a plant's process line, in sort_order.
--   scope='plant' → the stage is a single shared unit on the plant intake line
--                   (e.g. one MMF ahead of the raw tank that serves everything)
--   scope='train' → the stage is replicated once per primary RO train, which is
--                   the behaviour every existing plant already has.

CREATE TABLE IF NOT EXISTS "public"."plant_process_stages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "stage_key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "node_type" "text" NOT NULL,
    "scope" "text" DEFAULT 'train'::"text" NOT NULL,
    "sort_order" integer NOT NULL,
    "detail" "text",
    "wrap_cols" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "plant_process_stages_scope_check"
        CHECK (("scope" = ANY (ARRAY['plant'::"text", 'train'::"text"]))),
    CONSTRAINT "plant_process_stages_wrap_cols_check"
        CHECK (("wrap_cols" IS NULL) OR ("wrap_cols" BETWEEN 1 AND 8))
);

ALTER TABLE "public"."plant_process_stages" OWNER TO "postgres";

ALTER TABLE ONLY "public"."plant_process_stages"
    ADD CONSTRAINT "plant_process_stages_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."plant_process_stages"
    ADD CONSTRAINT "plant_process_stages_plant_id_stage_key_key" UNIQUE ("plant_id", "stage_key");

ALTER TABLE ONLY "public"."plant_process_stages"
    ADD CONSTRAINT "plant_process_stages_plant_id_fkey"
    FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "idx_process_stages_plant"
    ON "public"."plant_process_stages" USING "btree" ("plant_id", "sort_order");

-- ── 2. Product tanks ─────────────────────────────────────────────────────────
-- A bank of N atmospheric product-water tanks on the permeate line. Replaces
-- the synthetic single tank node where configured.
--
-- product_meter_id: which product meter this tank discharges to. NULL means the
-- tank sits on the common outlet header — buildTopology() then routes the LAST
-- tank in the bank to every product meter rather than drawing an N×M mesh.

CREATE TABLE IF NOT EXISTS "public"."product_tanks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "tank_number" integer NOT NULL,
    "name" "text" NOT NULL,
    "capacity_m3" numeric,
    "status" "text" DEFAULT 'Active'::"text" NOT NULL,
    "product_meter_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."product_tanks" OWNER TO "postgres";

ALTER TABLE ONLY "public"."product_tanks"
    ADD CONSTRAINT "product_tanks_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."product_tanks"
    ADD CONSTRAINT "product_tanks_plant_id_tank_number_key" UNIQUE ("plant_id", "tank_number");

ALTER TABLE ONLY "public"."product_tanks"
    ADD CONSTRAINT "product_tanks_plant_id_fkey"
    FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."product_tanks"
    ADD CONSTRAINT "product_tanks_product_meter_id_fkey"
    FOREIGN KEY ("product_meter_id") REFERENCES "public"."product_meters"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "idx_product_tanks_plant"
    ON "public"."product_tanks" USING "btree" ("plant_id", "tank_number");

-- ── 3. Chemical dosing points ────────────────────────────────────────────────
-- Where a dosing pump injects into the line. `chemical` matches the display
-- names already used by frontend/src/lib/chemicals.ts and chemical_dosing_logs
-- ('Anti Scalant', 'Chlorine', …) so the topology node can surface the latest
-- dose without any new logging table.

CREATE TABLE IF NOT EXISTS "public"."dosing_points" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plant_id" "uuid" NOT NULL,
    "chemical" "text" NOT NULL,
    "label" "text",
    "injects_into_stage_key" "text" NOT NULL,
    "pump_hp" numeric,
    "status" "text" DEFAULT 'Active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."dosing_points" OWNER TO "postgres";

ALTER TABLE ONLY "public"."dosing_points"
    ADD CONSTRAINT "dosing_points_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."dosing_points"
    ADD CONSTRAINT "dosing_points_plant_chem_stage_key"
    UNIQUE ("plant_id", "chemical", "injects_into_stage_key");

ALTER TABLE ONLY "public"."dosing_points"
    ADD CONSTRAINT "dosing_points_plant_id_fkey"
    FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "idx_dosing_points_plant"
    ON "public"."dosing_points" USING "btree" ("plant_id");

-- ── 4. RO array geometry ─────────────────────────────────────────────────────
-- A single-array unit is described as "15 vessels 6 elements" on the P&ID;
-- ro_trains could only describe filter/pump counts. num_vessels defaults to 0,
-- which buildTrainDetail() treats as "not configured" and omits, so existing
-- train labels are unchanged.

ALTER TABLE "public"."ro_trains"
    ADD COLUMN IF NOT EXISTS "num_vessels" integer DEFAULT 0 NOT NULL,
    ADD COLUMN IF NOT EXISTS "elements_per_vessel" integer DEFAULT 0 NOT NULL;

-- ── 5. Reject reuse routing ──────────────────────────────────────────────────
-- reject_routing was ('discharge','recirculate'). A reject line feeding a
-- tanker refilling bay is neither: the water leaves the plant but was never
-- permeate, so it must not be counted as production.

ALTER TABLE "public"."ro_trains"
    DROP CONSTRAINT IF EXISTS "ro_trains_reject_routing_check";

ALTER TABLE "public"."ro_trains"
    ADD CONSTRAINT "ro_trains_reject_routing_check"
    CHECK (("reject_routing" = ANY (ARRAY['discharge'::"text", 'recirculate'::"text", 'reuse'::"text"])));

-- ── 6. RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE "public"."plant_process_stages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."product_tanks"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."dosing_points"        ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    t text;
    admin_check constant text :=
        'EXISTS (SELECT 1 FROM public.user_roles
                  WHERE user_roles.user_id = auth.uid()
                    AND user_roles.role = ANY (ARRAY[''Admin''::public.app_role, ''Manager''::public.app_role]))';
BEGIN
    FOREACH t IN ARRAY ARRAY['plant_process_stages', 'product_tanks', 'dosing_points']
    LOOP
        -- Idempotent: DEPLOYMENT.md documents past migrations being re-run by
        -- hand after a partial failure, and CREATE POLICY has no IF NOT EXISTS.
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);

        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT USING (auth.role() = ''authenticated''::text)',
            t || '_select', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (%s)',
            t || '_insert', t, admin_check);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR UPDATE USING (%s) WITH CHECK (%s)',
            t || '_update', t, admin_check, admin_check);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR DELETE USING (%s)',
            t || '_delete', t, admin_check);
    END LOOP;
END
$$;

-- ── 7. Grants (match the neighbouring topology tables) ───────────────────────

GRANT ALL ON TABLE "public"."plant_process_stages" TO "anon";
GRANT ALL ON TABLE "public"."plant_process_stages" TO "authenticated";
GRANT ALL ON TABLE "public"."plant_process_stages" TO "service_role";

GRANT ALL ON TABLE "public"."product_tanks" TO "anon";
GRANT ALL ON TABLE "public"."product_tanks" TO "authenticated";
GRANT ALL ON TABLE "public"."product_tanks" TO "service_role";

GRANT ALL ON TABLE "public"."dosing_points" TO "anon";
GRANT ALL ON TABLE "public"."dosing_points" TO "authenticated";
GRANT ALL ON TABLE "public"."dosing_points" TO "service_role";

-- ── 8. Example seed ──────────────────────────────────────────────────────────
-- Left commented: it needs a real plant id, and applying it silently re-draws
-- that plant. Run it by hand against the plant you want on the new line shape.
--
-- WITH p AS (SELECT id FROM public.plants WHERE name = '<PLANT NAME>' LIMIT 1)
-- INSERT INTO public.plant_process_stages
--        (plant_id, stage_key, label, node_type, scope, sort_order, wrap_cols)
-- SELECT p.id, v.stage_key, v.label, v.node_type, v.scope, v.sort_order, v.wrap_cols
-- FROM p, (VALUES
--     ('well',          'WELLS',            'well',         'plant',  10, NULL),
--     ('rawMeter',      'RAW METERS',       'rawMeter',     'plant',  20, NULL),
--     ('mediaFilter',   'MMF',              'mediaFilter',  'plant',  30, NULL),
--     ('bagFilterA',    'BAG FILTERS A',    'bagCartridge', 'plant',  40, NULL),
--     ('degasifier',    'DEGASIFIER',       'degasifier',   'plant',  50, NULL),
--     ('rawTank',       'RAW TANK',         'rawTank',      'plant',  60, NULL),
--     ('bagFilterB',    'BAG FILTERS B',    'bagCartridge', 'plant',  70, NULL),
--     ('hpPump',        'HPP',              'hpPump',       'train',  80, NULL),
--     ('feedMeter',     'FEED',             'feedMeter',    'train',  90, NULL),
--     ('roTrain',       'RO ARRAY',         'roTrain',      'train', 100, NULL),
--     ('permeate',      'PERMEATE / REJECT','permeate',     'train', 110, NULL),
--     ('productTank',   'PRODUCT TANKS',    'productTank',  'plant', 120, 3),
--     ('refillStation', 'R.O. REFILLING',   'refillStation','plant', 130, NULL),
--     ('bulk',          'BULK METERS',      'bulk',         'plant', 140, NULL),
--     ('locator',       'LOCATORS',         'locator',      'plant', 150, NULL)
-- ) AS v(stage_key, label, node_type, scope, sort_order, wrap_cols)
-- ON CONFLICT (plant_id, stage_key) DO NOTHING;
--
-- WITH p AS (SELECT id FROM public.plants WHERE name = '<PLANT NAME>' LIMIT 1)
-- INSERT INTO public.product_tanks (plant_id, tank_number, name)
-- SELECT p.id, n, 'Product Tank ' || n FROM p, generate_series(1, 6) AS n
-- ON CONFLICT (plant_id, tank_number) DO NOTHING;
--
-- WITH p AS (SELECT id FROM public.plants WHERE name = '<PLANT NAME>' LIMIT 1)
-- INSERT INTO public.dosing_points (plant_id, chemical, label, injects_into_stage_key, pump_hp)
-- SELECT p.id, v.chemical, v.label, v.stage_key, v.hp
-- FROM p, (VALUES
--     ('Anti Scalant', 'Anti-Scalant Dosing Pump', 'hpPump', NULL::numeric),
--     ('Chlorine',     'Chlorine Dosing Pump',     'bulk',   NULL::numeric)
-- ) AS v(chemical, label, stage_key, hp)
-- ON CONFLICT (plant_id, chemical, injects_into_stage_key) DO NOTHING;
