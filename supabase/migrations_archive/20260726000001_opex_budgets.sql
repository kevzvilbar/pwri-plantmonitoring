-- opex_budgets: monthly power/chemical opex budget targets per plant, compared
-- against actuals already tracked in production_costs (Costs → Rollup/Budget tabs).
--
-- Visibility AND edit rights are both restricted to Manager/Admin — this is
-- financial planning data, not an operational reading, so unlike most tables
-- in this schema it is NOT read-visible to every role with plant access.

CREATE TABLE public.opex_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id uuid NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  budget_month date NOT NULL,               -- always the 1st of the month
  power_budget numeric NOT NULL DEFAULT 0,
  chem_budget numeric NOT NULL DEFAULT 0,
  total_budget numeric GENERATED ALWAYS AS (power_budget + chem_budget) STORED,
  notes text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(plant_id, budget_month),
  CONSTRAINT opex_budgets_month_is_first_of_month
    CHECK (budget_month = date_trunc('month', budget_month)::date),
  CONSTRAINT opex_budgets_non_negative
    CHECK (power_budget >= 0 AND chem_budget >= 0)
);

CREATE INDEX idx_opex_budgets_plant_month ON public.opex_budgets(plant_id, budget_month DESC);

ALTER TABLE public.opex_budgets ENABLE ROW LEVEL SECURITY;

-- Read: Manager/Admin only, still scoped to plants they're assigned to
-- (is_admin short-circuits user_has_plant_access, so Admins see every plant).
CREATE POLICY opex_budgets_read ON public.opex_budgets FOR SELECT TO authenticated
  USING (public.user_has_plant_access(plant_id) AND public.is_manager_or_admin(auth.uid()));

CREATE POLICY opex_budgets_insert ON public.opex_budgets FOR INSERT TO authenticated
  WITH CHECK (public.user_has_plant_access(plant_id) AND public.is_manager_or_admin(auth.uid()));

CREATE POLICY opex_budgets_update ON public.opex_budgets FOR UPDATE TO authenticated
  USING (public.user_has_plant_access(plant_id) AND public.is_manager_or_admin(auth.uid()))
  WITH CHECK (public.user_has_plant_access(plant_id) AND public.is_manager_or_admin(auth.uid()));

CREATE POLICY opex_budgets_delete ON public.opex_budgets FOR DELETE TO authenticated
  USING (public.user_has_plant_access(plant_id) AND public.is_manager_or_admin(auth.uid()));

CREATE TRIGGER trg_opex_budgets_updated BEFORE UPDATE ON public.opex_budgets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
