// src/lib/filterUsage.ts
//
// Read-only data access for filter usage + cost, sourced from the
// filter_usage_daily view (see migrations/20260729_filter_usage_tracking.sql).
// No insert/delete here — there's no separate log to write to. Data comes
// from the existing Pre-Treatment & RO log (bag_filters_changed /
// cartridges_changed), which operators already fill in daily.
//
// ⚠ Adjust the import below if this project's Supabase client lives
//   somewhere other than `integrations/supabase/client`.
import { supabase } from "@/integrations/supabase/client";

export type FilterHousingType = "Cartridge Filter" | "Bag Filter";

export interface FilterUsageDay {
  id: string;
  plant_id: string;
  train_id: string | null;
  reading_date: string; // yyyy-mm-dd
  filter_housing_type: FilterHousingType;
  quantity_changed: number;
  cost: number;
}

export interface MonthlyFilterUsage {
  month: string; // yyyy-mm
  cartridge_count: number;
  bag_count: number;
  cartridge_cost: number;
  bag_cost: number;
  total_cost: number;
}

/** Only rows where something was actually changed that day. */
export async function listFilterUsage(params: {
  plantId: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}): Promise<FilterUsageDay[]> {
  let query = supabase
    .from("filter_usage_daily")
    .select("*")
    .eq("plant_id", params.plantId)
    .gt("quantity_changed", 0)
    .order("reading_date", { ascending: false })
    .limit(params.limit ?? 200);

  if (params.dateFrom) query = query.gte("reading_date", params.dateFrom);
  if (params.dateTo) query = query.lte("reading_date", params.dateTo);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as FilterUsageDay[];
}

export function aggregateMonthly(rows: FilterUsageDay[]): MonthlyFilterUsage[] {
  const byMonth = new Map<string, MonthlyFilterUsage>();

  for (const row of rows) {
    const month = row.reading_date.slice(0, 7);
    const bucket =
      byMonth.get(month) ??
      ({
        month,
        cartridge_count: 0,
        bag_count: 0,
        cartridge_cost: 0,
        bag_cost: 0,
        total_cost: 0,
      } as MonthlyFilterUsage);

    if (row.filter_housing_type === "Cartridge Filter") {
      bucket.cartridge_count += row.quantity_changed;
      bucket.cartridge_cost += row.cost;
    } else {
      bucket.bag_count += row.quantity_changed;
      bucket.bag_cost += row.cost;
    }
    bucket.total_cost += row.cost;
    byMonth.set(month, bucket);
  }

  return Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month));
}
