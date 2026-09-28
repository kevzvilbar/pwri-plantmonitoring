-- 20260928000004_chem_price_recompute.sql
-- Effective-dated pricing lookup, stock calculation, daily usage, and monthly variance RPCs

ALTER TABLE public.chemical_prices
  ADD COLUMN IF NOT EXISTS entered_unit text,
  ADD COLUMN IF NOT EXISTS entered_price numeric;

-- Function: lookup unit price for a catalog item on a given Manila date
CREATE OR REPLACE FUNCTION public.fn_chem_unit_price(p_catalog_id uuid, p_date date)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_price_key text;
  v_unit_price numeric;
BEGIN
  SELECT price_key INTO v_price_key
  FROM public.chemical_catalog
  WHERE id = p_catalog_id;

  IF v_price_key IS NULL THEN RETURN NULL; END IF;

  SELECT unit_price INTO v_unit_price
  FROM public.chemical_prices
  WHERE chemical_name = v_price_key
    AND effective_date <= p_date
  ORDER BY effective_date DESC
  LIMIT 1;

  RETURN v_unit_price;
END;
$$;

-- Function: server-side chemical stock aggregate
CREATE OR REPLACE FUNCTION public.fn_chem_stock(p_plant_id uuid)
RETURNS TABLE (
  catalog_id uuid,
  chemical_name text,
  family text,
  base_unit text,
  delivered_base numeric,
  used_base numeric,
  stock_on_hand numeric,
  daily_avg_7d numeric,
  days_of_supply numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH delivered AS (
    SELECT
      cd.catalog_id AS cat_id,
      sum(COALESCE(cd.qty_base, cd.quantity)) AS total_delivered
    FROM public.chemical_deliveries cd
    WHERE cd.plant_id = p_plant_id
    GROUP BY cd.catalog_id
  ),
  used_all AS (
    SELECT
      cdi.catalog_id AS cat_id,
      sum(cdi.qty + cdi.qty_extra) AS total_used
    FROM public.chemical_dosing_items cdi
    WHERE cdi.plant_id = p_plant_id
    GROUP BY cdi.catalog_id
  ),
  used_7d AS (
    SELECT
      cdi.catalog_id AS cat_id,
      sum(cdi.qty + cdi.qty_extra) / 7.0 AS avg_daily_7d
    FROM public.chemical_dosing_items cdi
    JOIN public.chemical_dosing_logs cdl ON cdl.id = cdi.dosing_log_id
    WHERE cdi.plant_id = p_plant_id
      AND cdl.log_datetime >= (now() - interval '7 days')
    GROUP BY cdi.catalog_id
  )
  SELECT
    c.id AS catalog_id,
    c.name AS chemical_name,
    c.family,
    c.base_unit,
    COALESCE(d.total_delivered, 0) AS delivered_base,
    COALESCE(u.total_used, 0) AS used_base,
    (COALESCE(d.total_delivered, 0) - COALESCE(u.total_used, 0)) AS stock_on_hand,
    COALESCE(u7.avg_daily_7d, 0) AS daily_avg_7d,
    CASE
      WHEN COALESCE(u7.avg_daily_7d, 0) > 0 THEN
        ((COALESCE(d.total_delivered, 0) - COALESCE(u.total_used, 0)) / u7.avg_daily_7d)
      ELSE NULL
    END AS days_of_supply
  FROM public.chemical_catalog c
  LEFT JOIN delivered d ON d.cat_id = c.id
  LEFT JOIN used_all u ON u.cat_id = c.id
  LEFT JOIN used_7d u7 ON u7.cat_id = c.id
  WHERE c.is_active = true;
END;
$$;

-- Function: daily chemical usage aggregate
CREATE OR REPLACE FUNCTION public.fn_chem_daily_usage(p_plant_id uuid, p_from date, p_to date)
RETURNS TABLE (
  usage_date date,
  catalog_id uuid,
  chemical_name text,
  family text,
  category text,
  base_unit text,
  total_qty numeric,
  total_qty_extra numeric,
  total_product_kg numeric,
  total_active_kg numeric,
  total_cost numeric,
  unpriced_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT
    (cdl.log_datetime AT TIME ZONE 'Asia/Manila')::date AS usage_date,
    cdi.catalog_id,
    cdi.chemical_name,
    c.family,
    c.category,
    cdi.unit AS base_unit,
    sum(cdi.qty) AS total_qty,
    sum(cdi.qty_extra) AS total_qty_extra,
    sum(cdi.product_kg) AS total_product_kg,
    sum(cdi.active_kg) AS total_active_kg,
    sum(cdi.line_cost) AS total_cost,
    count(CASE WHEN cdi.unit_price IS NULL THEN 1 END) AS unpriced_count
  FROM public.chemical_dosing_items cdi
  JOIN public.chemical_dosing_logs cdl ON cdl.id = cdi.dosing_log_id
  JOIN public.chemical_catalog c ON c.id = cdi.catalog_id
  WHERE cdi.plant_id = p_plant_id
    AND (cdl.log_datetime AT TIME ZONE 'Asia/Manila')::date BETWEEN p_from AND p_to
  GROUP BY (cdl.log_datetime AT TIME ZONE 'Asia/Manila')::date, cdi.catalog_id, cdi.chemical_name, c.family, c.category, cdi.unit
  ORDER BY usage_date ASC, cdi.chemical_name ASC;
END;
$$;

-- Function: monthly variance calculation (Standard vs Actual Delivery Cost)
CREATE OR REPLACE FUNCTION public.fn_chem_monthly_variance(p_plant_id uuid, p_month date)
RETURNS TABLE (
  catalog_id uuid,
  chemical_name text,
  base_unit text,
  total_usage_base numeric,
  standard_cost numeric,
  actual_delivery_avg_unit_cost numeric,
  actual_cost numeric,
  price_variance numeric,
  has_actual_cost boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_month_start date := date_trunc('month', p_month)::date;
  v_month_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
BEGIN
  RETURN QUERY
  WITH usage_sum AS (
    SELECT
      cdi.catalog_id AS cat_id,
      cdi.chemical_name AS chem_name,
      cdi.unit AS b_unit,
      sum(cdi.qty + cdi.qty_extra) AS u_base,
      sum(COALESCE(cdi.line_cost, 0)) AS std_cost
    FROM public.chemical_dosing_items cdi
    JOIN public.chemical_dosing_logs cdl ON cdl.id = cdi.dosing_log_id
    WHERE cdi.plant_id = p_plant_id
      AND (cdl.log_datetime AT TIME ZONE 'Asia/Manila')::date BETWEEN v_month_start AND v_month_end
    GROUP BY cdi.catalog_id, cdi.chemical_name, cdi.unit
  ),
  delivery_cost AS (
    SELECT
      cd.catalog_id AS cat_id,
      sum(cd.unit_cost * cd.quantity) / sum(COALESCE(cd.qty_base, cd.quantity)) AS avg_cost
    FROM public.chemical_deliveries cd
    WHERE cd.plant_id = p_plant_id
      AND cd.unit_cost IS NOT NULL
      AND cd.delivery_date BETWEEN v_month_start AND v_month_end
    GROUP BY cd.catalog_id
  )
  SELECT
    u.cat_id AS catalog_id,
    u.chem_name AS chemical_name,
    u.b_unit AS base_unit,
    u.u_base AS total_usage_base,
    u.std_cost AS standard_cost,
    d.avg_cost AS actual_delivery_avg_unit_cost,
    CASE WHEN d.avg_cost IS NOT NULL THEN (u.u_base * d.avg_cost) ELSE NULL END AS actual_cost,
    CASE WHEN d.avg_cost IS NOT NULL THEN (u.u_base * d.avg_cost - u.std_cost) ELSE NULL END AS price_variance,
    (d.avg_cost IS NOT NULL) AS has_actual_cost
  FROM usage_sum u
  LEFT JOIN delivery_cost d ON d.cat_id = u.cat_id;
END;
$$;
