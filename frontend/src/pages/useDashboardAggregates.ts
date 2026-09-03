// Split out of Dashboard.tsx (was 2,204 lines) as part of a file-size
// cleanup pass. This module turns the raw query results from
// useDashboardQueries.ts into every stat-card number the dashboard shows:
// today/yesterday production/consumption/NRW/kwh/PV, RO-train quality
// rollups, wells-by-quality, cost aggregates (power/chem/total), blending,
// chemical inventory, and (via the small `feed` query at the bottom) the
// live activity feed used elsewhere on the page.
//
// Moved verbatim from Dashboard.tsx — no logic changes.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, subDays } from 'date-fns';
import { calc } from '@/lib/calculations';
import { deltaCache } from '@/lib/deltaCache';
import { computePivotFromReadingsNoCache, pivotDayTotal } from '@/components/dashboard/DataSummaryModal';
import { pctDelta } from '@/components/dashboard/types';
import { useTrainAutoOffline } from '@/hooks/useTrainAutoOffline';
import { useReadingGaps } from '@/hooks/useReadingGaps';
import { useTrainHourlyGaps } from '@/hooks/useTrainHourlyGaps';

export function useDashboardAggregates(p: Record<string, any>) {
  const {
    plantIds, today, yesterday, _localDateStr, _yesterdayKey, plants, selectedPlantId,
    _directLocatorIds, _directProductMeterIds,
    todayLocators, todayWells, todayProductMeters,
    permeateProductionPlantIds, productExcludedPlantIds,
    todayRoPermeate, yRoPermeate, todayPowerRaw, todayPower, dashPowerConfigMap,
    yLocators, yWells, yProductMeters, yPower,
    _qualityTrainMeta2, _wellNamesByTrainWell, latestRO,
    todayAllPermeate, todayCosts, costIsStale, dashTariffByPlant, dashDosingPeso,
    blendingTodayRows,
  } = p;
  // ── Stat card aggregates ────────────────────────────────────────────────────
  // Uses computePivotFromReadings (same replacement-aware logic as TrendChart)
  // so meter-replacement spikes don't inflate today's totals.
  const _todayKey = format(new Date(), 'yyyy-MM-dd');
  // _yesterdayKey is defined earlier (line ~565) so the permeate-production queries can use it.

  const rawWaterVol = useMemo(() => pivotDayTotal(
    // FIX: Use no-cache variant — see production useMemo comment above.
    computePivotFromReadingsNoCache(todayWells ?? [], 'well_id', 'daily_volume'), _todayKey,
  ), [todayWells, _todayKey]);

  // RO permeate contribution to production — applies cut-off bucketing and date-range
  // guard per plant before summing. Only readings whose attributed production date
  // equals the target day (today / yesterday) are included.
  // RO permeate production — uses simple local-date bucketing (same as Data Summary modal).
  // The old cutoff / displaceToNearestBoundary logic has been removed system-wide:
  // every reading is attributed to the calendar day it was actually recorded.
  // This matches the values shown in the Data Summary table exactly.
  const roPermeateProduction = useMemo(() =>
    (todayRoPermeate ?? []).reduce((s: number, r: any) => {
      const dateKey = format(new Date(r.reading_datetime as string), 'yyyy-MM-dd');
      if (dateKey !== _localDateStr) return s;
      return s + (+(r.permeate_meter_delta ?? 0));
    }, 0),
  [todayRoPermeate, _localDateStr]);

  const yRoPermeateProduction = useMemo(() =>
    (yRoPermeate ?? []).reduce((s: number, r: any) => {
      const dateKey = format(new Date(r.reading_datetime as string), 'yyyy-MM-dd');
      if (dateKey !== _yesterdayKey) return s;
      return s + (+(r.permeate_meter_delta ?? 0));
    }, 0),
  [yRoPermeate, _yesterdayKey]);

  // Production = product meter delta (excluding exclusive-permeate plants)
  //            + RO permeate delta (permeate_is_production plants).
  // Fallback: when neither source has data today, sum permeate_meter_delta across
  // ALL trains for the selected plants — "how much treated water left the membranes."
  // This ensures the Production Volume card never shows 0 just because product meters
  // haven't been configured or haven't been read yet today.
  const production = useMemo(() => {
    // Exclude readings from plants in EXCLUSIVE permeate mode — their product
    // meter reads the same water roPermeateProduction already counts below.
    // Plants in 'both' mode are NOT excluded here — they have two genuinely
    // independent sources, so their product meter reading is summed in.
    const meterReadingsForProduction = (todayProductMeters ?? []).filter(
      (r: any) => !productExcludedPlantIds.has(r.plant_id),
    );
    // FIX: Use no-cache variant so the stat-card computation does not write
    // transient single-day deltas into deltaCache, which would be picked up
    // by DataSummaryModal's multi-day pivot and produce wrong totals.
    const meterTotal = pivotDayTotal(
      computePivotFromReadingsNoCache(meterReadingsForProduction, 'meter_id', 'daily_volume', _directProductMeterIds), _todayKey,
    );
    const combined = meterTotal + roPermeateProduction;
    if (combined > 0) return combined;

    // Fallback path: use permeate_meter_delta for trains NOT already counted via
    // the permeate_is_production path (to avoid double-counting), and never for
    // secondary (2nd-pass) units — their permeate is a re-metering of water an
    // upstream primary train already counted (ro_trains.unit_type).
    const fallbackTotal = (todayAllPermeate ?? []).reduce((s: number, r: any) => {
      const trainMeta = _qualityTrainMeta2.get(r.train_id);
      if (trainMeta?.unit_type === 'secondary') return s;
      // Skip trains already included in roPermeateProduction
      if (trainMeta?.plant_id && permeateProductionPlantIds.includes(trainMeta.plant_id)) return s;
      return s + (+(r.permeate_meter_delta ?? 0));
    }, 0);
    return fallbackTotal;
  }, [todayProductMeters, _todayKey, roPermeateProduction, todayAllPermeate, _qualityTrainMeta2, permeateProductionPlantIds, productExcludedPlantIds, _directProductMeterIds]);

  const consumption = useMemo(() => pivotDayTotal(
    // FIX: Use no-cache variant — see production useMemo comment above.
    computePivotFromReadingsNoCache(todayLocators ?? [], 'locator_id', 'daily_volume', _directLocatorIds), _todayKey,
  ), [todayLocators, _todayKey, _directLocatorIds]);

  // Compute daily grid kWh from raw meter readings. Priority order mirrors TrendChart exactly:
  //   1. Raw JSONB multi-meter delta × per-meter CT multiplier
  //   2. Single-meter delta × multArr[0]
  //   3. daily_grid_kwh   (already post-multiplication — use as-is)
  //   4. daily_consumption_kwh × multArr[0]  (raw delta; mult must be applied)
  // FIX: Previously priorities 3 & 4 were swapped AND daily_consumption_kwh was used
  // without the CT multiplier, causing the StatCard to show e.g. 8 kWh / ₱86 when
  // the chart (which applies the multiplier correctly) shows the actual 19,200 kWh.
  // Both paths now share identical logic so StatCard and chart always agree.
  // Also returns powerCostPeso = kWh × tariff (same formula as chart) when
  // tariffByPlant is supplied.
  function computePowerKwh(
    currentRows: any[],
    prevRows: any[],
    configMap: Map<string, number[]> | undefined,
    tariffByPlant?: Map<string, number>, // per-plant ₱/kWh rate from power_tariffs
  ): { kwh: number; powerCostPeso: number | null } {
    const prevByPlant = new Map<string, any>();
    for (const p of prevRows) prevByPlant.set(p.plant_id, p);
    let totalKwh = 0;
    let totalCostPeso = 0;
    let hasTariff = false;
    for (const r of currentRows) {
      if (r.is_meter_replacement) continue;
      const pid      = r.plant_id;
      const prev     = prevByPlant.get(pid);
      const multArr  = configMap?.get(pid) ?? [1];
      const rGmr     = r.grid_meter_readings as Record<string, number> | null | undefined;
      const pGmr     = prev?.grid_meter_readings as Record<string, number> | null | undefined;
      let kwh = 0;
      // FIX: Track whether we had raw meter data to compute a delta from.
      // When a raw delta IS computable but comes out negative (meter anomaly / rollover),
      // the chart treats the reading as invalid (gridKwh < 0 → skipped, no fallback).
      // The stat card must mirror that: only use the stored daily_consumption_kwh fallback
      // when no raw baseline existed at all, NOT when the delta was computed but negative.
      // This prevents a stale/partial daily_consumption_kwh from inflating cost when the
      // operator's cumulative meter reading regressed (e.g. a wrong value entered today).
      let rawDeltaAttempted = false;

      if (rGmr && pGmr && Object.keys(rGmr).length > 0) {
        // Priority 1: multi-meter JSONB delta × per-meter CT multiplier
        rawDeltaAttempted = true;
        let sum = 0;
        for (const k of Object.keys(rGmr)) {
          const mi    = parseInt(k, 10);
          const mMult = multArr[mi] ?? multArr[0] ?? 1;
          if (pGmr[k] != null) sum += (rGmr[k] - pGmr[k]) * mMult;
        }
        if (sum >= 0) kwh = sum;
      } else if (prev?.meter_reading_kwh != null && r.meter_reading_kwh != null) {
        // Priority 2: single-meter delta × multiplierArr[0]
        rawDeltaAttempted = true;
        const delta = +r.meter_reading_kwh - +prev.meter_reading_kwh;
        if (delta >= 0) kwh = delta * (multArr[0] ?? 1);
      }

      // Priority 3 & 4: stored daily totals — fallback ONLY when no raw readings were
      // available (rawDeltaAttempted = false).  Do NOT use when the delta was computable
      // but negative: that indicates a meter anomaly and must show '—', same as the chart.
      // Order mirrors TrendChart (lines 1933-1937):
      //   • daily_grid_kwh        — stored post-multiplication (already × CT ratio). Use as-is.
      //   • daily_consumption_kwh — stored as the raw meter delta (NOT multiplied at save time,
      //                             e.g. Δ = 8 while actual = 8 × 2400 = 19,200 kWh).
      //                             Must apply multArr[0] to match the chart's computation and
      //                             the Operations "Last 7 readings" panel.
      if (kwh === 0 && !rawDeltaAttempted) {
        if (r.daily_grid_kwh != null && +r.daily_grid_kwh > 0)
          kwh = +r.daily_grid_kwh;
        else if (r.daily_consumption_kwh != null && +r.daily_consumption_kwh > 0)
          kwh = +r.daily_consumption_kwh * (multArr[0] ?? 1);
      }
      totalKwh += kwh;

      // Accumulate ₱ cost per plant: kWh × tariff rate (same formula as chart)
      const rate = tariffByPlant?.get(pid) ?? null;
      if (rate != null && kwh > 0) {
        totalCostPeso += kwh * rate;
        hasTariff = true;
      }
    }
    return { kwh: totalKwh, powerCostPeso: hasTariff ? totalCostPeso : null };
  }

  const { kwh, powerCostPeso: todayPowerCostPeso } = computePowerKwh(
    todayPower, todayPowerRaw?.prevRows ?? [], dashPowerConfigMap, dashTariffByPlant,
  );

  // NRW uses Production (product meter output) vs Consumption (locator billed)
  const nrw = calc.nrw(production, consumption);
  const pv = calc.pvRatio(kwh, production);

  const yRawWaterVol = useMemo(() => pivotDayTotal(
    // FIX: Use no-cache variant — see production useMemo comment above.
    computePivotFromReadingsNoCache(yWells ?? [], 'well_id', 'daily_volume'), _yesterdayKey,
  ), [yWells, _yesterdayKey]);

  const yProduction = useMemo(() =>
    pivotDayTotal(
      // FIX: Use no-cache variant — see production useMemo comment above.
      // Same exclusion as `production` above — exclude exclusive-permeate
      // plants' product meter so yesterday's total stays comparable to today's.
      computePivotFromReadingsNoCache(
        (yProductMeters ?? []).filter((r: any) => !productExcludedPlantIds.has(r.plant_id)),
        'meter_id', 'daily_volume', _directProductMeterIds,
      ), _yesterdayKey,
    ) + yRoPermeateProduction,
  [yProductMeters, _yesterdayKey, yRoPermeateProduction, productExcludedPlantIds, _directProductMeterIds]);

  const yConsumption = useMemo(() => pivotDayTotal(
    // FIX: Use no-cache variant — see production useMemo comment above.
    computePivotFromReadingsNoCache(yLocators ?? [], 'locator_id', 'daily_volume', _directLocatorIds), _yesterdayKey,
  ), [yLocators, _yesterdayKey, _directLocatorIds]);

  const { kwh: yKwh } = computePowerKwh(yPower?.rows ?? [], yPower?.prevRows ?? [], dashPowerConfigMap);
  const dProduction = pctDelta(production, yProduction);
  const dConsumption = pctDelta(consumption, yConsumption);
  const dRawWater = pctDelta(rawWaterVol, yRawWaterVol);
  const dKwh = pctDelta(kwh, yKwh);
  const yNrw = calc.nrw(yProduction, yConsumption);

  const nrwBreached = nrw != null && nrw > 10;
  // Bug 5: RO averages are now computed after roByTrain useMemo below (deduped per train).

  // Per-train latest snapshot — group `latestRO` by (plant_id, train_number)
  // and keep the most recent row per train (the query is already ordered
  // reading_datetime DESC, so the first row we encounter per key wins).
  // Used by the "Raw TDS / Raw NTU per train" breakdown lists in Quality.
  // Note: TDS and NTU are recorded at the RO-train level in this schema,
  // not the well level — we surface them here labelled as "Train N" with
  // the plant code so the user knows what they're looking at.
  const roByTrain = useMemo(() => {
    const seen = new Set<string>();
    const rows: any[] = [];
    (latestRO as any[] | undefined ?? []).forEach((r) => {
      const key = `${r.plant_id}__${r.train_number ?? '?'}`;
      if (seen.has(key)) return;
      seen.add(key);
      // Label priority: linked well name → ro_trains.name → RO{train_number}.
      // Well name is only available once _wellNamesByTrainWell has loaded; until
      // then the row renders with train_name and updates on the next memo run.
      const wellName = r.well_id ? (_wellNamesByTrainWell?.get(r.well_id) ?? null) : null;
      rows.push({ ...r, train_name: wellName ?? r.train_name });
    });
    rows.sort((a, b) => {
      // Sort by plant_id then train_number for stable rendering across re-renders.
      if (a.plant_id !== b.plant_id) return String(a.plant_id).localeCompare(String(b.plant_id));
      return (a.train_number ?? 0) - (b.train_number ?? 0);
    });
    return rows;
  }, [latestRO, _wellNamesByTrainWell]);

  // ── wellsByQuality ─────────────────────────────────────────────────────────
  // Per-well quality snapshot derived from todayWells (well_readings.tds_ppm /
  // turbidity_ntu). These drive the "PER WELL SOURCE" Raw TDS and Raw NTU cards
  // so the names and values match exactly what operators enter in Operations.
  // Deduplication: latest reading per well (todayWells is ordered ASC so last = latest).
  const wellsByQuality = useMemo(() => {
    const latestByWell = new Map<string, any>();
    (todayWells as any[] | undefined ?? []).forEach((r) => {
      // Keep overwriting — last entry per well_id is the most recent (ASC order).
      if (r.tds_ppm != null || r.turbidity_ntu != null) {
        latestByWell.set(r.well_id as string, r);
      }
    });
    const rows: any[] = [];
    latestByWell.forEach((r) => {
      const wellName = _wellNamesByTrainWell?.get(r.well_id as string) ?? null;
      rows.push({
        ...r,
        // Alias well_id so PerWellSourceCard key logic uses it
        well_id: r.well_id,
        // Map well name into train_name so the shared PerWellSourceCard rowLabel works
        train_name: wellName ?? `Well ${String(r.well_id).slice(-4)}`,
      });
    });
    rows.sort((a, b) => {
      if (a.plant_id !== b.plant_id) return String(a.plant_id).localeCompare(String(b.plant_id));
      return String(a.train_name).localeCompare(String(b.train_name));
    });
    return rows;
  }, [todayWells, _wellNamesByTrainWell]);

  // Bug 5 fix: recompute RO averages from deduplicated roByTrain so trains with more
  // readings per 24h window don't inflate/skew the aggregate values.
  const avgPermTds = roByTrain.length
    ? +(roByTrain.reduce((s, r) => s + (r.permeate_tds ?? 0), 0) / roByTrain.length).toFixed(0)
    : null;
  const avgFeedTds = roByTrain.length
    ? +(roByTrain.reduce((s, r) => s + (r.feed_tds ?? 0), 0) / roByTrain.length).toFixed(0)
    : null;
  const avgRecovery = roByTrain.length
    ? +(roByTrain.reduce((s, r) => s + (r.recovery_pct ?? 0), 0) / roByTrain.length).toFixed(1)
    : null;
  const avgTurb = roByTrain.length
    ? +(roByTrain.reduce((s, r) => s + (r.turbidity_ntu ?? 0), 0) / roByTrain.length).toFixed(2)
    : null;

  // Per-well raw water quality averages — sourced from well_readings (entered in
  // Operations) rather than ro_train_readings so names and values match Operations.
  const wellsWithTds  = wellsByQuality.filter((r) => r.tds_ppm != null);
  const wellsWithNtu  = wellsByQuality.filter((r) => r.turbidity_ntu != null);
  const avgRawTds = wellsWithTds.length
    ? +(wellsWithTds.reduce((s, r) => s + (r.tds_ppm ?? 0), 0) / wellsWithTds.length).toFixed(0)
    : null;
  const avgRawTurb = wellsWithNtu.length
    ? +(wellsWithNtu.reduce((s, r) => s + (r.turbidity_ntu ?? 0), 0) / wellsWithNtu.length).toFixed(2)
    : null;
  // Lookup helper for plant codes inside per-train rows. Falls back to the
  // raw plant_id when the plant list hasn't loaded yet so we never render
  // a blank label.
  const plantCodeById = useMemo(() => {
    const m = new Map<string, string>();
    (plants ?? []).forEach((p: any) => m.set(p.id, p.code ?? p.name ?? p.id));
    return m;
  }, [plants]);

  // ── Cost aggregates (aligned with TrendChart productionCost computation) ──────
  // Power cost:  kwh × tariff rate (from power_tariffs — same formula as chart)
  //              was: production_costs.power_cost (stale legacy column the chart ignores)
  // Chemical:    production_costs.chem_cost (today only) + today's chemical_dosing_logs
  //              was: production_costs.chem_cost only (missed dosing log entries)
  // Show '—' when no data has ever been entered (both sources empty) to avoid ₱0 mislead.
  //
  // IMPORTANT: When costIsStale (fallback row is from a prior date), we deliberately
  // skip production_costs.chem_cost because that row's value belongs to a different day.
  // Today's chemical cost is then sourced from dashDosingPeso (today's dosing logs) only.
  // This prevents stale/accumulated chem_cost values from inflating the stat card total.
  const hasCostData = todayCosts.length > 0;

  // Chemical cost: only include production_costs.chem_cost when the row is for TODAY.
  // Stale fallback rows are excluded — their chem_cost belongs to a prior day's total.
  const prodCostsChem = costIsStale
    ? 0
    : todayCosts.reduce((s, r: any) => s + (+r.chem_cost || 0), 0);
  const chemCostTotal = prodCostsChem + dashDosingPeso;
  const chemCost      = (chemCostTotal > 0) ? chemCostTotal
    : hasCostData ? null  // row exists but all-zero — still show '—'
    : null;

  // Power cost: todayPowerCostPeso is from computePowerKwh (kwh × tariff per plant).
  // Falls back to null when no tariff rate has been configured yet.
  const powerCost = todayPowerCostPeso != null ? +todayPowerCostPeso.toFixed(0) : null;

  // Total: show when at least one component is available
  const productionCost = (chemCost != null || powerCost != null)
    ? (chemCost ?? 0) + (powerCost ?? 0)
    : null;

  const blending = (blendingTodayRows ?? []).reduce((s: number, r) => s + (+r.volume_m3 || 0), 0);

  const { data: chemInv } = useQuery({
    queryKey: ['dash-chem', plantIds],
    queryFn: async () => plantIds.length
      ? (await supabase.from('chemical_inventory').select('*').in('plant_id', plantIds)).data ?? []
      : [],
    enabled: plantIds.length > 0,
    staleTime: 60_000,  // FIX (egress): was 0 (always stale), which let the background-sync sweep refetch this ahead of its own 60s interval
    refetchInterval: 60_000,
  });

  const trainGaps = useTrainAutoOffline(plantIds);
  const { wellGaps, locatorGaps } = useReadingGaps(plantIds);
  const trainHourlyGaps = useTrainHourlyGaps(plantIds);

  // Legacy RO/chem alerts (still useful, live-computed)
  const localAlerts: { tone: 'danger' | 'warn'; text: string }[] = [];
  trainGaps.forEach((g) => localAlerts.push({ tone: 'warn', text: `Train ${g.train_number} no reading ${g.hours_gap.toFixed(1)}h — auto-flagged Offline` }));
  // Collapse to latest-per-train before local alert banners (same reason as useEffect)
  const _localROPerTrain = new Map<string, any>();
  (latestRO ?? []).forEach((r: any) => {
    const k = String(r.train_id ?? r.train_number ?? 'unknown');
    if (!_localROPerTrain.has(k)) _localROPerTrain.set(k, r);
  });
  _localROPerTrain.forEach((r: any) => {
    if (r.dp_psi > 40)                localAlerts.push({ tone: 'danger', text: `DP alert: ${r.dp_psi} psi` });
    else if (r.dp_psi >= 35)          localAlerts.push({ tone: 'warn',   text: `DP approaching limit: ${r.dp_psi} psi` });
    if (r.permeate_tds >= 600)        localAlerts.push({ tone: 'danger', text: `TDS alert: ${r.permeate_tds} ppm` });
    else if (r.permeate_tds >= 500)   localAlerts.push({ tone: 'warn',   text: `TDS approaching limit: ${r.permeate_tds} ppm` });
    if (r.permeate_ph != null && (r.permeate_ph < 6.5 || r.permeate_ph > 8.5)) localAlerts.push({ tone: 'warn', text: `pH out of range: ${r.permeate_ph}` });
    if (r.recovery_pct != null && r.recovery_pct < 70) localAlerts.push({ tone: 'warn', text: `Low recovery: ${r.recovery_pct.toFixed(1)}%` });
  });
  (chemInv ?? []).forEach((c: any) => {
    if (c.current_stock < c.low_stock_threshold) localAlerts.push({ tone: 'warn', text: `Low stock: ${c.chemical_name}` });
  });

  // Unified alerts feed (downtime / blending / recovery). Ported 1:1 from the
  // old FastAPI /api/alerts/feed route — same three tables, same thresholds,
  // same severity ranking and cap — just computed client-side now, since all
  // three tables (downtime_events, blending_events, compliance_snapshots)
  // allow any signed-in user to SELECT under RLS.
  const { data: feed } = useQuery<{ count: number; alerts: any[] }>({
    queryKey: ['alerts-feed', selectedPlantId],
    queryFn: async () => {
      const days = 30;
      const since = format(subDays(new Date(), Math.max(1, days)), 'yyyy-MM-dd');
      const alerts: any[] = [];

      // Downtime: prolonged single shutdowns (>=12h) or abnormal clusters
      // (>=3 events and >=6h total) on the same day.
      let qDt = supabase.from('downtime_events' as any).select('*').gte('event_date', since);
      if (selectedPlantId) qDt = qDt.eq('plant_id', selectedPlantId);
      const { data: dtRows, error: dtErr } = await qDt;
      if (dtErr) throw dtErr;
      const eventsByDay = new Map<string, any[]>();
      (dtRows ?? []).forEach((d: any) => {
        const day = String(d.event_date ?? '').slice(0, 10);
        if (!eventsByDay.has(day)) eventsByDay.set(day, []);
        eventsByDay.get(day)!.push(d);
      });
      eventsByDay.forEach((evs, day) => {
        const total = evs.reduce((s, e) => s + (Number(e.duration_hrs) || 0), 0);
        const longOnes = evs.filter((e) => (Number(e.duration_hrs) || 0) >= 12);
        if (longOnes.length) {
          alerts.push({
            id: `downtime-${longOnes[0].plant_id}-${day}`,
            kind: 'downtime', severity: 'high', date: day, plant_id: longOnes[0].plant_id,
            title: `Prolonged shutdown · ${longOnes[0].subsystem}`,
            detail: `${longOnes[0].duration_hrs}h`, count: longOnes.length,
          });
        } else if (evs.length >= 3 && total >= 6) {
          alerts.push({
            id: `downtime-${evs[0].plant_id}-${day}`,
            kind: 'downtime', severity: 'medium', date: day, plant_id: evs[0].plant_id,
            title: `Abnormal downtime · ${evs.length} events / ${total.toFixed(1)}h`,
            detail: 'Multiple short shutdowns.', count: evs.length,
          });
        }
      });

      // Blending: most recent injections, informational only. Deliberately a
      // much shorter window than downtime/recovery below (30 days) — this is
      // a routine daily log per well, not something that needs following up
      // on weeks later, and a 30-day net was the main reason the bell felt
      // permanently full: on any given day it's still surfacing every well's
      // reading from every day this month, not just what actually just
      // happened. 2 days (today + yesterday) covers "came back the next
      // morning" without dragging in a month of history.
      const sinceBlending = format(subDays(new Date(), 2), 'yyyy-MM-dd');
      let qBe = supabase.from('blending_events' as any).select('*')
        .gte('event_date', sinceBlending).order('event_date', { ascending: false }).limit(50);
      if (selectedPlantId) qBe = qBe.eq('plant_id', selectedPlantId);
      const { data: beRows, error: beErr } = await qBe;
      if (beErr) throw beErr;
      (beRows ?? []).forEach((d: any) => {
        alerts.push({
          // The real blending_events row id — was previously left unset here
          // and the array *position* got used as a stand-in downstream. That
          // position shifts on every 60s refetch (ties on the same
          // event_date have no defined order, and rows age in/out of the
          // 30-day window), so a dismissed/snoozed card could silently come
          // back under a "new" id on the next refresh. Keying on the actual
          // row id makes dismiss/snooze durable for the specific event.
          id: `blending-${d.id}`,
          kind: 'blending', severity: 'info',
          date: String(d.event_date ?? '').slice(0, 10), plant_id: d.plant_id,
          title: `Blending · ${d.well_name}`,
          detail: `Injected ${d.volume_m3} m³ into product water.`,
        });
      });

      // Recovery: most recent compliance snapshot per plant, flagged if it
      // carries a recovery_pct_under violation.
      let qSnap = supabase.from('compliance_snapshots' as any).select('*')
        .order('evaluated_at', { ascending: false }).limit(20);
      if (selectedPlantId) qSnap = qSnap.eq('plant_id', selectedPlantId);
      const { data: snapRows, error: snapErr } = await qSnap;
      if (snapErr) throw snapErr;
      const seen = new Set<string>();
      (snapRows ?? []).forEach((s: any) => {
        const pid = s.plant_id ?? '';
        if (seen.has(pid)) return;
        seen.add(pid);
        for (const v of s.violations ?? []) {
          if (v.code === 'recovery_pct_under') {
            alerts.push({
              id: `recovery-${pid}`,
              kind: 'recovery', severity: v.severity ?? 'medium',
              date: String(s.evaluated_at ?? '').slice(0, 10), plant_id: pid,
              title: 'Recovery below threshold',
              detail: `Recovery ${v.value}% vs. min ${v.threshold}%`,
            });
            break;
          }
        }
      });

      const sevRank: Record<string, number> = { high: 0, medium: 1, low: 2, info: 3 };
      alerts.sort((a, b) => {
        const r = (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9);
        if (r !== 0) return r;
        return Number(String(b.date ?? '').replace(/-/g, '') || 0) - Number(String(a.date ?? '').replace(/-/g, '') || 0);
      });
      const capped = alerts.slice(0, 80);
      return { count: capped.length, alerts: capped };
    },
    retry: false,
    staleTime: 60_000,  // FIX (egress): was 0 (always stale), which let the background-sync sweep refetch this ahead of its own 60s interval
    refetchInterval: 60_000,
  });
  // Memoised so the `?? []` fallback doesn't produce a new array reference on
  // every render — which would re-fire the alert-push useEffect each tick.
  const feedAlerts = useMemo(() => feed?.alerts ?? [], [feed]);

  return {
    _todayKey, rawWaterVol, roPermeateProduction, yRoPermeateProduction,
    production, consumption, kwh, powerCostPeso: todayPowerCostPeso, nrw, pv,
    yRawWaterVol, yProduction, yConsumption, yKwh, dProduction, dConsumption, dRawWater, dKwh,
    yNrw, nrwBreached, roByTrain, wellsByQuality,
    avgPermTds, avgFeedTds, avgRecovery, avgTurb, wellsWithTds, wellsWithNtu, avgRawTds, avgRawTurb,
    plantCodeById, hasCostData, prodCostsChem, chemCostTotal, chemCost, powerCost, productionCost,
    blending, chemInv, trainGaps, wellGaps, locatorGaps, trainHourlyGaps, _localROPerTrain, feed, feedAlerts,
  };
}
