/**
 * Edge Function: compute-production-costs
 * 
 * Phase 4: Move derived cost calculations out of synchronous triggers
 * into an async Edge Function invoked via pg_cron or HTTP.
 * 
 * This replaces the synchronous cost triggers:
 * - trg_chem_cost
 * - trg_power_cost  
 * - trg_well_cost
 * - trg_filter_replacements_sync_cost
 * - trg_pretreatment_sync_filter_cost
 * - trg_sync_dps_production
 * 
 * Invocation:
 * - Scheduled: pg_cron every 5 minutes
 * - Manual: HTTP POST with { plant_id, date_from, date_to }
 * - Event-driven: Supabase Database Webhook (future)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ComputeRequest {
  plant_id?: string;
  date_from?: string;
  date_to?: string;
  force_recompute?: boolean;
}

interface ComputeResponse {
  success: boolean;
  plants_processed: number;
  costs_updated: number;
  duration_ms: number;
  errors: string[];
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startTime = Date.now();
  const errors: string[] = [];
  let plantsProcessed = 0;
  let costsUpdated = 0;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body: ComputeRequest = await req.json().catch(() => ({}));
    const { plant_id, date_from, date_to, force_recompute } = body;

    // Determine target plants
    let plantIds: string[] = [];
    
    if (plant_id) {
      plantIds = [plant_id];
    } else {
      // Get all active plants
      const { data: plants, error: plantsError } = await supabase
        .from('plants')
        .select('id')
        .eq('status', 'Active');
      
      if (plantsError) throw plantsError;
      plantIds = (plants ?? []).map(p => p.id);
    }

    // Determine date range (default: last 7 days)
    const toDate = date_to ? new Date(date_to) : new Date();
    const fromDate = date_from ? new Date(date_from) : new Date(toDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    const toStr = toDate.toISOString().slice(0, 10);
    const fromStr = fromDate.toISOString().slice(0, 10);

    for (const pid of plantIds) {
      try {
        const updated = await recomputePlantCosts(supabase, pid, fromStr, toStr, force_recompute);
        costsUpdated += updated;
        plantsProcessed++;
      } catch (e: any) {
        errors.push(`Plant ${pid}: ${e.message}`);
      }
    }

    const duration = Date.now() - startTime;
    
    return new Response(
      JSON.stringify({ 
        success: errors.length === 0,
        plants_processed: plantsProcessed,
        costs_updated: costsUpdated,
        duration_ms: duration,
        errors 
      } as ComputeResponse),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: errors.length === 0 ? 200 : 207 // 207 = Multi-Status (partial success)
      }
    );

  } catch (e: any) {
    const duration = Date.now() - startTime;
    return new Response(
      JSON.stringify({ 
        success: false,
        plants_processed: 0,
        costs_updated: 0,
        duration_ms: duration,
        errors: [e.message] 
      } as ComputeResponse),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});

async function recomputePlantCosts(
  supabase: any,
  plantId: string,
  fromDate: string,
  toDate: string,
  force: boolean
): Promise<number> {
  // 1. Get existing cost records in range (to avoid duplicates unless force)
  let costQuery = supabase
    .from('production_costs')
    .select('id, cost_date')
    .eq('plant_id', plantId)
    .gte('cost_date', fromDate)
    .lte('cost_date', toDate);

  const { data: existingCosts } = await costQuery;
  const existingDates = new Set((existingCosts ?? []).map((c: any) => c.cost_date));

  // 2. Get daily plant summary for the range
  const { data: summaries, error: summaryError } = await supabase
    .from('daily_plant_summary')
    .select('*')
    .eq('plant_id', plantId)
    .gte('summary_date', fromDate)
    .lte('summary_date', toDate)
    .order('summary_date', { ascending: true });

  if (summaryError) throw summaryError;
  if (!summaries?.length) return 0;

  // 3. Get chemical deliveries for stock calculation
  const { data: deliveries } = await supabase
    .from('chemical_deliveries')
    .select('chemical_name, quantity, delivery_date')
    .eq('plant_id', plantId)
    .lte('delivery_date', toDate);

  // 4. Get chemical dosing for consumption
  const { data: dosing } = await supabase
    .from('chemical_dosing_logs')
    .select('*')
    .eq('plant_id', plantId)
    .gte('log_datetime', fromDate + 'T00:00:00')
    .lte('log_datetime', toDate + 'T23:59:59');

  // 5. Get power readings for energy cost
  const { data: powerReadings } = await supabase
    .from('power_readings')
    .select('daily_consumption_kwh, daily_solar_kwh, daily_grid_kwh, reading_datetime')
    .eq('plant_id', plantId)
    .gte('reading_datetime', fromDate + 'T00:00:00')
    .lte('reading_datetime', toDate + 'T23:59:59');

  // 6. Get well readings for well energy cost
  const { data: wellReadings } = await supabase
    .from('well_readings')
    .select('daily_volume, reading_datetime')
    .eq('plant_id', plantId)
    .gte('reading_datetime', fromDate + 'T00:00:00')
    .lte('reading_datetime', toDate + 'T23:59:59');

  // 7. Get filter replacements for filter cost
  const { data: filterReplacements } = await supabase
    .from('filter_replacements')
    .select('cost, replacement_date')
    .eq('plant_id', plantId)
    .gte('replacement_date', fromDate)
    .lte('replacement_date', toDate);

  // 8. Get pretreatment filter usage
  const { data: afmReadings } = await supabase
    .from('afm_readings')
    .select('backwash_volume, reading_datetime')
    .eq('plant_id', plantId)
    .gte('reading_datetime', fromDate + 'T00:00:00')
    .lte('reading_datetime', toDate + 'T23:59:59');

  // 9. Get electric bill for the month(s) to get tariff
  const monthStart = fromDate.slice(0, 7) + '-01';
  const { data: electricBills } = await supabase
    .from('electric_bills')
    .select('*')
    .eq('plant_id', plantId)
    .gte('billing_month', monthStart)
    .lte('billing_month', toDate.slice(0, 7) + '-01');

  // 10. Compute costs per day
  const upserts: any[] = [];

  for (const summary of summaries) {
    const date = summary.summary_date;
    
    if (!force && existingDates.has(date)) {
      continue; // Skip unless force recompute
    }

    const dayStart = date + 'T00:00:00';
    const dayEnd = date + 'T23:59:59';

    // Chemical cost
    const dayDosing = (dosing ?? []).filter((d: any) => 
      d.log_datetime >= dayStart && d.log_datetime <= dayEnd
    );
    let chemCost = 0;
    for (const d of dayDosing) {
      chemCost += (d.chlorine_kg ?? 0) * (getChemUnitCost(deliveries, 'Chlorine') ?? 0);
      chemCost += (d.smbs_kg ?? 0) * (getChemUnitCost(deliveries, 'SMBS') ?? 0);
      chemCost += (d.anti_scalant_l ?? 0) * (getChemUnitCost(deliveries, 'Anti-Scalant') ?? 0);
      chemCost += (d.soda_ash_kg ?? 0) * (getChemUnitCost(deliveries, 'Soda Ash') ?? 0);
      chemCost += (d.free_chlorine_reagent_pcs ?? 0) * (getChemUnitCost(deliveries, 'Free Chlorine Reagent') ?? 0);
    }

    // Power cost
    const dayPower = (powerReadings ?? []).filter((p: any) => 
      p.reading_datetime >= dayStart && p.reading_datetime <= dayEnd
    );
    let powerCost = 0;
    for (const p of dayPower) {
      const gridKwh = p.daily_grid_kwh ?? 0;
      const tariff = getGridTariff(electricBills, date);
      powerCost += gridKwh * tariff;
    }

    // Well energy cost (proportional to volume)
    const dayWellVol = (wellReadings ?? [])
      .filter((w: any) => w.reading_datetime >= dayStart && w.reading_datetime <= dayEnd)
      .reduce((sum: number, w: any) => sum + (w.daily_volume ?? 0), 0);
    
    const totalWellVol = (wellReadings ?? []).reduce((sum: number, w: any) => sum + (w.daily_volume ?? 0), 0);
    const wellEnergyCost = totalWellVol > 0 ? powerCost * (dayWellVol / totalWellVol) : 0;

    // Filter cost
    const dayFilters = (filterReplacements ?? []).filter((f: any) => f.replacement_date === date);
    const filterCost = dayFilters.reduce((sum: number, f: any) => sum + (f.cost ?? 0), 0);

    // Pretreatment filter cost (AFM backwash)
    const dayAfm = (afmReadings ?? []).filter((a: any) => 
      a.reading_datetime >= dayStart && a.reading_datetime <= dayEnd && a.mode === 'backwash'
    );
    const pretreatmentCost = dayAfm.length > 0 ? filterCost * 0.3 : 0; // Estimate 30% for pretreatment

    const totalCost = chemCost + powerCost + wellEnergyCost + filterCost + pretreatmentCost;
    const volumeM3 = summary.production_m3 ?? summary.product_water_m3 ?? 0;
    const costPerM3 = volumeM3 > 0 ? totalCost / volumeM3 : null;

    upserts.push({
      plant_id: plantId,
      cost_date: date,
      volume_m3: volumeM3,
      energy_cost: powerCost + wellEnergyCost,
      chemical_cost: chemCost,
      filter_cost: filterCost + pretreatmentCost,
      labour_cost: 0, // Not tracked yet
      other_cost: 0,
      total_cost: totalCost,
      cost_per_m3: costPerM3,
      updated_at: new Date().toISOString(),
    });
  }

  if (upserts.length > 0) {
    const { error } = await supabase
      .from('production_costs')
      .upsert(upserts, { onConflict: 'plant_id,cost_date' });
    
    if (error) throw error;
  }

  return upserts.length;
}

function getChemUnitCost(deliveries: any[], name: string): number | null {
  const chemDeliveries = deliveries.filter((d: any) => d.chemical_name.toLowerCase().includes(name.toLowerCase()));
  if (!chemDeliveries.length) return null;
  const totalQty = chemDeliveries.reduce((sum, d) => sum + (d.quantity ?? 0), 0);
  const totalCost = chemDeliveries.reduce((sum, d) => sum + ((d.unit_cost ?? 0) * (d.quantity ?? 0)), 0);
  return totalQty > 0 ? totalCost / totalQty : null;
}

function getGridTariff(electricBills: any[], date: string): number {
  const month = date.slice(0, 7);
  const bill = electricBills.find((b: any) => b.billing_month?.startsWith(month));
  if (!bill) return 0.12; // Default fallback $0.12/kWh
  const totalKwh = (bill.current_reading ?? 0) - (bill.previous_reading ?? 0);
  const totalCharges = (bill.generation_charge ?? 0) + (bill.distribution_charge ?? 0) + (bill.transmission_charge ?? 0) + (bill.taxes_fees ?? 0);
  return totalKwh > 0 ? totalCharges / totalKwh : 0.12;
}