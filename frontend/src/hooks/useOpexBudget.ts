import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface MonthlyOpex {
  /** yyyy-MM-01 */
  month: string;
  /** e.g. "Jan 2026" */
  label: string;
  /** null when no budget row exists yet for this month */
  budgetId: string | null;
  powerBudget: number;
  powerActual: number;
  chemBudget: number;
  chemActual: number;
  otherBudget: number;
  otherActual: number;
  totalBudget: number;
  totalActual: number;
  /** null when no budget has been set for the month — not the same as 0% variance */
  variancePct: number | null;
  /** ₱ estimated grid cost avoided by solar generation this month (informational — solar is capex, not budgeted) */
  solarOffset: number;
  /** solar kWh as a % of (solar + grid) kWh for the month; null if no readings */
  solarSharePct: number | null;
}

const monthLabel = (month: string) =>
  new Date(`${month}T00:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

/**
 * Monthly power/chem budget vs. actual for a plant across one calendar year.
 * Actuals come from production_costs (same source Rollup uses — power_cost is
 * already grid-only, so no adjustment is needed there for solar).
 * Solar offset is a separate, informational estimate (solar kWh × current tariff
 * rate) — it uses the plant's latest tariff rather than each month's historical
 * rate, since this is context, not an accounting figure.
 */
export function useMonthlyOpex(plantId: string, year: number) {
  return useQuery({
    queryKey: ['opex-monthly', plantId, year],
    queryFn: async (): Promise<MonthlyOpex[]> => {
      const from = `${year}-01-01`;
      const to = `${year}-12-31`;

      const [{ data: budgets }, { data: costs }, { data: readings }, { data: tariff }] = await Promise.all([
        supabase.from('opex_budgets').select('*').eq('plant_id', plantId)
          .gte('budget_month', from).lte('budget_month', to),
        supabase.from('production_costs').select('cost_date, chem_cost, power_cost, filter_cost').eq('plant_id', plantId)
          .gte('cost_date', from).lte('cost_date', to),
        supabase.from('power_readings').select('reading_datetime, daily_solar_kwh, daily_grid_kwh').eq('plant_id', plantId)
          .gte('reading_datetime', from).lte('reading_datetime', `${to} 23:59:59`),
        supabase.from('power_tariffs').select('rate_per_kwh').eq('plant_id', plantId)
          .order('effective_date', { ascending: false }).limit(1).maybeSingle(),
      ]);

      const rate = +(tariff?.rate_per_kwh ?? 0);

      type MonthAgg = { chem: number; power: number; other: number; solar: number; grid: number };
      const byMonth = new Map<string, MonthAgg>();
      for (let m = 1; m <= 12; m++) {
        byMonth.set(`${year}-${String(m).padStart(2, '0')}-01`, { chem: 0, power: 0, other: 0, solar: 0, grid: 0 });
      }

      (costs ?? []).forEach((c: any) => {
        const key = `${String(c.cost_date).slice(0, 7)}-01`;
        const agg = byMonth.get(key);
        if (agg) {
          agg.chem += +c.chem_cost || 0;
          agg.power += +c.power_cost || 0;
          agg.other += +c.filter_cost || 0;
        }
      });
      (readings ?? []).forEach((r: any) => {
        const key = `${String(r.reading_datetime).slice(0, 7)}-01`;
        const agg = byMonth.get(key);
        if (agg) { agg.solar += +r.daily_solar_kwh || 0; agg.grid += +r.daily_grid_kwh || 0; }
      });
      const budgetByMonth = new Map((budgets ?? []).map((b: any) => [b.budget_month, b]));

      return Array.from(byMonth.entries()).map(([month, agg]) => {
        const budget = budgetByMonth.get(month) as any;
        const powerBudget = +(budget?.power_budget ?? 0);
        const chemBudget = +(budget?.chem_budget ?? 0);
        const otherBudget = 0;
        const totalBudget = powerBudget + chemBudget + otherBudget;
        const totalActual = agg.power + agg.chem + agg.other;
        const totalKwh = agg.solar + agg.grid;
        return {
          month,
          label: monthLabel(month),
          budgetId: budget?.id ?? null,
          powerBudget, powerActual: agg.power,
          chemBudget, chemActual: agg.chem,
          otherBudget, otherActual: agg.other,
          totalBudget, totalActual,
          variancePct: budget && totalBudget > 0 ? ((totalActual - totalBudget) / totalBudget) * 100 : null,
          solarOffset: agg.solar * rate,
          solarSharePct: totalKwh > 0 ? (agg.solar / totalKwh) * 100 : null,
        };
      });
    },
    enabled: !!plantId,
  });
}

/** Tone bucket for a budget variance % — asymmetric: under budget is never flagged as a problem. */
export function opexVarianceTone(pct: number | null): 'accent' | 'warn' | 'danger' | 'muted' {
  if (pct == null) return 'muted';
  if (pct > 15) return 'danger';
  if (pct > 5) return 'warn';
  return 'accent';
}

/** Create or update a month's power/chem budget for a plant. */
export async function saveOpexBudget(params: {
  plantId: string; month: string; powerBudget: number; chemBudget: number; userId?: string | null;
}) {
  return supabase.from('opex_budgets').upsert(
    {
      plant_id: params.plantId,
      budget_month: params.month,
      power_budget: params.powerBudget,
      chem_budget: params.chemBudget,
      updated_by: params.userId ?? null,
    },
    { onConflict: 'plant_id,budget_month' },
  );
}
