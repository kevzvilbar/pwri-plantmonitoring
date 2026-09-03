// Split out of Dashboard.tsx (was 2,204 lines) as part of a file-size
// cleanup pass — same treatment as TrendChart.tsx got in the same pass
// (see useTrendChartQueries.ts for the pattern this follows). This module
// owns every Supabase read the dashboard needs for "today"/"yesterday"
// stat cards: entity-ID resolution, today's/yesterday's readings per
// entity type, RO permeate (incl. permeate-as-production plants), power,
// pretreatment, pump readings, and today's cost rows.
//
// Moved verbatim from Dashboard.tsx — no logic changes. Individual queries
// keep their original inline bug-fix/rationale comments.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, subDays } from 'date-fns';
import { ALERTS } from '@/lib/calculations';
import { computeROAverageFlowRate, evaluatePhaseImbalance, type ROMeterKind } from '@/lib/roReadingGuards';
import { computeRollingAverageRateFromDeltas, type VolumePoint } from '@/lib/flowRateGuards';

export function useDashboardQueries({
  plantIds, today, yesterday, _localDateStr, _yesterdayKey, plants,
}: {
  plantIds: string[];
  today: string;
  yesterday: string;
  _localDateStr: string;
  _yesterdayKey: string;
  plants: any[] | undefined;
}) {
  const { data: _locatorIds } = useQuery({
    queryKey: ['dash-locator-ids', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [] as string[];
      const { data, error } = await supabase
        .from('locators').select('id').in('plant_id', plantIds).eq('status', 'Active');
      if (error) throw error;
      return (data ?? []).map((l: any) => l.id as string);
    },
    enabled: plantIds.length > 0,
  });

  // Locators to treat as "direct volume" for the stat cards below — either the
  // manager-configured default_input_mode='direct' toggle, OR any is_derived
  // (residual/mirrored) locator such as the SRP↔Mambaling HAMAS pair: its
  // current_reading is a computed residual or a manual override, never a
  // cumulative meter value. Without this, the stat cards trust
  // locator_readings.daily_volume, which is only correct if previous_reading
  // was zeroed for these rows — true for fn_sweep_derived_meters()'s own
  // writes, NOT guaranteed for a manual override entered through the normal
  // reading form. Mirrors the isDirectMode branch in EntityHistoryChart.tsx.
  const { data: _directLocatorIds } = useQuery({
    queryKey: ['dash-locator-direct-ids', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return new Set<string>();
      const { data, error } = await supabase
        .from('locators').select('id,default_input_mode,is_derived')
        .in('plant_id', plantIds).eq('status', 'Active');
      if (error) throw error;
      return new Set(
        (data ?? [])
          .filter((l: any) => l.default_input_mode === 'direct' || l.is_derived === true)
          .map((l: any) => l.id as string),
      );
    },
    enabled: plantIds.length > 0,
  });

  // Product meters to treat as "direct volume" for the stat cards below —
  // is_derived mirrored meters such as Mambaling's "HAMAS" (mirrored from
  // SRP's derived "HAMAS (Mambaling)" locator, see _directLocatorIds above).
  // Same reasoning: fn_sweep_derived_meters_for_date() pins previous_reading
  // at 0 and writes each day's already-computed volume straight into
  // current_reading, so these rows have no cumulative chain to diff. Usually
  // a no-op here since today's/yesterday's window normally holds one row per
  // meter (falls through to the stored daily_volume, itself correct for
  // these meters) — but if more than one reading was recorded the same day
  // (e.g. a correction), the second row would otherwise self-heal-diff
  // against the first as if it were a rising cumulative meter. Mirrors
  // DataSummaryModal.tsx's identical fix for its Production pivot.
  const { data: _directProductMeterIds } = useQuery({
    queryKey: ['dash-meter-direct-ids', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return new Set<string>();
      const { data, error } = await (supabase.from('product_meters' as any) as any)
        .select('id,is_derived').in('plant_id', plantIds);
      if (error) throw error;
      return new Set<string>(
        (data ?? []).filter((m: any) => m.is_derived === true).map((m: any) => m.id as string),
      );
    },
    enabled: plantIds.length > 0,
  });

  const { data: _wellIds } = useQuery({
    queryKey: ['dash-well-ids', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [] as string[];
      const { data, error } = await supabase.from('wells').select('id').in('plant_id', plantIds);
      if (error) throw error;
      return (data ?? []).map((w: any) => w.id as string);
    },
    enabled: plantIds.length > 0,
  });

  const { data: todayLocators } = useQuery({
    queryKey: ['dash-loc-today', _locatorIds, today],
    queryFn: async () => {
      if (!_locatorIds?.length) return [];
      // FIX: Added .lte upper bound so the query is strictly scoped to the
      // current calendar day. Without it, any reading timestamped after
      // midnight (e.g. timezone drift, future-dated rows) would be included
      // and computePivotFromReadings would treat the full cumulative meter
      // value as a single-day delta — producing the "-898,003" spike seen
      // in the Prod. vs Consum. tab.
      const todayEnd = new Date(_localDateStr + 'T23:59:59').toISOString();
      const { data, error } = await supabase
        .from('locator_readings_clean' as any)
        .select('locator_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement,is_estimated')
        .in('locator_id', _locatorIds)
        .gte('reading_datetime', today)
        .lte('reading_datetime', todayEnd)
        .order('reading_datetime', { ascending: true });
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: (_locatorIds?.length ?? 0) > 0,
    staleTime: 60_000,  // FIX (egress): matched to refetchInterval below — was 30_000, which let the app-wide background-sync sweep force-refetch this before its own 60s timer was due
    refetchInterval: 60_000,
  });

  const { data: todayWells } = useQuery({
    queryKey: ['dash-wells-today', _wellIds, today],
    queryFn: async () => {
      if (!_wellIds?.length) return [];
      // FIX: Bounded to current calendar day — mirrors the todayLocators fix.
      const todayEnd = new Date(_localDateStr + 'T23:59:59').toISOString();
      // Try to fetch quality columns (tds_ppm, turbidity_ntu) — these are optional
      // migration columns that may not exist in all environments yet. Fall back to
      // base columns only if PostgREST returns a schema-cache error.
      const { data, error } = await (supabase
        .from('well_readings_clean' as any) as any)
        .select('well_id,plant_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement,tds_ppm,turbidity_ntu')
        .in('well_id', _wellIds)
        .gte('reading_datetime', today)
        .lte('reading_datetime', todayEnd)
        .order('reading_datetime', { ascending: true });
      if (!error) return (data ?? []) as any[];
      // Fallback: base columns without quality fields
      const { data: fallback, error: fallbackErr } = await supabase
        .from('well_readings_clean' as any)
        .select('well_id,plant_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement')
        .in('well_id', _wellIds)
        .gte('reading_datetime', today)
        .lte('reading_datetime', todayEnd)
        .order('reading_datetime', { ascending: true });
      // Was: fallback's own error discarded too — meaning a genuine failure
      // of BOTH attempts (not just missing quality columns) silently
      // resolved to []. Throw the fallback's error if it also failed.
      if (fallbackErr) throw fallbackErr;
      return (fallback ?? []) as any[];
    },
    enabled: (_wellIds?.length ?? 0) > 0,
    staleTime: 60_000,  // FIX (egress): matched to refetchInterval below — was 30_000, which let the app-wide background-sync sweep force-refetch this before its own 60s timer was due
    refetchInterval: 60_000,
  });
  // Production = sum of Product Meter deltas (treated/distributed water)
  const { data: todayProductMeters } = useQuery({
    queryKey: ['dash-product-meters-today', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const { data: meters, error: metersErr } = await (supabase.from('product_meters' as any) as any)
        .select('id').in('plant_id', plantIds);
      if (metersErr) throw metersErr;
      const meterIds = (meters ?? []).map((m: any) => m.id);
      if (!meterIds.length) return [];
      // FIX: Bounded to current calendar day — mirrors the todayLocators fix.
      const todayEnd = new Date(_localDateStr + 'T23:59:59').toISOString();
      const { data, error } = await (supabase.from('product_meter_readings' as any) as any)
        .select('meter_id,plant_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement')
        .in('meter_id', meterIds)
        .gte('reading_datetime', today)
        .lte('reading_datetime', todayEnd)
        .order('reading_datetime', { ascending: true });
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: plantIds.length > 0,
    staleTime: 60_000,  // FIX (egress): matched to refetchInterval below — was 30_000, which let the app-wide background-sync sweep force-refetch this before its own 60s timer was due
    refetchInterval: 60_000,
  });

  // ── Plant meter configs — detect which plants use RO permeate as production ──
  // When permeate_is_production=true the permeate meter delta in ro_train_readings
  // IS the production figure; those rows must be included in the Dashboard production
  // total and the NRW / PV-ratio calculations that depend on it.
  //
  // FIX: Select permeate_is_production as a direct column (mirrors DataSummaryModal)
  // in addition to the config JSONB blob. The original query only read the blob and
  // checked row.config?.permeate_is_production which was undefined when the flag is
  // stored as a real column, causing permeateProductionPlantIds to always be empty.
  const { data: plantMeterConfigs } = useQuery({
    queryKey: ['dash-plant-meter-configs', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [] as any[];
      const { data, error } = await (supabase.from('plant_meter_config' as any) as any)
        .select('plant_id, permeate_is_production, config')
        .in('plant_id', plantIds);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: plantIds.length > 0,
    staleTime: 60_000, // config rarely changes — cache for 1 min
  });

  // Plant IDs that use the RO permeate meter as (part of) their production source.
  // permeate_is_production is a DB-trigger-maintained mirror of
  // config.permeate_is_production (fn_sync_permeate_is_production fires on every
  // write — see the plant_meter_config migration), so the top-level column and
  // the jsonb value can never legitimately disagree; checking both is just
  // harmless redundancy for rows written before that trigger existed.
  //
  // ro_production_source deliberately is NOT part of this check (it previously
  // was, as a "belt-and-suspenders" fallback — that was the actual bug). It
  // describes intended MODE, not whether permeate is active right now: a plant
  // can have ro_production_source: 'both' while permeate_is_production is off
  // (see MeterConfig.tsx's own "⚠ permeate switch off" warning badge for this
  // exact, valid, intentional paused state). Falling back to ro_production_source
  // silently overrides that explicit "off" and re-activates production the
  // admin had just paused.
  const permeateProductionPlantIds = useMemo(() => {
    return (plantMeterConfigs ?? [])
      .filter((row: any) => row.permeate_is_production === true || row.config?.permeate_is_production === true)
      .map((row: any) => row.plant_id as string);
  }, [plantMeterConfigs]);

  // Plants in EXCLUSIVE permeate mode AND where permeate is actually active
  // right now — their product meter reads the same water the RO permeate meter
  // already counts, so `meterTotal` below must exclude their product-meter
  // readings to avoid double-counting. Plants in 'both' mode (two genuinely
  // independent sources) are NOT in this set. Requiring the switch to actually
  // be on matters: without it, a paused-permeate plant in 'permeate' mode would
  // lose its product meter AND get no permeate credit — zero production shown,
  // worse than the double-counting this guards against.
  // Matches TrendChart.tsx / DataSummaryModal.tsx.
  const productExcludedPlantIds = useMemo(() => new Set<string>(
    (plantMeterConfigs ?? [])
      .filter((row: any) =>
        row.config?.ro_production_source === 'permeate' &&
        (row.permeate_is_production === true || row.config?.permeate_is_production === true))
      .map((row: any) => row.plant_id as string),
  ), [plantMeterConfigs]);

  // ── Step 1: Resolve RO train IDs for permeate-production plants ─────────────
  // CRITICAL FIX (mirrors TrendChart.tsx line 1070):
  // ro_train_readings does NOT have a plant_id column. Querying it with
  // .in('plant_id', ...) always returns 0 rows — the root cause of Production
  // Volume showing 0 despite permeate data existing. Must first resolve train IDs
  // from ro_trains, then filter ro_train_readings by train_id.
  const { data: _permeateTrainMeta } = useQuery({
    queryKey: ['dash-permeate-train-ids', permeateProductionPlantIds],
    queryFn: async () => {
      if (!permeateProductionPlantIds.length) return { ids: [] as string[], trainPlantMap: new Map<string, string>() };
      const { data, error } = await supabase
        .from('ro_trains')
        .select('id, plant_id, unit_type' as any)
        .in('plant_id', permeateProductionPlantIds);
      if (error) throw error;
      // Secondary (2nd-pass) units — e.g. Potable-RO, Refilling-RO — draw
      // their feed from an upstream PRIMARY train's permeate, which is
      // already counted in this same sum via that upstream train's own
      // reading. Counting a secondary unit's permeate here too would double
      // count that volume — it's the same water, metered twice. See
      // 20260813_secondary_ro_train_wiring.sql / ro_trains.unit_type.
      const rows = ((data ?? []) as any[]).filter((t: any) => t.unit_type !== 'secondary');
      const trainPlantMap = new Map<string, string>();
      rows.forEach((t: any) => trainPlantMap.set(t.id as string, t.plant_id as string));
      return { ids: rows.map((t: any) => t.id as string), trainPlantMap };
    },
    enabled: permeateProductionPlantIds.length > 0,
    staleTime: 60_000,
  });
  const _permeateTrainIds      = _permeateTrainMeta?.ids ?? [];
  const _permeateTrainPlantMap = _permeateTrainMeta?.trainPlantMap ?? new Map<string, string>();

  // ── Step 2: Fetch today's permeate readings filtered by train_id ─────────────
  const { data: todayRoPermeate } = useQuery({
    queryKey: ['dash-ro-permeate-today', _permeateTrainIds, _localDateStr],
    queryFn: async () => {
      if (!_permeateTrainIds.length) return [] as any[];
      const windowStart = new Date(_localDateStr + 'T00:00:00').toISOString();
      const windowEnd   = new Date(_localDateStr + 'T23:59:59').toISOString();
      const { data, error } = await (supabase.from('ro_train_readings' as any) as any)
        .select('train_id,permeate_meter_delta,reading_datetime')
        .in('train_id', _permeateTrainIds)
        .gte('reading_datetime', windowStart)
        .lte('reading_datetime', windowEnd)
        .not('permeate_meter_delta', 'is', null)
        .gt('permeate_meter_delta', 0);
      if (error) throw error;
      // Attach plant_id via the trainPlantMap so downstream code can group by plant if needed
      return (data ?? []).map((r: any) => ({
        ...r,
        plant_id: _permeateTrainPlantMap.get(r.train_id) ?? null,
      }));
    },
    enabled: _permeateTrainIds.length > 0,
    staleTime: 60_000,  // FIX (egress): matched to refetchInterval below — was 30_000, which let the app-wide background-sync sweep force-refetch this before its own 60s timer was due
    refetchInterval: 60_000,
  });

  // Yesterday's RO permeate — same two-step pattern.
  const _dayBeforeYesterdayKey = useMemo(
    () => format(subDays(new Date(_yesterdayKey), 1), 'yyyy-MM-dd'),
    [_yesterdayKey],
  );
  const { data: yRoPermeate } = useQuery({
    queryKey: ['dash-ro-permeate-yest', _permeateTrainIds, _yesterdayKey],
    queryFn: async () => {
      if (!_permeateTrainIds.length) return [] as any[];
      const windowStart = new Date(_yesterdayKey + 'T00:00:00').toISOString();
      const windowEnd   = new Date(_yesterdayKey + 'T23:59:59').toISOString();
      const { data, error } = await (supabase.from('ro_train_readings' as any) as any)
        .select('train_id,permeate_meter_delta,reading_datetime')
        .in('train_id', _permeateTrainIds)
        .gte('reading_datetime', windowStart)
        .lte('reading_datetime', windowEnd)
        .not('permeate_meter_delta', 'is', null)
        .gt('permeate_meter_delta', 0);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        ...r,
        plant_id: _permeateTrainPlantMap.get(r.train_id) ?? null,
      }));
    },
    enabled: _permeateTrainIds.length > 0,
    staleTime: 12 * 60 * 60_000,  // yesterday is immutable
    refetchInterval: false,
  });
  // Power readings — today first, fall back to most-recent per plant if today is empty.
  // powerIsStale is set when the displayed value came from a prior day.
  // Fetches raw meter fields (meter_reading_kwh, grid_meter_readings) so the kWh stat
  // can be computed from raw readings first — matching the "Last 7 readings" panel
  // instead of relying on the potentially-stale stored daily_consumption_kwh.
  const { data: todayPowerRaw } = useQuery({
    queryKey: ['dash-power-today', plantIds, today],
    queryFn: async () => {
      if (!plantIds.length) return { rows: [] as any[], prevRows: [] as any[], isStale: false };
      const { data: todayData, error: todayErr } = await supabase
        .from('power_readings')
        .select('daily_consumption_kwh,daily_grid_kwh,meter_reading_kwh,grid_meter_readings,is_meter_replacement,plant_id,reading_datetime')
        .in('plant_id', plantIds)
        .gte('reading_datetime', today);
      if (todayErr) throw todayErr;
      // Fetch the most-recent row BEFORE today for each plant (delta baseline)
      const prevRows: any[] = [];
      await Promise.all(plantIds.map(async (pid) => {
        // Deliberately soft-fail per plant here (unlike the two queries
        // above) — one plant's lookup failing shouldn't abort Promise.all
        // and kill the power card for every other plant. Was fully silent
        // though; at least log it so a persistent per-plant issue is
        // debuggable instead of just "that plant's delta looks a bit off."
        const { data, error } = await supabase
          .from('power_readings')
          .select('meter_reading_kwh,grid_meter_readings,plant_id,reading_datetime')
          .eq('plant_id', pid).lt('reading_datetime', today)
          .order('reading_datetime', { ascending: false }).limit(1);
        if (error) { console.warn('[Dashboard] prevRow lookup failed for plant', pid, error); return; }
        if (data?.[0]) prevRows.push(data[0]);
      }));
      if ((todayData ?? []).length) return { rows: todayData!, prevRows, isStale: false };
      // Fallback: latest reading per plant
      const { data: recent, error: recentErr } = await supabase
        .from('power_readings')
        .select('daily_consumption_kwh,daily_grid_kwh,meter_reading_kwh,grid_meter_readings,is_meter_replacement,plant_id,reading_datetime')
        .in('plant_id', plantIds)
        .order('reading_datetime', { ascending: false })
        .limit(plantIds.length * 5);
      if (recentErr) throw recentErr;
      const latestByPlant = new Map<string, any>();
      (recent ?? []).forEach((r: any) => {
        if (!latestByPlant.has(r.plant_id)) latestByPlant.set(r.plant_id, r);
      });
      return { rows: Array.from(latestByPlant.values()), prevRows, isStale: true };
    },
    enabled: plantIds.length > 0,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  const todayPower   = todayPowerRaw?.rows ?? [];
  const powerIsStale = todayPowerRaw?.isStale ?? false;
  // Per-plant CT multiplier arrays — needed for kWh delta computation
  const { data: dashPowerConfigMap } = useQuery({
    queryKey: ['dash-power-config', plantIds],
    queryFn: async () => {
      const map = new Map<string, number[]>();
      try {
        const { data } = await (supabase.from('plant_power_config' as any) as any)
          .select('plant_id,grid_meter_multipliers').in('plant_id', plantIds);
        for (const cfg of (data ?? []) as any[]) {
          const mArr = cfg.grid_meter_multipliers;
          if (Array.isArray(mArr) && mArr.length > 0)
            map.set(cfg.plant_id, mArr.map((v: any) => +v > 0 ? +v : 1));
        }
      } catch { /* plant_power_config may not exist */ }
      return map;
    },
    enabled: plantIds.length > 0,
    staleTime: 120_000,
  });
  // ----- Yesterday aggregates (for trend deltas on highlighted KPIs) -----
  const { data: yLocators } = useQuery({
    queryKey: ['dash-loc-yest', _locatorIds, yesterday, today],
    queryFn: async () => {
      if (!_locatorIds?.length) return [];
      const { data, error } = await supabase
        .from('locator_readings_clean' as any)
        .select('locator_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement,is_estimated')
        .in('locator_id', _locatorIds)
        .gte('reading_datetime', yesterday)
        .lt('reading_datetime', today)
        .order('reading_datetime', { ascending: true });
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: (_locatorIds?.length ?? 0) > 0,
    staleTime: 12 * 60 * 60_000,  // yesterday is immutable — cache for 12 hours
    refetchInterval: false,          // no polling — yesterday never changes
  });
  const { data: yWells } = useQuery({
    queryKey: ['dash-wells-yest', _wellIds, yesterday, today],
    queryFn: async () => {
      if (!_wellIds?.length) return [];
      const { data, error } = await supabase
        .from('well_readings_clean' as any)
        .select('well_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement')
        .in('well_id', _wellIds)
        .gte('reading_datetime', yesterday)
        .lt('reading_datetime', today)
        .order('reading_datetime', { ascending: true });
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: (_wellIds?.length ?? 0) > 0,
    staleTime: 12 * 60 * 60_000,  // yesterday is immutable — cache for 12 hours
    refetchInterval: false,          // no polling — yesterday never changes
  });
  // Yesterday product meters for production trend delta
  const { data: yProductMeters } = useQuery({
    queryKey: ['dash-product-meters-yest', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const { data: meters, error: metersErr } = await (supabase.from('product_meters' as any) as any)
        .select('id').in('plant_id', plantIds);
      if (metersErr) throw metersErr;
      const meterIds = (meters ?? []).map((m: any) => m.id);
      if (!meterIds.length) return [];
      const { data, error } = await (supabase.from('product_meter_readings' as any) as any)
        .select('meter_id,plant_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement')
        .in('meter_id', meterIds)
        .gte('reading_datetime', yesterday)
        .lt('reading_datetime', today)
        .order('reading_datetime', { ascending: true });
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: plantIds.length > 0,
    staleTime: 12 * 60 * 60_000,  // yesterday is immutable — cache for 12 hours
    refetchInterval: false,          // no polling — yesterday never changes
  });
  const { data: yPower } = useQuery({
    queryKey: ['dash-power-yest', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return { rows: [] as any[], prevRows: [] as any[] };
      const { data: rows, error: rowsErr } = await supabase.from('power_readings')
        .select('daily_consumption_kwh,daily_grid_kwh,meter_reading_kwh,grid_meter_readings,is_meter_replacement,plant_id,reading_datetime')
        .in('plant_id', plantIds).gte('reading_datetime', yesterday).lt('reading_datetime', today);
      if (rowsErr) throw rowsErr;
      // Fetch pre-yesterday baseline rows for delta computation
      const prevRows: any[] = [];
      await Promise.all(plantIds.map(async (pid) => {
        // Soft-fail per plant, same reasoning as todayPowerRaw above.
        const { data, error } = await supabase.from('power_readings')
          .select('meter_reading_kwh,grid_meter_readings,plant_id,reading_datetime')
          .eq('plant_id', pid).lt('reading_datetime', yesterday)
          .order('reading_datetime', { ascending: false }).limit(1);
        if (error) { console.warn('[Dashboard] yesterday prevRow lookup failed for plant', pid, error); return; }
        if (data?.[0]) prevRows.push(data[0]);
      }));
      return { rows: rows ?? [], prevRows };
    },
    enabled: plantIds.length > 0,
  });
  // ── Step 1: Resolve all RO train IDs + metadata for the selected plants ─────
  // BUG FIX (same root cause as permeate path, line ~1007):
  // ro_train_readings does NOT have a plant_id column.  Any query that uses
  // .in('plant_id', plantIds) on that table returns 0 rows, which is why Feed
  // TDS, Product TDS, Recovery, and Raw NTU all showed "—" on the dashboard.
  // Fix: two-step query that mirrors the pattern already used by the permeate
  // production path (_permeateTrainMeta + todayRoPermeate above).
  //   Step 1 — resolve (train_id, plant_id, train_number) from ro_trains.
  //   Step 2 — query ro_train_readings filtered by train_id, then reattach
  //             plant_id and train_number from the lookup map.
  const { data: _qualityTrainMeta } = useQuery({
    queryKey: ['dash-quality-train-meta', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return { ids: [] as string[], metaMap: new Map<string, { plant_id: string; train_number: number | null; train_name: string | null; well_id: string | null; unit_type: string | null }>() };
      const { data, error } = await (supabase.from('ro_trains' as any) as any)
        .select('id, plant_id, train_number, name, well_id, unit_type')
        .in('plant_id', plantIds);
      if (error) throw error;
      const rows = (data ?? []) as any[];
      const metaMap = new Map<string, { plant_id: string; train_number: number | null; train_name: string | null; well_id: string | null; unit_type: string | null }>();
      rows.forEach((t: any) => metaMap.set(t.id as string, {
        plant_id:     t.plant_id,
        train_number: t.train_number ?? null,
        train_name:   t.name ?? null,
        well_id:      t.well_id ?? null,
        unit_type:    t.unit_type ?? 'primary',
      }));
      return { ids: rows.map((t: any) => t.id as string), metaMap };
    },
    enabled: plantIds.length > 0,
    staleTime: 60_000,
  });
  const _qualityTrainIds   = _qualityTrainMeta?.ids    ?? [];
  const _qualityTrainMeta2 = _qualityTrainMeta?.metaMap ?? new Map<string, { plant_id: string; train_number: number | null; train_name: string | null; well_id: string | null; unit_type: string | null }>();

  // ── Well-name lookup for "PER WELL SOURCE" labels ────────────────────────────
  // Fetched once per plant selection. When an ro_trains row has well_id set,
  // roByTrain resolves the label as: well.name → train.name → RO{train_number}.
  const { data: _wellNamesByTrainWell } = useQuery({
    queryKey: ['dash-well-names-for-trains', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return new Map<string, string>();
      const { data, error } = await supabase.from('wells').select('id, name').in('plant_id', plantIds);
      if (error) throw error;
      const map = new Map<string, string>();
      (data ?? []).forEach((w: any) => map.set(w.id as string, w.name as string));
      return map;
    },
    enabled: plantIds.length > 0,
    staleTime: 60_000,
  });

  // ── Step 2: Fetch latest quality readings filtered by train_id ───────────────
  // Selects only the quality-relevant columns (no cumulative meter columns needed here).
  // Reattaches plant_id + train_number from the lookup map so roByTrain dedup and
  // PerWellSourceCard (plantCodeById) both work correctly.
  const { data: latestRO } = useQuery({
    queryKey: ['dash-ro-recent', _qualityTrainIds],
    queryFn: async () => {
      if (!_qualityTrainIds.length) return [] as any[];
      const since = subDays(new Date(), 1).toISOString();
      const { data, error } = await (supabase.from('ro_train_readings' as any) as any)
        // feed/permeate/reject_meter_delta added for RO meter spike detection
        // (roReadingGuards.ts) — same columns PretreatmentAndROLog.tsx already
        // writes on save, just not previously read back here.
        .select('id,train_id,permeate_tds,feed_tds,dp_psi,recovery_pct,permeate_ph,turbidity_ntu,reading_datetime,feed_meter_delta,permeate_meter_delta,reject_meter_delta,norm_status')
        .in('train_id', _qualityTrainIds)
        .gte('reading_datetime', since)
        .order('reading_datetime', { ascending: false });
      if (error) throw new Error(`ro_train_readings (quality): ${error.message}`);
      // Reattach plant_id + train_number + train_name + well_id from the ro_trains
      // lookup so downstream consumers (roByTrain, PerWellSourceCard, expandRows) keep working.
      return (data ?? []).map((r: any) => {
        const meta = _qualityTrainMeta2.get(r.train_id);
        return {
          ...r,
          plant_id:     meta?.plant_id     ?? null,
          train_number: meta?.train_number ?? null,
          train_name:   meta?.train_name   ?? null,
          well_id:      meta?.well_id      ?? null,
        };
      });
    },
    enabled: _qualityTrainIds.length > 0,
    staleTime: 2 * 60_000,
    refetchInterval: 2 * 60_000,
  });

  // ── 10-day per-train average flow rate, for the meter-spike scan below ────
  // Deliberately a SEPARATE, narrower query from latestRO (which only
  // fetches a 24h window) rather than widening that one — this page
  // refetches every 2 minutes, so a full 10-day pull of every quality column
  // for every train would be a meaningfully heavier and mostly-wasted
  // repeat fetch. Only the 4 columns actually needed for the rolling
  // average (see roReadingGuards.ts / flowRateGuards.ts) are selected here.
  const { data: roHistory10d } = useQuery({
    queryKey: ['dash-ro-history-10d', _qualityTrainIds],
    queryFn: async () => {
      if (!_qualityTrainIds.length) return [] as any[];
      const since = subDays(new Date(), 10).toISOString();
      const { data, error } = await (supabase.from('ro_train_readings' as any) as any)
        .select('train_id,reading_datetime,feed_meter,permeate_meter,reject_meter')
        .in('train_id', _qualityTrainIds)
        .gte('reading_datetime', since)
        .order('reading_datetime', { ascending: true });
      if (error) throw new Error(`ro_train_readings (10d history): ${error.message}`);
      return data ?? [];
    },
    enabled: _qualityTrainIds.length > 0,
    staleTime: 5 * 60_000,
  });
  const roAvgFlowByTrain = useMemo(() => {
    const byTrain = new Map<string, any[]>();
    (roHistory10d ?? []).forEach((r: any) => {
      const key = String(r.train_id ?? 'unknown');
      if (!byTrain.has(key)) byTrain.set(key, []);
      byTrain.get(key)!.push(r);
    });
    const out = new Map<string, Record<ROMeterKind, number | null>>();
    byTrain.forEach((rows, trainId) => {
      const rates: Record<ROMeterKind, number | null> = { feed: null, permeate: null, reject: null };
      (['feed', 'permeate', 'reject'] as ROMeterKind[]).forEach((kind) => {
        const col = `${kind}_meter`;
        const points = rows
          .filter((r: any) => r[col] != null)
          .map((r: any) => ({ value: r[col], at: new Date(r.reading_datetime) }));
        rates[kind] = computeROAverageFlowRate(points, 10);
      });
      out.set(trainId, rates);
    });
    return out;
  }, [roHistory10d]);

  // ── Pre-treatment latest reading per train (AFM/MMF + filter housing DP,
  //    booster pump amperage) ───────────────────────────────────────────────
  // ro_pretreatment_readings has its own plant_id column (unlike
  // ro_train_readings) so no two-step train-id resolution is needed here.
  // Fetches the last 2 rows per train (not just 1) so booster pump amperage
  // can be compared to its own immediately-prior reading — the same
  // "vs. last time" pattern already used by permHighWarn in
  // PretreatmentAndROLog.tsx — without a second round-trip.
  const { data: recentPretreatment } = useQuery({
    queryKey: ['dash-pretreatment-recent', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [] as any[];
      const since = subDays(new Date(), 2).toISOString();
      const { data, error } = await supabase
        .from('ro_pretreatment_readings')
        .select('id,train_id,plant_id,reading_datetime,afm_units,filter_housings,booster_pumps')
        .in('plant_id', plantIds)
        .gte('reading_datetime', since)
        .order('reading_datetime', { ascending: false });
      if (error) throw new Error(`ro_pretreatment_readings: ${error.message}`);
      return (data ?? []) as any[];
    },
    enabled: plantIds.length > 0,
    staleTime: 2 * 60_000,
    refetchInterval: 2 * 60_000,
  });

  // ── Pump readings (booster/HPP L1/L2/L3 amps + voltage) — latest per pump ──
  // pump_readings was previously written only by CSV import/export and never
  // read back for alerting. Phase imbalance (evaluatePhaseImbalance) needs
  // only the latest row per pump — no nameplate rating is stored anywhere in
  // the schema, so an absolute amp/volt ceiling isn't used (see ALERTS
  // comment in calculations.ts).
  const { data: latestPumpReadings } = useQuery({
    queryKey: ['dash-pump-readings-recent', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [] as any[];
      const since = subDays(new Date(), 1).toISOString();
      const { data, error } = await supabase
        .from('pump_readings')
        .select('id,train_id,plant_id,pump_type,pump_number,reading_datetime,l1_amp,l2_amp,l3_amp,voltage')
        .in('plant_id', plantIds)
        .gte('reading_datetime', since)
        .order('reading_datetime', { ascending: false });
      if (error) throw new Error(`pump_readings: ${error.message}`);
      // Collapse to the single latest row per (train_id, pump_type, pump_number)
      const latestByPump = new Map<string, any>();
      (data ?? []).forEach((r: any) => {
        const key = `${r.train_id}-${r.pump_type}-${r.pump_number}`;
        if (!latestByPump.has(key)) latestByPump.set(key, r); // first = most recent (DESC order)
      });
      return Array.from(latestByPump.values());
    },
    enabled: plantIds.length > 0,
    staleTime: 2 * 60_000,
    refetchInterval: 2 * 60_000,
  });

  // ── Power consumption — rolling average for spike detection ──────────────
  // Last 14 days of daily_consumption_kwh per plant (today excluded — today's
  // value is what gets compared against this average, so it can't be part of
  // its own baseline).
  const { data: powerHistory } = useQuery({
    queryKey: ['dash-power-history', plantIds, today],
    queryFn: async () => {
      if (!plantIds.length) return [] as any[];
      const since = subDays(new Date(), 14).toISOString();
      const { data, error } = await supabase
        .from('power_readings')
        .select('plant_id,daily_consumption_kwh,reading_datetime')
        .in('plant_id', plantIds)
        .gte('reading_datetime', since)
        .lt('reading_datetime', today)
        .not('daily_consumption_kwh', 'is', null);
      if (error) throw new Error(`power_readings (history): ${error.message}`);
      return (data ?? []) as any[];
    },
    enabled: plantIds.length > 0,
    staleTime: 5 * 60_000,
  });
  // Plant-average kWh/hr over the trailing window, keyed by plant_id. Was: a
  // plain average of the stored daily_consumption_kwh values, silently
  // assuming every reading was exactly 24h apart — see flowRateGuards.ts /
  // computeRollingAverageRateFromDeltas for why that breaks whenever a day
  // has no reading (each row's own kWh ÷ hours since the PREVIOUS row for
  // that plant, not ÷24 always).
  const powerAvgByPlant = useMemo(() => {
    const byPlant = new Map<string, VolumePoint[]>();
    (powerHistory ?? []).forEach((r: any) => {
      const v = Number(r.daily_consumption_kwh);
      if (!Number.isFinite(v) || v <= 0 || !r.reading_datetime) return;
      const key = r.plant_id;
      if (!byPlant.has(key)) byPlant.set(key, []);
      byPlant.get(key)!.push({ volume: v, at: new Date(r.reading_datetime) });
    });
    const out = new Map<string, number>();
    byPlant.forEach((points, pid) => {
      const avg = computeRollingAverageRateFromDeltas(points, 14);
      if (avg != null) out.set(pid, avg);
    });
    return out;
  }, [powerHistory]);

  // Most recent reading strictly BEFORE today, per plant — needed to convert
  // today's daily_consumption_kwh into an hourly rate comparable to
  // powerAvgByPlant (also kWh/hr). See todayPowerRaw's prevRows above.
  const prevPowerRowByPlant = useMemo(() => {
    const m = new Map<string, { reading_datetime: string }>();
    (todayPowerRaw?.prevRows ?? []).forEach((r: any) => {
      if (r.plant_id && r.reading_datetime) m.set(r.plant_id, r);
    });
    return m;
  }, [todayPowerRaw]);

  // ── Permeate fallback for production ─────────────────────────────────────────
  // When the selected plants have no product meter readings today AND are not
  // configured as permeate_is_production, the Production Volume card shows 0.
  // In that case the best available signal is the sum of today's permeate_meter_delta
  // across all RO trains — essentially "how much treated water left the membranes."
  // This query reuses _qualityTrainIds (already fetched for quality stats) and
  // is only enabled when needed (no product meters returned today).
  const productMetersHaveData = (todayProductMeters?.length ?? 0) > 0;
  const { data: todayAllPermeate } = useQuery({
    queryKey: ['dash-all-permeate-today', _qualityTrainIds, _localDateStr],
    queryFn: async () => {
      if (!_qualityTrainIds.length) return [] as any[];
      const windowStart = new Date(_localDateStr + 'T00:00:00').toISOString();
      const windowEnd   = new Date(_localDateStr + 'T23:59:59').toISOString();
      const { data, error } = await (supabase.from('ro_train_readings' as any) as any)
        .select('train_id,permeate_meter_delta,reading_datetime')
        .in('train_id', _qualityTrainIds)
        .gte('reading_datetime', windowStart)
        .lte('reading_datetime', windowEnd)
        .not('permeate_meter_delta', 'is', null)
        .gt('permeate_meter_delta', 0);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    // Only fetch when there are no product meter readings — avoids a redundant
    // round-trip when product meters are working correctly.
    enabled: !productMetersHaveData && _qualityTrainIds.length > 0,
    staleTime: 60_000,  // FIX (egress): matched to refetchInterval below — was 30_000, which let the app-wide background-sync sweep force-refetch this before its own 60s timer was due
    refetchInterval: 60_000,
  });
  // ── FIX: StatCard cost sources now mirror TrendChart's productionCost computation ──
  // Previous: StatCard read production_costs.power_cost (stale legacy column)
  //           and production_costs.chem_cost only (missed chemical_dosing_logs).
  // Now:      Power cost  → power_tariffs.rate_per_kwh × kWh (same as chart)
  //           Chem cost   → production_costs.chem_cost + chemical_dosing_logs (same as chart)
  // If no row exists for today's date, fall back to the latest available row per
  // plant so the dashboard never displays ₱0 when real data exists.
  // `costDataDate` + `costIsStale` drive the "as of MMM d" badge in the cluster header.
  const { data: todayCostsRaw } = useQuery({
    queryKey: ['dash-costs-today', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return {
        rows: [] as any[], costDataDate: null as string | null,
        tariffByPlant: new Map<string, number>(), dashDosingPeso: 0,
      };
      const todayStr = format(new Date(), 'yyyy-MM-dd');

      // Fetch production_costs, power_tariffs, dosing logs, and chemical prices in parallel
      const [prodCostRes, tariffRes, dosingRes, pricesRes] = await Promise.all([
        supabase.from('production_costs')
          .select('chem_cost,power_cost,total_cost,plant_id,cost_date')
          .in('plant_id', plantIds)
          .eq('cost_date', todayStr),
        // Latest effective tariff per plant (ordered DESC → first per plant = most recent ≤ today)
        supabase.from('power_tariffs')
          .select('plant_id,effective_date,rate_per_kwh')
          .in('plant_id', plantIds)
          .lte('effective_date', todayStr)
          .order('effective_date', { ascending: false }),
        // Today's dosing log entries (matches TrendChart's chemical cost accumulation)
        supabase.from('chemical_dosing_logs')
          .select('log_datetime,calculated_cost,plant_id,chlorine_kg,smbs_kg,anti_scalant_l,soda_ash_kg')
          .in('plant_id', plantIds)
          // FIX: use UTC ISO strings so timestamptz comparisons are correct for UTC+8
          .gte('log_datetime', new Date(todayStr + 'T00:00:00').toISOString())
          .lte('log_datetime', new Date(todayStr + 'T23:59:59').toISOString()),
        // Current prices for live fallback when calculated_cost is absent
        supabase.from('chemical_prices')
          .select('chemical_name,unit_price')
          .lte('effective_date', todayStr)
          .order('effective_date', { ascending: false }),
      ]);
      if (prodCostRes.error) throw prodCostRes.error;
      if (tariffRes.error) throw tariffRes.error;
      if (dosingRes.error) throw dosingRes.error;
      if (pricesRes.error) throw pricesRes.error;

      // Build tariff map: plant_id → latest ₱/kWh rate (results ordered DESC, first per plant wins)
      const tariffByPlant = new Map<string, number>();
      for (const t of (tariffRes.data ?? []) as any[]) {
        if (!tariffByPlant.has(t.plant_id)) tariffByPlant.set(t.plant_id, +t.rate_per_kwh);
      }

      // Chemical cost from dosing logs (mirrors TrendChart lines 1398–1410)
      // FIX: Also store the base chemical name without unit suffix so that names
      // stored as e.g. 'Chlorine (kg)' are found when DOSING_KEYS looks up 'Chlorine'.
      // This mirrors TrendChart's priceMap logic (same base-stripping) so stat card
      // and chart always use the same live fallback cost when calculated_cost = 0.
      const priceMap: Record<string, number> = {};
      for (const p of (pricesRes.data ?? []) as any[]) {
        if (!(p.chemical_name in priceMap)) priceMap[p.chemical_name] = +p.unit_price;
        const base = (p.chemical_name as string).replace(/\s*\([^)]+\)\s*$/, '').trim();
        if (!(base in priceMap)) priceMap[base] = +p.unit_price;
      }
      const DOSING_KEYS = [
        { key: 'chlorine_kg',    name: 'Chlorine'     },
        { key: 'smbs_kg',        name: 'SMBS'         },
        { key: 'anti_scalant_l', name: 'Anti Scalant' },
        { key: 'soda_ash_kg',    name: 'Soda Ash'     },
      ];
      let dashDosingPeso = 0;
      for (const r of (dosingRes.data ?? []) as any[]) {
        const stored = +r.calculated_cost || 0;
        const live   = DOSING_KEYS.reduce((s, c) => s + (+r[c.key] || 0) * (priceMap[c.name] ?? 0), 0);
        dashDosingPeso += stored > 0 ? stored : live;
      }

      if ((prodCostRes.data ?? []).length) {
        return { rows: prodCostRes.data!, costDataDate: todayStr, tariffByPlant, dashDosingPeso };
      }
      // Fallback: latest cost row per plant
      const { data: recent, error: recentErr } = await supabase
        .from('production_costs')
        .select('chem_cost,power_cost,total_cost,plant_id,cost_date')
        .in('plant_id', plantIds)
        .order('cost_date', { ascending: false })
        .limit(plantIds.length * 3);
      if (recentErr) throw recentErr;
      const latestByPlant = new Map<string, any>();
      (recent ?? []).forEach((r: any) => {
        if (!latestByPlant.has(r.plant_id)) latestByPlant.set(r.plant_id, r);
      });
      const rows = Array.from(latestByPlant.values());
      return { rows, costDataDate: rows[0]?.cost_date ?? null, tariffByPlant, dashDosingPeso };
    },
    enabled: plantIds.length > 0,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
  const todayCosts       = todayCostsRaw?.rows ?? [];
  const costDataDate     = todayCostsRaw?.costDataDate ?? null;
  const costIsStale      = costDataDate != null && costDataDate !== format(new Date(), 'yyyy-MM-dd');
  // Per-plant tariff rates and dosing ₱ total — consumed by computePowerKwh and chemCost below
  const dashTariffByPlant = todayCostsRaw?.tariffByPlant ?? new Map<string, number>();
  const dashDosingPeso    = todayCostsRaw?.dashDosingPeso ?? 0;
  // Today's blending volume, summed directly from blending_events — the table Operations →
  // Blending actually writes to. (daily_plant_summary.blending_m3 above is meant to be filled
  // in nightly by fn_compute_daily_plant_summary, but that function was missing from the DB
  // until this fix, so it was permanently 0/null. Querying blending_events directly here means
  // this stat is correct immediately, independent of the nightly job's schedule.)
  const { data: blendingTodayRows } = useQuery({
    queryKey: ['dash-blending-today', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await (supabase.from('blending_events' as any) as any)
        .select('volume_m3, plant_id')
        .in('plant_id', plantIds)
        .eq('event_date', today);
      if (error) throw error;
      return data ?? [];
    },
    enabled: plantIds.length > 0,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  return {
    _locatorIds, _directLocatorIds, _directProductMeterIds, _wellIds,
    todayLocators, todayWells, todayProductMeters,
    plantMeterConfigs, permeateProductionPlantIds, productExcludedPlantIds,
    _permeateTrainMeta, _permeateTrainIds, _permeateTrainPlantMap,
    todayRoPermeate, _dayBeforeYesterdayKey, yRoPermeate,
    todayPowerRaw, todayPower, powerIsStale, dashPowerConfigMap,
    yLocators, yWells, yProductMeters, yPower,
    _qualityTrainMeta, _qualityTrainIds, _qualityTrainMeta2, _wellNamesByTrainWell,
    latestRO, roHistory10d, roAvgFlowByTrain,
    recentPretreatment, latestPumpReadings,
    powerHistory, powerAvgByPlant, prevPowerRowByPlant,
    productMetersHaveData, todayAllPermeate,
    todayCostsRaw, todayCosts, costDataDate, costIsStale, dashTariffByPlant, dashDosingPeso,
    blendingTodayRows,
  };
}
