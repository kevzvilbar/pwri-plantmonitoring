// Split out of TrendChart.tsx (was 4,095 lines) as part of a file-size
// cleanup pass. This module owns EVERY Supabase read TrendChart needs: the
// entity name-lookup queries (wells/locators/product meters/plants/RO
// trains), the raw readings queries per metric (locator/product/well/RO/
// power/cost), and the small supporting queries (power tariffs, CT bill
// multiplier, per-plant power config). Nothing in here does any math beyond
// what a single query needs to resolve its own `enabled` gate or shape its
// own result — the actual cross-query accumulation into daily rows lives in
// useTrendChartData.ts, which takes this hook's return value as its input.
//
// Moved verbatim from TrendChart.tsx — no logic changes. See git history /
// that file's original header comments for the "why" behind individual
// queries (bug-fix notes, meter-replacement handling, etc.), which were left
// in place on each query below exactly as they were.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

export function useTrendChartQueries({
  metric, plantIds, startISO, endISO, startKey, endKey,
}: {
  metric: string;
  plantIds: string[];
  startISO: string;
  endISO: string;
  startKey: string;
  endKey: string;
}) {
  const needsWellReadings = metric === 'nrw' || metric === 'rawwater' || metric === 'pv' || metric === 'productionCost';
  const needsProductMeterReadings = metric === 'production' || metric === 'nrw' || metric === 'pv' || metric === 'productionCost';
  const needsLocReadings = metric === 'production' || metric === 'nrw';
  const needsRoReadings = metric === 'recovery' || metric === 'tds' || metric === 'plantHealth';
  // productionCost also needs power readings (kWh delta × multiplier) and tariffs (₱/kWh).
  // 'kwh' = Power Consumption & Energy Mix chart (Solar vs Grid stacked bars).
  const needsPowerReadings = metric === 'pv' || metric === 'productionCost' || metric === 'kwh';
  // production_costs stores chem_cost (₱ per day) — still used for chemical side.
  // Power cost is now computed live: daily_kwh × rate_per_kwh / production_m3.
  const needsCostReadings = metric === 'productionCost';
  // needsPermeateProduction: we may need permeate_meter_delta from ro_train_readings
  // as the production source for plants where permeate_is_production = true.
  const needsPermeateProduction = metric === 'production' || metric === 'nrw' || metric === 'pv' || metric === 'productionCost';

  // ── Entity name lookups — fetched once per plant selection ─────────────────
  const { data: wellNames } = useQuery({
    queryKey: ['entity-names-wells', plantIds],
    queryFn: async () => {
      const { data } = await supabase.from('wells').select('id, name').in('plant_id', plantIds);
      const map = new Map<string, string>();
      (data ?? []).forEach((w: any) => map.set(w.id, w.name));
      return map;
    },
    enabled: plantIds.length > 0 && needsWellReadings,
  });

  const { data: locatorNames } = useQuery({
    queryKey: ['entity-names-locators', plantIds],
    queryFn: async () => {
      const { data } = await supabase.from('locators').select('id, name').in('plant_id', plantIds);
      const map = new Map<string, string>();
      (data ?? []).forEach((l: any) => map.set(l.id, l.name));
      return map;
    },
    enabled: plantIds.length > 0 && needsLocReadings,
  });

  const { data: productMeterNames } = useQuery({
    queryKey: ['entity-names-product-meters', plantIds],
    queryFn: async () => {
      const { data } = await (supabase.from('product_meters' as never) as any)
        .select('id, name').in('plant_id', plantIds);
      const map = new Map<string, string>();
      (data ?? []).forEach((m: any) => map.set(m.id, m.name));
      return map;
    },
    enabled: plantIds.length > 0 && needsProductMeterReadings,
  });

  // Product meters whose is_derived = true — mirrored/residual meters like
  // Mambaling's "HAMAS" (mirrored from SRP's derived "HAMAS (Mambaling)"
  // locator — see _directLocatorIds above). fn_sweep_derived_meters_for_date()
  // writes each day's already-computed volume straight into current_reading
  // and pins previous_reading at 0, so every row stands alone by design.
  // Without this set, computeEntityDeltas below diffs consecutive rows'
  // current_reading as if it were a rising cumulative meter — producing a
  // bogus, often-negative delta on any day the value happens to dip versus
  // the day before, instead of that day's true volume. Same root cause and
  // fix as DataSummaryModal.tsx's prodPivot (Production / Prod vs Consum
  // tabs) — this mirrors that fix here so the main trend chart agrees with
  // ProductSection.tsx's own History dialog for these meters.
  const { data: _directProductMeterIds } = useQuery({
    queryKey: ['trend-meter-direct-ids', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return new Set<string>();
      const { data } = await (supabase.from('product_meters' as never) as any)
        .select('id,is_derived')
        .in('plant_id', plantIds);
      return new Set<string>(
        (data ?? [])
          .filter((m: any) => m.is_derived === true)
          .map((m: any) => m.id as string),
      );
    },
    enabled: plantIds.length > 0 && needsProductMeterReadings,
  });

  // Plant names are used for power meter replacement messages and for the permeate-source
  // tooltip note when permeate_is_production = true.
  const { data: plantNames } = useQuery({
    queryKey: ['entity-names-plants', plantIds],
    queryFn: async () => {
      const { data } = await supabase.from('plants').select('id, name').in('id', plantIds);
      const map = new Map<string, string>();
      (data ?? []).forEach((p: any) => map.set(p.id, p.name));
      return map;
    },
    enabled: plantIds.length > 0 && (needsPowerReadings || needsPermeateProduction),
  });

  const supaSelect = async <T,>(table: string, cols: string) => {
    const { data, error } = await supabase.from(table as never).select(cols)
      .in('plant_id', plantIds).gte('reading_datetime', startISO).lte('reading_datetime', endISO);
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data as T[]) ?? [];
  };

  // ── BUG FIX: locator_readings has no plant_id column ─────────────────────
  // The previous implementation called supaSelect('locator_readings', ...)
  // which filtered by plant_id — a column that does NOT exist on that table.
  // This returned zero rows for every plant except SRP (which coincidentally
  // worked due to data characteristics), causing consumption = 0 for all
  // dates in the selected range (most visibly Jan 1 – Mar 21).
  //
  // Fix: two-step query that mirrors the pattern Dashboard.tsx already uses:
  //   Step 1 — resolve the locator IDs that belong to these plants (via the
  //             locators table, which DOES have plant_id).
  //   Step 2 — query locator_readings filtered by those locator IDs.
  //
  // The locator meta query is shared with the name-lookup query above but
  // we need the IDs before the readings query can run, so we keep it
  // separate and gate the readings query on the result.
  const { data: _locatorIdsForReadings } = useQuery({
    queryKey: ['trend-loc-ids', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [] as string[];
      const { data } = await supabase
        .from('locators')
        .select('id')
        .in('plant_id', plantIds)
        .eq('status', 'Active');
      return (data ?? []).map((l: any) => l.id as string);
    },
    enabled: plantIds.length > 0 && needsLocReadings,
  });

  // Locators whose default_input_mode = 'direct' OR is_derived = true — the
  // latter covers residual/mirrored locators like the SRP↔Mambaling HAMAS
  // pair, whose current_reading is a computed residual or a manual override,
  // never a cumulative meter value. Passed into computeEntityDeltas/
  // buildEntityPivot below so the chart line, the Overview table, and the
  // Data Summary popup all agree with the Locator detail page's
  // EntityHistoryChart, instead of trusting locator_readings.daily_volume
  // (only guaranteed correct for fn_sweep_derived_meters()'s own writes,
  // which always zero previous_reading — not guaranteed for a manual
  // override entered through the normal reading form).
  const { data: _directLocatorIds } = useQuery({
    queryKey: ['trend-loc-direct-ids', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return new Set<string>();
      const { data } = await supabase
        .from('locators').select('id,default_input_mode,is_derived')
        .in('plant_id', plantIds).eq('status', 'Active');
      return new Set(
        (data ?? [])
          .filter((l: any) => l.default_input_mode === 'direct' || l.is_derived === true)
          .map((l: any) => l.id as string),
      );
    },
    enabled: plantIds.length > 0 && needsLocReadings,
  });

  const { data: locReadings, isFetching: fetchingLoc, error: errLoc, refetch: refetchLoc } = useQuery({
    queryKey: ['trend-loc', metric, startKey, endKey, plantIds],
    queryFn: async () => {
      const locatorIds = _locatorIdsForReadings ?? [];
      if (!locatorIds.length) return [];
      const { data, error } = await supabase
        .from('locator_readings')
        .select('locator_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement,norm_status')
        .in('locator_id', locatorIds)
        .gte('reading_datetime', startISO)
        .lte('reading_datetime', endISO)
        .order('reading_datetime', { ascending: true });
      if (error) throw new Error(`locator_readings: ${error.message}`);
      return (data ?? []) as any[];
    },
    // Wait for locator IDs to resolve before fetching readings.
    enabled: plantIds.length > 0 && needsLocReadings && (_locatorIdsForReadings !== undefined),
    staleTime: 60_000,  // FIX (egress): was 0 (always stale), which let the background-sync sweep refetch this ahead of its own 60s interval
    refetchInterval: 60_000,
  });

  // Product meter readings — the treated-water output meters installed on
  // the product line. These are the authoritative source for Production volume,
  // distinct from well (raw water) meters and locator (distribution) meters.
  // The table is not in the generated Supabase types so we cast as `never`.
  const { data: productReadings, isFetching: fetchingProduct, error: errProduct, refetch: refetchProduct } = useQuery({
    queryKey: ['trend-product', metric, startKey, endKey, plantIds],
    queryFn: async () => {
      // Try with is_meter_replacement first; fall back gracefully if column
      // doesn't exist in this deployment (field will be undefined → false).
      const { data, error } = await (supabase.from('product_meter_readings' as never) as any)
        // Bug fix: include daily_volume so computeEntityDeltas can use it directly,
        // matching how locator_readings are handled (avoids boundary-read delta = 0).
        .select('meter_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement,plant_id,norm_status')
        .in('plant_id', plantIds)
        .gte('reading_datetime', startISO)
        .lte('reading_datetime', endISO);
      if (error) {
        if (error.message?.includes('is_meter_replacement')) {
          const { data: d2, error: e2 } = await (supabase.from('product_meter_readings' as never) as any)
            .select('meter_id,daily_volume,current_reading,previous_reading,reading_datetime,plant_id,norm_status')
            .in('plant_id', plantIds)
            .gte('reading_datetime', startISO)
            .lte('reading_datetime', endISO);
          if (e2) throw new Error(`product_meter_readings: ${e2.message}`);
          return (d2 as any[]) ?? [];
        }
        throw new Error(`product_meter_readings: ${error.message}`);
      }
      return (data as any[]) ?? [];
    },
    enabled: plantIds.length > 0 && needsProductMeterReadings,
    staleTime: 60_000,  // FIX (egress): was 0 (always stale), which let the background-sync sweep refetch this ahead of its own 60s interval
    refetchInterval: 60_000,
  });

  // ── Well readings — fetch with well_id so deltas are scoped per well ────────
  // Operations.tsx saves well readings with well_id + plant_id but never
  // writes daily_volume. Raw Water must therefore be computed as the sum of
  // (current_reading − previous_reading) per well per day, excluding rows
  // flagged is_meter_replacement and the first reading after a replacement.
  // Fetching well_id here (instead of relying on plant_id alone) lets
  // computeEntityDeltas group correctly by individual meter rather than by
  // plant, preventing cross-well subtraction that produced the -4,853,089 bug.
  const { data: wellReadings, isFetching: fetchingWell, error: errWell, refetch: refetchWell } = useQuery({
    queryKey: ['trend-well', metric, startKey, endKey, plantIds],
    queryFn: () => supaSelect<any>(
      'well_readings',
      'well_id,current_reading,previous_reading,daily_volume,reading_datetime,is_meter_replacement,plant_id,norm_status',
    ),
    enabled: plantIds.length > 0 && needsWellReadings,
    staleTime: 60_000,  // FIX (egress): was 0 (always stale), which let the background-sync sweep refetch this ahead of its own 60s interval
    refetchInterval: 60_000,
  });

  // ── BUG FIX: ro_train_readings may not have plant_id (same as locator_readings).
  // Two-step query: resolve train IDs for these plants first, then fetch readings
  // filtered by train_id. This mirrors the locator_readings fix above.
  // Also builds a trainId→plantId map used to route permeate_meter_delta back to
  // the correct plant when permeate_is_production is active.
  const { data: _roTrainMeta } = useQuery({
    queryKey: ['trend-ro-train-ids', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return { ids: [] as string[], trainPlantMap: new Map<string, string>(), trainUnitTypeMap: new Map<string, string>() };
      const { data } = await (supabase.from('ro_trains' as never) as any)
        .select('id, plant_id, unit_type')
        .in('plant_id', plantIds);
      const rows = data ?? [];
      const trainPlantMap = new Map<string, string>();
      const trainUnitTypeMap = new Map<string, string>();
      rows.forEach((t: any) => {
        trainPlantMap.set(t.id, t.plant_id);
        trainUnitTypeMap.set(t.id, t.unit_type ?? 'primary');
      });
      return { ids: rows.map((t: any) => t.id as string), trainPlantMap, trainUnitTypeMap };
    },
    enabled: plantIds.length > 0,
  });
  const _roTrainIdsForReadings = _roTrainMeta?.ids;
  const _trainPlantMap = _roTrainMeta?.trainPlantMap ?? new Map<string, string>();
  // Secondary (2nd-pass) units — e.g. Potable-RO, Refilling-RO — draw their
  // feed from an upstream PRIMARY train's permeate, already counted via that
  // train's own reading. Included in _roTrainIdsForReadings/_trainPlantMap
  // (still shown in RO readings/Plant Health elsewhere in this chart) but
  // excluded from the production accumulation below.
  const _trainUnitTypeMap = _roTrainMeta?.trainUnitTypeMap ?? new Map<string, string>();

  const { data: roReadings, isFetching: fetchingRo, error: errRo, refetch: refetchRo } = useQuery({
    queryKey: ['trend-ro', metric, startKey, endKey, plantIds, _roTrainIdsForReadings],
    queryFn: async () => {
      const trainIds = _roTrainIdsForReadings ?? [];
      if (!trainIds.length) return [];

      // Attempt full select including the new columns added in the permeate-delta
      // migration (permeate_meter_prev, permeate_meter_delta).
      // permeate_production_date is intentionally excluded — date bucketing always
      // uses reading_datetime directly so every reading is attributed to the calendar
      // day it was actually recorded, with no cutoff-time shift.
      // If the DB hasn't been migrated yet those columns don't exist and Supabase
      // returns a schema-cache error — fall back to the legacy select so the chart
      // never breaks on un-migrated deployments.
      const FULL_SELECT   = 'train_id,recovery_pct,permeate_tds,permeate_meter,permeate_meter_prev,permeate_meter_delta,reading_datetime,is_meter_replacement';
      const LEGACY_SELECT = 'train_id,recovery_pct,permeate_tds,permeate_meter,reading_datetime,is_meter_replacement';
      const NEW_COLS = ['permeate_meter_prev', 'permeate_meter_delta'];
      const isNewColError = (msg: string) => NEW_COLS.some(c => msg.includes(c));

      const { data, error } = await (supabase.from('ro_train_readings' as never) as any)
        .select(FULL_SELECT)
        .in('train_id', trainIds)
        .gte('reading_datetime', startISO)
        .lte('reading_datetime', endISO)
        .order('reading_datetime', { ascending: true });
      if (error) {
        if (isNewColError(error.message)) {
          const { data: d2, error: e2 } = await (supabase.from('ro_train_readings' as never) as any)
            .select(LEGACY_SELECT)
            .in('train_id', trainIds)
            .gte('reading_datetime', startISO)
            .lte('reading_datetime', endISO)
            .order('reading_datetime', { ascending: true });
          if (e2) throw new Error(`ro_train_readings: ${e2.message}`);
          return (d2 ?? []) as any[];
        }
        throw new Error(`ro_train_readings: ${error.message}`);
      }
      return (data ?? []) as any[];
    },
    enabled: plantIds.length > 0 && (needsRoReadings || needsPermeateProduction) && (_roTrainIdsForReadings !== undefined),
    staleTime: 60_000,  // FIX (egress): was 0 (always stale), which let the background-sync sweep refetch this ahead of its own 60s interval
    refetchInterval: 60_000,
  });

  // RO train name lookup — reuses the IDs already fetched above
  const { data: roTrainNames } = useQuery({
    queryKey: ['entity-names-ro-trains', plantIds],
    queryFn: async () => {
      const { data } = await (supabase.from('ro_trains' as never) as any)
        .select('id, name')
        .in('plant_id', plantIds);
      const map = new Map<string, string>();
      (data ?? []).forEach((t: any) => map.set(t.id, t.name ?? `Train ${String(t.id).slice(-4)}`));
      return map;
    },
    enabled: plantIds.length > 0 && (needsRoReadings || needsPermeateProduction),
  });

  // ── Plant meter config — fetch permeate_is_production flag per plant ────────
  // The entire PlantMeterConfig is stored as a single JSONB blob in the `config`
  // column (not as individual columns) — mirrors usePlantMeterConfig in Plants.tsx.
  // permeate_is_production lives at config.permeate_is_production inside that blob.
  // Permeate production config per plant — includes cut-off and date range settings.
  // Returns both a Set (for fast membership checks) and a detailed Map for bucketing.
  const { data: permeateConfigData } = useQuery({
    queryKey: ['plant-meter-config-permeate', plantIds],
    queryFn: async () => {
      const { data } = await (supabase.from('plant_meter_config' as any) as any)
        .select('plant_id, permeate_is_production, config')
        .in('plant_id', plantIds);
      const permeateCounts = new Set<string>();
      // Plants in EXCLUSIVE permeate mode (ro_production_source === 'permeate')
      // measure the same water on their product meter as on the RO permeate
      // meter — Step 1 below must exclude their product-meter readings to avoid
      // double-counting. Plants in 'both' mode have two independent sources and
      // keep BOTH their product meter reading (Step 1) and their permeate delta
      // (Step 2) — they stay OUT of this set.
      const productExcluded = new Set<string>();
      (data ?? []).forEach((row: any) => {
        // permeate_is_production is a DB-trigger-maintained mirror of
        // config.permeate_is_production (see the plant_meter_config migration) —
        // checking both is harmless redundancy, not two independent signals.
        // ro_production_source is NOT part of this check: it describes intended
        // mode, not whether permeate is active right now. A plant can have
        // ro_production_source: 'both' while the switch is deliberately off (see
        // MeterConfig.tsx's "⚠ permeate switch off" warning) — treating
        // ro_production_source as a fallback here previously overrode that
        // explicit "off" and silently re-activated paused permeate production.
        const permeateOn = row.permeate_is_production === true || row.config?.permeate_is_production === true;
        if (permeateOn) permeateCounts.add(row.plant_id);
        // Requiring permeateOn here too: without it, a plant with
        // ro_production_source: 'permeate' but the switch paused would lose its
        // product meter AND get no permeate credit — zero production shown.
        if (row.config?.ro_production_source === 'permeate' && permeateOn) productExcluded.add(row.plant_id);
      });
      return { permeateCounts, productExcluded };
    },
    enabled: plantIds.length > 0 && needsPermeateProduction,
  });
  const permeateIsProductionPlants = permeateConfigData?.permeateCounts;
  const productExcludedPlants      = permeateConfigData?.productExcluded;


  // Power readings — fetches the full ordered history for each plant so
  // computeEntityDeltas can diff consecutive meter_reading_kwh values correctly.
  // We also grab one row BEFORE startISO (per plant) to seed the delta for
  // the very first in-window reading — without it the first bar is always 0.
  const { data: powerReadings, isFetching: fetchingPower, error: errPower, refetch: refetchPower } = useQuery({
    queryKey: ['trend-power', metric, startKey, endKey, plantIds],
    queryFn: async () => {
      // Fetch in-window rows (standard path)
      const inWindow = await supaSelect<any>(
        'power_readings',
        'daily_consumption_kwh,daily_solar_kwh,daily_grid_kwh,meter_reading_kwh,grid_meter_readings,multiplier,reading_datetime,is_meter_replacement,plant_id',
      );
      // For each plant, fetch the single most-recent row BEFORE the window to
      // establish a delta baseline for the first in-window reading.
      const preRows: any[] = [];
      await Promise.all(
        plantIds.map(async (pid) => {
          const { data } = await (supabase.from('power_readings' as never) as any)
            .select('daily_consumption_kwh,daily_solar_kwh,daily_grid_kwh,meter_reading_kwh,grid_meter_readings,multiplier,reading_datetime,is_meter_replacement,plant_id')
            .eq('plant_id', pid)
            .lt('reading_datetime', startISO)
            .order('reading_datetime', { ascending: false })
            .limit(1);
          if (data?.[0]) preRows.push(data[0]);
        }),
      );
      // Merge pre-window rows at the front, then sort ascending so
      // computeEntityDeltas sees them in chronological order.
      return [...preRows, ...inWindow].sort(
        (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
      );
    },
    enabled: plantIds.length > 0 && needsPowerReadings,
    staleTime: 60_000,  // FIX (egress): was 0 (always stale), which let the background-sync sweep refetch this ahead of its own 60s interval
    refetchInterval: 60_000,
  });

  // Chemical cost comes from TWO sources which are merged per day:
  //   1. production_costs.chem_cost  — legacy manual entry (₱/day)
  //   2. chemical_dosing_logs — operator dosing records
  //      Uses calculated_cost when > 0, otherwise falls back to
  //      qty × unit_price (same logic as ROTrains dosing history display).
  //      Old records saved before prices were configured have calculated_cost = 0.
  //   Chem Cost (₱/m³) = total_chem_₱_per_day / production_m3
  const { data: costReadings, isFetching: fetchingCost, error: errCost, refetch: refetchCost } = useQuery({
    queryKey: ['trend-cost', metric, startKey, endKey, plantIds],
    queryFn: async () => {
      const today = format(new Date(), 'yyyy-MM-dd');
      // Fetch all three sources in parallel
      const [prodCostRes, dosingRes, pricesRes] = await Promise.all([
        supabase.from('production_costs')
          .select('cost_date,chem_cost,plant_id')
          .in('plant_id', plantIds)
          .gte('cost_date', startKey)
          .lte('cost_date', endKey),
        supabase.from('chemical_dosing_logs')
          .select('log_datetime,calculated_cost,plant_id,chlorine_kg,smbs_kg,anti_scalant_l,soda_ash_kg')
          .in('plant_id', plantIds)
          .gte('log_datetime', `${startKey}T00:00:00`)
          .lte('log_datetime', `${endKey}T23:59:59`),
        supabase.from('chemical_prices')
          .select('chemical_name,unit_price')
          .lte('effective_date', today)
          .order('effective_date', { ascending: false }),
      ]);
      if (prodCostRes.error) throw new Error(`production_costs: ${prodCostRes.error.message}`);
      if (dosingRes.error)   throw new Error(`chemical_dosing_logs: ${dosingRes.error.message}`);

      // Build price lookup map (first price per chemical name = most recent)
      const priceMap: Record<string, number> = {};
      for (const p of (pricesRes.data ?? []) as any[]) {
        // Strip "(unit)" suffix to get base name, same as ROTrains
        const base = (p.chemical_name as string).replace(/\s*\([^)]+\)\s*$/, '').trim();
        if (!(p.chemical_name in priceMap)) priceMap[p.chemical_name] = +p.unit_price;
        if (!(base in priceMap))            priceMap[base]            = +p.unit_price;
      }

      // chemical_name → dosing quantity field (matches DOSING_KEYS in ROTrains)
      const DOSING_KEYS = [
        { key: 'chlorine_kg',    name: 'Chlorine'    },
        { key: 'smbs_kg',        name: 'SMBS'        },
        { key: 'anti_scalant_l', name: 'Anti Scalant'},
        { key: 'soda_ash_kg',    name: 'Soda Ash'    },
      ];

      // Build map: `${plant_id}|${yyyy-MM-dd}` → accumulated ₱
      const costMap = new Map<string, number>();

      // 1. Seed from production_costs (manual entries)
      for (const r of (prodCostRes.data ?? []) as any[]) {
        const k = `${r.plant_id}|${r.cost_date}`;
        costMap.set(k, (costMap.get(k) ?? 0) + +(r.chem_cost ?? 0));
      }

      // 2. Merge dosing logs — mirror ROTrains fallback: use calculated_cost
      //    when > 0, else compute live from qty × price
      for (const r of (dosingRes.data ?? []) as any[]) {
        const storedCost = +r.calculated_cost || 0;
        const liveCost   = DOSING_KEYS.reduce(
          (s, c) => s + (+r[c.key] || 0) * (priceMap[c.name] ?? 0), 0,
        );
        const cost = storedCost > 0 ? storedCost : liveCost;
        if (cost <= 0) continue;
        const dateKey = format(new Date(r.log_datetime), 'yyyy-MM-dd');
        const k = `${r.plant_id}|${dateKey}`;
        costMap.set(k, (costMap.get(k) ?? 0) + cost);
      }

      // Return flat array in the shape the accumulator below expects
      return Array.from(costMap.entries()).map(([key, chem_cost]) => {
        const [plant_id, cost_date] = key.split('|');
        return { plant_id, cost_date, chem_cost };
      });
    },
    enabled: plantIds.length > 0 && needsCostReadings,
    staleTime: 60_000,  // FIX (egress): was 0 (always stale), which let the background-sync sweep refetch this ahead of its own 60s interval
    refetchInterval: 60_000,
  });

  // Power tariffs: rate_per_kwh (₱/kWh) effective on or before each day.
  // Source of truth: Costs → Power tab auto-derives this from each monthly bill.
  // For a given day, we use the latest tariff whose effective_date ≤ that day.
  // We fetch all tariffs in a wide window so we can look up per-day rates in JS.
  const { data: powerTariffs } = useQuery({
    queryKey: ['trend-power-tariffs', plantIds],
    queryFn: async () => {
      const { data, error } = await supabase.from('power_tariffs')
        .select('plant_id,effective_date,rate_per_kwh,multiplier')
        .in('plant_id', plantIds)
        .order('effective_date', { ascending: true });
      if (error) throw new Error(`power_tariffs: ${error.message}`);
      return (data as any[]) ?? [];
    },
    enabled: plantIds.length > 0 && needsCostReadings,
  });

  // CT multiplier from electric_bills — mirrors PowerChart's authoritative multiplier source.
  // TrendChart's power-delta computation falls back to power_readings.multiplier, then to 1.
  // Adding the bill multiplier as an intermediate fallback matches PowerChart behaviour exactly,
  // ensuring the kwh bars are correct even when individual reading rows lack a multiplier value.
  // Only fetched for the `kwh` metric so other metrics don't pay the extra Supabase round-trip.
  const { data: billMultiplierMap } = useQuery({
    queryKey: ['trend-bill-multipliers', plantIds],
    queryFn: async () => {
      const map = new Map<string, number>();
      try {
        const { data } = await (supabase.from('electric_bills' as never) as any)
          .select('plant_id,multiplier')
          .in('plant_id', plantIds)
          .order('billing_month', { ascending: false });
        for (const b of (data ?? []) as any[]) {
          // Keep only the FIRST (most-recent) entry per plant — query is DESC by billing_month.
          if (!map.has(b.plant_id) && +(b.multiplier ?? 0) > 0)
            map.set(b.plant_id, +b.multiplier);
        }
      } catch { /* electric_bills table may not exist — silently default to row.multiplier */ }
      return map;
    },
    enabled: plantIds.length > 0 && metric === 'kwh',
    // staleTime 0: a stale multiplier causes newly-inserted readings to show
    // the raw meter delta instead of the CT-multiplied kWh value. Always
    // revalidate so the chart is correct immediately after any insert.
    staleTime: 0,
  });

  // Per-plant, per-meter CT multiplier arrays from plant_power_config.
  // Used by the power delta computation below (mirrors Plants.tsx priority order).
  // Falls back to billMultiplierMap / 1 when the table is absent.
  const { data: powerConfigMap } = useQuery({
    queryKey: ['trend-power-config', plantIds],
    queryFn: async () => {
      const map = new Map<string, number[]>();
      try {
        const { data } = await (supabase.from('plant_power_config' as never) as any)
          .select('plant_id,grid_meter_multipliers')
          .in('plant_id', plantIds);
        for (const cfg of (data ?? []) as any[]) {
          const mArr = cfg.grid_meter_multipliers;
          if (Array.isArray(mArr) && mArr.length > 0)
            map.set(cfg.plant_id, mArr.map((v: any) => +v > 0 ? +v : 1));
        }
      } catch { /* plant_power_config table may not exist — keep defaults */ }
      return map;
    },
    enabled: plantIds.length > 0 && metric === 'kwh',
    staleTime: 0,
  });

  const isFetching = fetchingLoc || fetchingWell || fetchingRo || fetchingPower || fetchingCost || fetchingProduct;
  const queryError = (errLoc || errWell || errRo || errPower || errCost || errProduct) as Error | null;
  // Only re-fires the query(ies) that actually failed — a locator fetch
  // succeeding shouldn't get re-run just because the RO one timed out.
  // "TypeError: Failed to fetch" (the error shape shown in the toast — see
  // App.tsx's queryCache.onError) is a browser-level failure to complete the
  // request at all (network drop, an ad-blocker/privacy extension blocking
  // the Supabase domain, a brief Supabase outage) — not a database or RLS
  // error, which would come back as a normal Postgrest error body instead.
  // React Query already retries once and re-fetches on reconnect
  // automatically, but until now there was no way to just try again by hand
  // without reloading the whole page.
  const retryFailedQueries = () => {
    if (errLoc) refetchLoc();
    if (errWell) refetchWell();
    if (errRo) refetchRo();
    if (errPower) refetchPower();
    if (errCost) refetchCost();
    if (errProduct) refetchProduct();
  };

  return {
    wellNames, locatorNames, productMeterNames, _directProductMeterIds, plantNames,
    _locatorIdsForReadings, _directLocatorIds,
    locReadings, fetchingLoc, errLoc, refetchLoc,
    productReadings, fetchingProduct, errProduct, refetchProduct,
    wellReadings, fetchingWell, errWell, refetchWell,
    _roTrainIdsForReadings, _trainPlantMap, _trainUnitTypeMap,
    roReadings, fetchingRo, errRo, refetchRo,
    roTrainNames, permeateConfigData, permeateIsProductionPlants, productExcludedPlants,
    powerReadings, fetchingPower, errPower, refetchPower,
    costReadings, fetchingCost, errCost, refetchCost,
    powerTariffs, billMultiplierMap, powerConfigMap,
    isFetching, queryError, retryFailedQueries,
  };
}
