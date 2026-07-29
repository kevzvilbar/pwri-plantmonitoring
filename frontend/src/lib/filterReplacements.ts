// src/lib/filterReplacements.ts
//
// Data access + types for the Filter Replacement Tracking feature
// (bag / cartridge filter cost + history). Added 2026-07-29.
//
// ⚠ Adjust the import below if this project's Supabase client lives
//   somewhere other than `integrations/supabase/client`.
import { supabase } from "@/integrations/supabase/client";

export type FilterHousingType = "Cartridge Filter" | "Bag Filter";

export interface FilterReplacement {
  id: string;
  plant_id: string;
  train_id: string | null;
  replacement_date: string; // yyyy-mm-dd
  filter_housing_type: FilterHousingType;
  quantity_replaced: number;
  unit_price: number;
  total_cost: number;
  avg_dp_psi: number | null;
  supplier: string | null;
  remarks: string | null;
  recorded_by: string | null;
  created_at: string;
}

export interface NewFilterReplacement {
  plant_id: string;
  train_id?: string | null;
  replacement_date: string;
  filter_housing_type: FilterHousingType;
  quantity_replaced: number;
  unit_price: number;
  avg_dp_psi?: number | null;
  supplier?: string | null;
  remarks?: string | null;
}

export interface MonthlyFilterCost {
  month: string; // yyyy-mm
  cartridge_cost: number;
  bag_cost: number;
  total_cost: number;
  replacement_count: number;
}

export async function listFilterReplacements(params: {
  plantId: string;
  trainId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}): Promise<FilterReplacement[]> {
  let query = supabase
    .from("filter_replacements")
    .select("*")
    .eq("plant_id", params.plantId)
    .order("replacement_date", { ascending: false })
    .limit(params.limit ?? 200);

  if (params.trainId) query = query.eq("train_id", params.trainId);
  if (params.dateFrom) query = query.gte("replacement_date", params.dateFrom);
  if (params.dateTo) query = query.lte("replacement_date", params.dateTo);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/**
 * Prefills the log dialog with whatever price was last paid for this
 * plant + housing type, so Manager/Admin isn't retyping known prices.
 */
export async function getLastUnitPrice(
  plantId: string,
  housingType: FilterHousingType
): Promise<number | null> {
  const { data, error } = await supabase
    .from("filter_replacements")
    .select("unit_price")
    .eq("plant_id", plantId)
    .eq("filter_housing_type", housingType)
    .order("replacement_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.unit_price ?? null;
}

export async function logFilterReplacement(
  entry: NewFilterReplacement
): Promise<FilterReplacement> {
  const { data, error } = await supabase
    .from("filter_replacements")
    .insert(entry)
    .select()
    .single();

  if (error) throw error;
  return data as FilterReplacement;
}

export async function deleteFilterReplacement(id: string): Promise<void> {
  const { error } = await supabase.from("filter_replacements").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Client-side monthly rollup for the chart + stat tiles. If a plant's
 * history grows large, consider replacing this with a Postgres view/RPC
 * instead of aggregating in the browser.
 */
export function aggregateMonthly(rows: FilterReplacement[]): MonthlyFilterCost[] {
  const byMonth = new Map<string, MonthlyFilterCost>();

  for (const row of rows) {
    const month = row.replacement_date.slice(0, 7); // yyyy-mm
    const bucket =
      byMonth.get(month) ??
      ({ month, cartridge_cost: 0, bag_cost: 0, total_cost: 0, replacement_count: 0 } as MonthlyFilterCost);

    if (row.filter_housing_type === "Cartridge Filter") {
      bucket.cartridge_cost += row.total_cost;
    } else {
      bucket.bag_cost += row.total_cost;
    }
    bucket.total_cost += row.total_cost;
    bucket.replacement_count += 1;
    byMonth.set(month, bucket);
  }

  return Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month));
}

export function averageDaysBetween(rows: FilterReplacement[]): number | null {
  if (rows.length < 2) return null;
  const sorted = [...rows].sort(
    (a, b) => new Date(a.replacement_date).getTime() - new Date(b.replacement_date).getTime()
  );
  let totalDays = 0;
  for (let i = 1; i < sorted.length; i++) {
    const diffMs =
      new Date(sorted[i].replacement_date).getTime() -
      new Date(sorted[i - 1].replacement_date).getTime();
    totalDays += diffMs / (1000 * 60 * 60 * 24);
  }
  return Math.round(totalDays / (sorted.length - 1));
}
