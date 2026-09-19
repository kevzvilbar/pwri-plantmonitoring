// src/lib/filterReplacements.ts
//
// Data access + types for the Filter Replacement Tracking feature
// (bag / cartridge filter cost + history). Added 2026-07-29.
//
// ⚠ Adjust the import below if this project's Supabase client lives
//   somewhere other than `integrations/supabase/client`.
import { supabase } from "@/integrations/supabase/client";

export type FilterHousingType = "Cartridge Filter" | "Bag Filter";

// Shared vocabulary for filter items, used by both the Prices tab
// (pages/Costs.tsx's ChemicalPrices, which lets Manager/Admin price these
// alongside chemicals in chemical_prices) and this file's price-list
// lookup/sync below.
export const FILTER_ITEMS = ["Bag Filter", "Cartridge Filter"] as const;
export const FILTER_UNITS = ["pcs", "set"] as const;

/** True if a stored chemical_prices.chemical_name (e.g. "Bag Filter (pcs)")
 *  is one of the filter items rather than a chemical. Derived from the name
 *  string rather than a DB column — chemical_prices has no category column,
 *  and this keeps the distinction working for every row already on file
 *  without a migration. */
export function isFilterPriceEntry(storedName: string | null | undefined): boolean {
  if (!storedName) return false;
  return FILTER_ITEMS.some((f) => storedName === f || storedName.startsWith(`${f} (`));
}

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
  return (data ?? []).map((r) => ({
    ...r,
    filter_housing_type: r.filter_housing_type as FilterHousingType,
    // Generated column (quantity_replaced * unit_price, both NOT NULL) —
    // Supabase types generated columns as nullable regardless, but it can
    // only actually be null if the row itself doesn't exist.
    total_cost: r.total_cost ?? 0,
  }));
}

/**
 * Prefills the log dialog with whatever price was last paid for this
 * plant + housing type, so Manager/Admin isn't retyping known prices.
 * This is the fallback source — see getPriceListEntry() below, which is
 * tried first.
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

// ── Two-way wiring with Costs → Prices (chemical_prices) ─────────────────────
//
// The Prices tab (pages/Costs.tsx's ChemicalPrices component) now lets
// Manager/Admin maintain "Bag Filter" / "Cartridge Filter" prices alongside
// chemicals, storing the unit inline in the name — e.g. "Bag Filter (pcs)".
// chemical_prices is a global list (no plant_id column), so lookups here are
// by housing type only, same as the price list itself.

export interface PriceListEntry {
  price: number;
  unit: string;
  effective_date: string;
}

/**
 * Reads the most recent price for this filter housing type from the Prices
 * tab. This is tried BEFORE this plant's own replacement history, so a price
 * a Manager/Admin sets in Prices flows straight into this dialog.
 */
export async function getPriceListEntry(
  housingType: FilterHousingType
): Promise<PriceListEntry | null> {
  const { data, error } = await supabase
    .from("chemical_prices")
    .select("chemical_name, unit_price, effective_date")
    .ilike("chemical_name", `${housingType} (%`)
    .order("effective_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const unitMatch = /\(([^)]+)\)\s*$/.exec(data.chemical_name ?? "");
  return {
    price: Number(data.unit_price),
    unit: unitMatch?.[1]?.trim() || "pcs",
    effective_date: data.effective_date,
  };
}

/**
 * The other half of the wiring: after a replacement is logged, mirror its
 * price back into the Prices tab — but only when it's actually new
 * information (no entry yet, or the price paid differs from the one on
 * file), so Price History doesn't fill up with a duplicate row every time
 * the same known price is logged again. Returns true when a new price row
 * was written.
 */
export async function syncPriceToPriceList(params: {
  housingType: FilterHousingType;
  unitPrice: number;
  effectiveDate: string;
  updatedBy?: string | null;
}): Promise<boolean> {
  const existing = await getPriceListEntry(params.housingType);
  if (existing && Number(existing.price) === Number(params.unitPrice)) {
    return false;
  }
  const unit = existing?.unit || "pcs";
  const { error } = await supabase.from("chemical_prices").insert({
    chemical_name: `${params.housingType} (${unit})`,
    unit_price: params.unitPrice,
    effective_date: params.effectiveDate,
    updated_by: params.updatedBy ?? null,
  });
  if (error) throw error;
  return true;
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
