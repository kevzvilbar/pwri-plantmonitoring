// Aggregates cost data into a hierarchy suitable for the Cost Composition
// Sunburst: Cost -> {Power, Chemicals} -> individual chemical ($).
//
// Ring 1 (Power / Chemicals) comes straight from `production_costs`, which
// already splits every day into power_cost / chem_cost. Ring 2 is new: it
// prices out each of the five chemical_dosing_logs quantity columns using
// the latest chemical_prices.unit_price as of the period's end date.
//
// chemical_prices.chemical_name is free text the user enters on the Costs
// page (see the `KNOWN` preset list there: 'Chlorine', 'SMBS', 'Anti
// Scalant', 'Soda Ash', ...) — it is NOT a foreign key into
// chemical_dosing_logs' fixed columns. DOSING_TO_CHEMICAL_NAME below is
// our best-effort mapping between the two. If a plant hasn't logged a
// price under the expected name, that chemical is reported as "unpriced"
// rather than silently guessed at — see `unpricedChemicals` below.
import { useQuery } from '@tanstack/react-query';
import { format, subDays } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';

export interface CostSunburstNode {
  name: string;
  value?: number;
  children?: CostSunburstNode[];
}

export interface CostComposition {
  root: CostSunburstNode;
  powerTotal: number;
  chemCostTotal: number;
  pricedChemTotal: number;
  hasChemBreakdown: boolean;
  unpricedChemicals: string[];
}

const DOSING_QTY_COLUMNS = [
  'chlorine_kg', 'anti_scalant_l', 'smbs_kg', 'soda_ash_kg', 'free_chlorine_reagent_pcs',
] as const;
type DosingCol = typeof DOSING_QTY_COLUMNS[number];

// Matches the preset chemical names on the Costs page (`KNOWN` in Costs.tsx)
// and the dosing-form gate names in ROTrains.tsx (`isChemEnabled(...)`).
const DOSING_TO_CHEMICAL_NAME: Record<DosingCol, string> = {
  chlorine_kg: 'Chlorine',
  smbs_kg: 'SMBS',
  soda_ash_kg: 'Soda Ash',
  anti_scalant_l: 'Anti Scalant',
  free_chlorine_reagent_pcs: 'Free Cl Reagent',
};

function normalizeName(s: string) {
  return s.trim().toLowerCase();
}

export function useCostComposition(plantIds: string[], days: number) {
  return useQuery<CostComposition | null>({
    queryKey: ['cost-composition', plantIds, days],
    queryFn: async () => {
      if (!plantIds.length) return null;

      const todayStr = format(new Date(), 'yyyy-MM-dd');
      const sinceStr = format(subDays(new Date(), days), 'yyyy-MM-dd');
      const sinceIsoDatetime = `${sinceStr}T00:00:00`;
      const todayIsoDatetime = `${todayStr}T23:59:59`;

      const [costRes, dosingRes, priceRes] = await Promise.all([
        supabase
          .from('production_costs')
          .select('plant_id, power_cost, chem_cost')
          .in('plant_id', plantIds)
          .gte('cost_date', sinceStr)
          .lte('cost_date', todayStr),
        supabase
          .from('chemical_dosing_logs')
          .select('plant_id, chlorine_kg, anti_scalant_l, smbs_kg, soda_ash_kg, free_chlorine_reagent_pcs, log_datetime')
          .in('plant_id', plantIds)
          .gte('log_datetime', sinceIsoDatetime)
          .lte('log_datetime', todayIsoDatetime),
        supabase
          .from('chemical_prices')
          .select('chemical_name, unit_price, effective_date')
          .lte('effective_date', todayStr)
          .order('effective_date', { ascending: false }),
      ]);

      const costRows = costRes.data ?? [];
      const dosingRows = dosingRes.data ?? [];
      const priceRows = priceRes.data ?? [];

      // Latest price per chemical name as of the period end (prices are
      // global, not per-plant, matching how the Costs page manages them).
      const latestPrice = new Map<string, number>();
      for (const row of priceRows) {
        const key = normalizeName(row.chemical_name as string);
        if (!latestPrice.has(key)) latestPrice.set(key, Number(row.unit_price) || 0);
      }

      const powerTotal = costRows.reduce((s, r) => s + (Number(r.power_cost) || 0), 0);
      const chemCostTotal = costRows.reduce((s, r) => s + (Number(r.chem_cost) || 0), 0);

      const qtyTotals: Record<DosingCol, number> = {
        chlorine_kg: 0, anti_scalant_l: 0, smbs_kg: 0, soda_ash_kg: 0, free_chlorine_reagent_pcs: 0,
      };
      for (const row of dosingRows) {
        for (const col of DOSING_QTY_COLUMNS) {
          qtyTotals[col] += Number((row as Record<string, unknown>)[col]) || 0;
        }
      }

      const chemChildren: CostSunburstNode[] = [];
      const unpricedChemicals: string[] = [];
      let pricedChemTotal = 0;

      for (const col of DOSING_QTY_COLUMNS) {
        const qty = qtyTotals[col];
        if (!qty) continue;
        const label = DOSING_TO_CHEMICAL_NAME[col];
        const price = latestPrice.get(normalizeName(label));
        if (price == null) {
          unpricedChemicals.push(label);
          continue;
        }
        const value = Math.round(qty * price * 100) / 100;
        pricedChemTotal += value;
        chemChildren.push({ name: label, value });
      }

      const hasChemBreakdown = chemChildren.length > 0;

      const root: CostSunburstNode = {
        name: 'Cost',
        children: [
          { name: 'Power', value: Math.round(powerTotal * 100) / 100 },
          {
            name: 'Chemicals',
            value: Math.round((hasChemBreakdown ? pricedChemTotal : chemCostTotal) * 100) / 100,
            children: hasChemBreakdown ? chemChildren : undefined,
          },
        ],
      };

      return {
        root, powerTotal, chemCostTotal, pricedChemTotal, hasChemBreakdown, unpricedChemicals,
      };
    },
    enabled: plantIds.length > 0,
    staleTime: 60_000,
  });
}
