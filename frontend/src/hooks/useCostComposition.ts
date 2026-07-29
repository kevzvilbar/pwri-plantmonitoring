// Aggregates cost data into a hierarchy suitable for the Cost Composition
// Sunburst: Cost -> {Power, Chemicals, Filters} -> individual chemical /
// filter housing type ($).
//
// Ring 1 (Power / Chemicals / Filters) comes straight from
// `production_costs`, which splits every day into power_cost / chem_cost /
// filter_cost (filter_cost added by 20260729_filter_replacements.sql, kept
// in sync via trigger from filter_replacements — see that migration).
// Ring 2 under Chemicals prices out each of the five chemical_dosing_logs
// quantity columns using the latest chemical_prices.unit_price as of the
// period's end date. Ring 2 under Filters splits filter_cost by
// filter_housing_type (Cartridge Filter / Bag Filter) straight from the
// filter_replacements rows in the period — no separate "price list" to
// join against, since filter cost is already logged per-event.
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
  filterCostTotal: number;
  hasFilterBreakdown: boolean;
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

// Unit each dosing column is actually recorded in — baked into the column
// name itself (chlorine_**kg**, anti_scalant_**l**, ...). Used to reject a
// price entered under the same chemical name but a different unit; without
// this a "Chlorine (g)" price would get multiplied straight into a kg
// quantity and silently overstate cost by 1000x.
const DOSING_UNIT: Record<DosingCol, string> = {
  chlorine_kg: 'kg',
  smbs_kg: 'kg',
  soda_ash_kg: 'kg',
  anti_scalant_l: 'l',
  free_chlorine_reagent_pcs: 'pcs',
};

function normalizeName(s: string) {
  return s.trim().toLowerCase();
}

// The Costs page saves chemical_name as "<name> (<unit>)", e.g.
// "Chlorine (kg)" — see the `submit()` handler in Costs.tsx. That unit
// suffix isn't a separate column, it's baked into this one free-text
// field, so a lookup keyed on the bare label ("chlorine") never matched
// the stored value ("chlorine (kg)") and every chemical fell through to
// `unpricedChemicals` regardless of how many prices were on file. Parse
// the unit back out here so matching works, and keep it so a wrong-unit
// price can be caught instead of silently mis-costed.
const NAME_UNIT_RE = /^(.*?)\s*\(([^()]+)\)\s*$/;
function parsePriceName(raw: string): { base: string; unit: string | null } {
  const m = raw.match(NAME_UNIT_RE);
  return m ? { base: m[1].trim(), unit: m[2].trim().toLowerCase() } : { base: raw.trim(), unit: null };
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

      const [costRes, dosingRes, priceRes, filterRes] = await Promise.all([
        supabase
          .from('production_costs')
          .select('plant_id, power_cost, chem_cost, filter_cost')
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
        // Filters' Ring 2 doesn't need a price-list join like Chemicals does —
        // total_cost is already stored per replacement event, so we can group
        // straight from filter_replacements instead of pricing anything out.
        supabase
          .from('filter_replacements')
          .select('plant_id, filter_housing_type, total_cost, replacement_date')
          .in('plant_id', plantIds)
          .gte('replacement_date', sinceStr)
          .lte('replacement_date', todayStr),
      ]);

      const costRows = costRes.data ?? [];
      const dosingRows = dosingRes.data ?? [];
      const priceRows = priceRes.data ?? [];
      const filterRows = filterRes.data ?? [];

      // Latest price per chemical name as of the period end (prices are
      // global, not per-plant, matching how the Costs page manages them).
      // Keyed on the *base* name with the "(unit)" suffix parsed off, since
      // that's what's actually stored — see parsePriceName() above.
      const latestPrice = new Map<string, { price: number; unit: string | null }>();
      for (const row of priceRows) {
        const { base, unit } = parsePriceName(row.chemical_name as string);
        const key = normalizeName(base);
        if (!latestPrice.has(key)) latestPrice.set(key, { price: Number(row.unit_price) || 0, unit });
      }

      const powerTotal = costRows.reduce((s, r) => s + (Number(r.power_cost) || 0), 0);
      const chemCostTotal = costRows.reduce((s, r) => s + (Number(r.chem_cost) || 0), 0);
      const filterCostTotal = costRows.reduce((s, r) => s + (Number((r as Record<string, unknown>).filter_cost) || 0), 0);

      // Group replacement events by housing type for the Filters ring —
      // at most two children (Cartridge Filter / Bag Filter), so no need for
      // the unpriced-item bookkeeping Chemicals needs.
      const filterByType = new Map<string, number>();
      for (const row of filterRows) {
        const key = row.filter_housing_type as string;
        filterByType.set(key, (filterByType.get(key) ?? 0) + (Number(row.total_cost) || 0));
      }
      const filterChildren: CostSunburstNode[] = Array.from(filterByType.entries())
        .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }));
      const hasFilterBreakdown = filterChildren.length > 0;

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
        const entry = latestPrice.get(normalizeName(label));
        if (entry == null) {
          unpricedChemicals.push(label);
          continue;
        }
        const expectedUnit = DOSING_UNIT[col];
        if (entry.unit && entry.unit !== expectedUnit) {
          // A price is on file, just not in the unit this quantity is
          // logged in — surface why instead of guessing at a conversion.
          unpricedChemicals.push(`${label} (priced in ${entry.unit}, need ${expectedUnit})`);
          continue;
        }
        const value = Math.round(qty * entry.price * 100) / 100;
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
          {
            name: 'Filters',
            value: Math.round(filterCostTotal * 100) / 100,
            children: hasFilterBreakdown ? filterChildren : undefined,
          },
        ],
      };

      return {
        root, powerTotal, chemCostTotal, pricedChemTotal, hasChemBreakdown, unpricedChemicals,
        filterCostTotal, hasFilterBreakdown,
      };
    },
    enabled: plantIds.length > 0,
    staleTime: 60_000,
  });
}
