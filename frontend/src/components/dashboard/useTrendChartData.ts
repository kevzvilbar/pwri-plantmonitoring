// Split out of TrendChart.tsx (was 4,095 lines) as part of a file-size
// cleanup pass. This is the "Foundation — highest-risk item" pipeline: the
// single useMemo that turns every raw readings query (well/locator/product/
// RO/power/cost) into one daily row per date, including all
// meter-replacement-aware delta logic, the production-cost formula, and the
// permeate-as-production routing — plus the two small useMemos that bucket
// those daily rows to the active granularity (trendRows) and pre-filter them
// for the kwh stacked bar (kwhChartRows).
//
// Moved verbatim from TrendChart.tsx — no logic changes. See that file's
// git history for the original inline header comments this code carried
// (tariff lookup, computeEntityDeltas semantics, production-source routing,
// gap-fill rules, etc.), which were left in place exactly as they were.
import { useMemo } from 'react';
import { calc } from '@/lib/calculations';
import { format } from 'date-fns';
import { fillDateRange } from './TrendChartPivotShared';
import { buildTrendRows, type Granularity, type TrendFieldConfig } from './TrendChartAggregate';

const TREND_FIELD_AGG: Record<string, TrendFieldConfig> = {
  production: {
    production: 'sum', consumption: 'sum',
    _meterReplacements: 'union', _permeateSourceNames: 'union',
  },
  nrw: {
    production: 'sum', consumption: 'sum',
    _meterReplacements: 'union', _permeateSourceNames: 'union',
  },
  rawwater: { rawwater: 'sum', _meterReplacements: 'union' },
  productionCost: {
    powerCost: { type: 'weighted-avg', weight: '_prodVolForCost' },
    chemCost: { type: 'weighted-avg', weight: '_prodVolForCost' },
    totalCost: { type: 'weighted-avg', weight: '_prodVolForCost' },
  },
  pv: { production: 'sum', kwh: 'sum', solarKwh: 'sum' },
  kwh: { kwh: 'sum', solarKwh: 'sum' },
  tds: { tds: { type: 'weighted-avg', weight: 'tdsSamples' } },
  recovery: { recovery: { type: 'weighted-avg', weight: 'recoverySamples' } },
};

export function useTrendChartData({
  metric, startKey, endKey, startISO, viewGran, usesSharedGranularity, kwhSource,
  locReadings, wellReadings, productReadings, roReadings, powerReadings, costReadings,
  powerTariffs, billMultiplierMap, powerConfigMap,
  wellNames, locatorNames, productMeterNames, plantNames,
  permeateIsProductionPlants, productExcludedPlants,
  _trainPlantMap, _trainUnitTypeMap, _directLocatorIds, _directProductMeterIds,
}: {
  metric: string;
  startKey: string;
  endKey: string;
  startISO: string;
  viewGran: Granularity;
  usesSharedGranularity: boolean;
  kwhSource: 'both' | 'solar' | 'grid';
  locReadings: any[] | undefined;
  wellReadings: any[] | undefined;
  productReadings: any[] | undefined;
  roReadings: any[] | undefined;
  powerReadings: any[] | undefined;
  costReadings: any[] | undefined;
  powerTariffs: any[] | undefined;
  billMultiplierMap: Map<string, number> | undefined;
  powerConfigMap: Map<string, number[]> | undefined;
  wellNames: Map<string, string> | undefined;
  locatorNames: Map<string, string> | undefined;
  productMeterNames: Map<string, string> | undefined;
  plantNames: Map<string, string> | undefined;
  permeateIsProductionPlants: Set<string> | undefined;
  productExcludedPlants: Set<string> | undefined;
  _trainPlantMap: Map<string, string>;
  _trainUnitTypeMap: Map<string, string>;
  _directLocatorIds: Set<string> | undefined;
  _directProductMeterIds: Set<string> | undefined;
}) {
  const chartData = useMemo(() => {
    // ── Tariff lookup: for each plant, sorted array of {effectiveDate, ratePerKwh} ─
    // Used to find the ₱/kWh rate active on a given day:
    //   latest tariff whose effective_date ≤ day's date.
    // If no tariff exists yet for a plant, cost will be null (not 0).
    const tariffsByPlant = new Map<string, { effectiveDate: string; ratePerKwh: number }[]>();
    (powerTariffs ?? []).forEach((t: any) => {
      if (!t.plant_id || t.rate_per_kwh == null) return;
      if (!tariffsByPlant.has(t.plant_id)) tariffsByPlant.set(t.plant_id, []);
      tariffsByPlant.get(t.plant_id)!.push({
        effectiveDate: t.effective_date,
        ratePerKwh: +t.rate_per_kwh,
      });
    });
    // Sort each plant's tariffs ascending by date (already ordered from DB, but ensure)
    tariffsByPlant.forEach((arr) => arr.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate)));

    /** Look up the ₱/kWh rate for a given plant on a given yyyy-MM-dd date. */
    function getRateForDay(plantId: string, dateKey: string): number | null {
      const tariffs = tariffsByPlant.get(plantId);
      if (!tariffs || tariffs.length === 0) return null;
      // Find latest effective tariff ≤ dateKey
      let rate: number | null = null;
      for (const t of tariffs) {
        if (t.effectiveDate <= dateKey) rate = t.ratePerKwh;
        else break;
      }
      return rate;
    }

    const byDay = new Map<string, any>();
    const ensure = (d: string, sortKey: number) =>
      byDay.get(d) ?? byDay.set(d, {
        date: d, sortKey, isoDate: new Date(sortKey).toISOString(),
        production: 0, consumption: 0, rawwater: 0,
        recovery: 0, recoverySamples: 0,
        tds: 0, tdsSamples: 0, kwh: 0, solarKwh: 0,
        // Cost accumulators (raw ₱ amounts, divided by production at the end)
        _powerCostPeso: 0,      // ₱ from power: (grid_kwh × multiplier + solar_kwh) × rate_per_kwh
        _solarKwhForCost: 0,   // solar kWh added to power cost basis
        _chemCostPeso: 0,       // ₱ from chemical: chem_cost column in production_costs
        _hasTariff: false,      // true when at least one power reading had a valid tariff
        powerCost: null as number | null,   // ₱/m³  (computed in final map)
        chemCost: null as number | null,    // ₱/m³
        totalCost: null as number | null,   // ₱/m³  = powerCost + chemCost
        // _meterReplacements: list of human-readable entity names replaced on this day.
        _meterReplacements: [] as string[],
        // _permeateSourcePlants: set of plant IDs whose production came from the permeate
        // meter on this day. Populated only for plants with permeate_is_production = true.
        _permeateSourcePlants: null as Set<string> | null,
      }).get(d);

    // ── Unified meter-replacement-aware delta helper ────────────────────────
    // Used for ALL meter types: wells, locators, product meters, power.
    //
    // entityKeyField: the column that uniquely identifies an individual meter.
    //   • well_readings          → 'well_id'
    //   • locator_readings       → 'locator_id'
    //   • product_meter_readings → 'meter_id'
    //   • power_readings         → 'plant_id'  (one power meter per plant)
    //
    // Keying by the individual meter ID (not plant_id) prevents readings from
    // different meters at the same plant bleeding into each other's diff —
    // the root cause of the -4,853,089 / +885,406 spikes seen in Raw Water.
    //
    // dailyVolumeField: if the table stores a pre-computed daily volume column
    // (e.g. locator_readings.daily_volume), use it directly when present.
    // Wells and product meters don't have this column so pass null.
    //
    // Meter-replacement handling (matches Operations.tsx display logic):
    //   • REPL row (is_meter_replacement = true):
    //       delta = 0, new baseline = current_reading, flag entity as "afterRepl"
    //   • First non-REPL row after a REPL:
    //       delta = 0 (new meter has no valid predecessor yet), clear flag
    //   • All subsequent rows:
    //       delta = current_reading − last seen current_reading for that entity
    //
    // rawDelta is null when there is no predecessor (first reading in window,
    // or first after replacement) so the tooltip doesn't false-flag those as
    // negative readings.
    function computeEntityDeltas(
      readings: any[],
      entityKeyField: string,
      dailyVolumeField: string | null,
      options?: {
        skipAfterRepl?: boolean;
        // IDs (e.g. locator_id) whose default_input_mode = 'direct' —
        // current_reading already IS the period's volume for these. Mirrors
        // EntityHistoryChart.tsx's isDirectMode branch.
        directModeIds?: Set<string>;
      },
    ): { r: any; delta: number; rawDelta: number | null; isMeterReplacement: boolean }[] {
      // skipAfterRepl=true: the replacement row already sets lastReading to the
      // new meter's starting value, so the very next reading can diff against it
      // normally (e.g. RO permeate: repl=227,368 → next=228,106 → delta=737.7).
      // skipAfterRepl=false (default): the row immediately after a replacement is
      // zeroed as a safety net for meter types where the replacement reading may
      // not be a reliable baseline (locators, wells, product meters).
      const skipAfterRepl = options?.skipAfterRepl ?? false;
      const directModeIds = options?.directModeIds;

      const sorted = [...readings].sort(
        (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
      );

      const lastReading = new Map<string, number>(); // entityKey → last current_reading
      const afterRepl   = new Set<string>();          // entities whose next row is zeroed

      return sorted.map((r) => {
        const entityKey = r[entityKeyField] ?? r.plant_id ?? '__';
        const isMR      = !!r.is_meter_replacement;

        if (isMR) {
          lastReading.set(entityKey, +r.current_reading);
          if (!skipAfterRepl) afterRepl.add(entityKey);
          return { r, delta: 0, rawDelta: null, isMeterReplacement: true };
        }

        if (afterRepl.has(entityKey)) {
          lastReading.set(entityKey, +r.current_reading);
          afterRepl.delete(entityKey);
          return { r, delta: 0, rawDelta: null, isMeterReplacement: false };
        }

        if (directModeIds?.has(entityKey)) {
          // Direct mode: current_reading already IS the period's volume — no
          // diff, no dependence on daily_volume/previous_reading.
          const delta = r.current_reading != null ? Math.max(0, +r.current_reading) : 0;
          lastReading.set(entityKey, +r.current_reading);
          return { r, delta, rawDelta: null, isMeterReplacement: false };
        }

        if (dailyVolumeField && r[dailyVolumeField] != null && !lastReading.has(entityKey)) {
          // Only trust the stored daily_volume for the FIRST row of this
          // entity within the fetched window, where there's no locally
          // walked predecessor to diff against — that stored value may
          // legitimately span >1 day if readings were skipped before the
          // window. Once a predecessor HAS been walked (below), always diff
          // live against it instead: daily_volume/previous_reading are
          // written once at insert time and never cascaded when an earlier
          // reading is later edited/deleted/replaced, so a downstream row can
          // keep pointing at a stale predecessor indefinitely. That's what
          // made Coke/Parkmall's Aug 7–10 daily_volume grow into a
          // cumulative-looking total instead of a single day's delta — see
          // the identical fix in DataSummaryModal.tsx's
          // computePivotFromReadingsNoCache.
          const storedVol = Math.max(0, +r[dailyVolumeField]);
          const delta     = storedVol;
          lastReading.set(entityKey, +r.current_reading);
          return { r, delta, rawDelta: null, isMeterReplacement: false };
        }

        if (!lastReading.has(entityKey)) {
          lastReading.set(entityKey, +r.current_reading);
          // If the DB stored previous_reading, compute the delta instead of returning 0.
          // Without this, the first reading in the fetch window (no prior in-memory row)
          // always shows 0, causing a false dip at the start of every range.
          if (r.previous_reading != null) {
            const rawDelta = +r.current_reading - +r.previous_reading;
            // On the INITIAL reading: an unflagged replacement, rollover, or backward
            // entry from before the window must not produce a negative delta (or plunge
            // to -2.1M on the chart). If negative, treat as an unanchored initial point.
            if (rawDelta >= 0) {
              return { r, delta: rawDelta, rawDelta, isMeterReplacement: false };
            }
            return { r, delta: 0, rawDelta: null, isMeterReplacement: true };
          }
          // No previous_reading in DB → we genuinely don't know the delta for this
          // first row. Return null delta so the chart gaps rather than plots 0.
          return { r, delta: 0, rawDelta: null, isMeterReplacement: true };
          // Note: isMeterReplacement=true here causes the caller to skip this point,
          // preventing a false zero at the start of a date window.
        }

        const rawDelta = +r.current_reading - lastReading.get(entityKey)!;
        // Clamp to 0: a meter reading that goes backwards is a bad entry or an
        // un-flagged meter reset. Propagating a negative tanks the chart
        // (e.g. Raw Water −1.1M spike on May 4–5, or −200K dip). Matches buildEntityPivot.
        const delta    = Math.max(0, rawDelta);
        lastReading.set(entityKey, +r.current_reading);
        return { r, delta, rawDelta, isMeterReplacement: false };
      });
    }

    // ── Raw Water = sum of per-well deltas ─────────────────────────────────
    // Uses computeEntityDeltas for sequential in-memory delta tracking
    // (daily_volume priority → lastSeen sequential → DB previous_reading).
    // buildEntityPivot now uses the same strategy, so the chart line,
    // Overview table, and Per Well "Total Raw" are always consistent.
    computeEntityDeltas(wellReadings ?? [], 'well_id', null).forEach(({ r, delta, rawDelta, isMeterReplacement }) => {
      const dt = new Date(r.reading_datetime);
      if (dt < new Date(startISO)) return;
      const dateKey = format(dt, 'yyyy-MM-dd');
      if (dateKey < startKey || dateKey > endKey) return;

      const key = format(dt, 'MMM d');
      const row = ensure(key, dt.getTime());
      row.rawwater += delta;
      if (isMeterReplacement && dateKey >= startKey && dateKey <= endKey) {
        const entityName = wellNames?.get(r.well_id) ?? r.well_id ?? 'Well';
        const label = `${entityName} Raw Meter`;
        if (!row._meterReplacements.includes(label)) row._meterReplacements.push(label);
      }
    });

    // ── Production source routing ─────────────────────────────────────────────
    // Plants where permeate_is_production = true use the RO permeate meter delta
    // as their production volume instead of a dedicated product meter.
    // Multi-plant selections mix sources: Plant A → permeate delta, Plant B → product meter.
    // Both contributions accumulate into the same `production` field so the line
    // stays a single unified series.

    // Step 1: accumulate product meter readings for plants that use a product
    // meter — i.e. everyone EXCEPT plants in exclusive 'permeate' mode (whose
    // product meter reads the same water the RO permeate meter already counts
    // in Step 2). Plants in 'both' mode fall through here on purpose — their
    // product meter is a genuinely separate source and must be summed in.
    computeEntityDeltas(
      (productReadings ?? []).filter((r: any) => !(productExcludedPlants?.has(r.plant_id))),
      'meter_id',
      'daily_volume',
      { directModeIds: _directProductMeterIds },
    ).forEach(({ r, delta, rawDelta, isMeterReplacement }) => {
      const dt = new Date(r.reading_datetime);
      const key = format(dt, 'MMM d');
      const row = ensure(key, dt.getTime());
      row.production += delta;
      if (isMeterReplacement) {
        const entityName = productMeterNames?.get(r.meter_id) ?? r.meter_id ?? 'Product Meter';
        const label = `${entityName} Product Meter`;
        if (!row._meterReplacements.includes(label)) row._meterReplacements.push(label);
      }
    });

    // Step 2: accumulate permeate meter deltas for plants where permeate_is_production = true.
    //
    // Uses permeate_meter_delta (pre-saved curr−prev) and reading_datetime for
    // date bucketing. The permeate_production_date / 00:20 cutoff rule has been
    // removed — a reading recorded on May 1 at any time counts as May 1 production,
    // consistent with the DataSummaryModal's Production and Prod vs Consum tabs.
    // Falls back to computeEntityDeltas when columns not yet populated (NULL).
    if (permeateIsProductionPlants && permeateIsProductionPlants.size > 0) {
      const hasSavedDelta = (roReadings ?? []).some(
        (r: any) => r.permeate_meter_delta != null && +r.permeate_meter_delta > 0,
      );

      if (hasSavedDelta) {
        // ── PRIMARY PATH ─────────────────────────────────────────────────────
        (roReadings ?? []).forEach((r: any) => {
          const plantId = _trainPlantMap.get(r.train_id);
          if (!plantId || !permeateIsProductionPlants.has(plantId)) return;
          if (_trainUnitTypeMap.get(r.train_id) === 'secondary') return;

          // Skip replacement rows first — their saved delta is the old-meter→new-meter
          // jump (e.g. 72,691 → 227,368) which is not real production. The same-day
          // non-replacement row(s) already carry the valid pre-swap production delta
          // and will be summed in separately below.
          if (r.is_meter_replacement) return;

          const delta = r.permeate_meter_delta != null ? Math.max(0, +r.permeate_meter_delta)
            : r.permeate_meter != null && r.permeate_meter_prev != null
              ? Math.max(0, +r.permeate_meter - +r.permeate_meter_prev)
              : null;
          // Use === null so a legitimate delta of 0 is still plotted (don't skip it).
          if (delta === null) return;

          // Date bucketing: attribute each reading to the local calendar day it
          // was recorded. The old cut-off / production-period logic has been
          // removed system-wide — consistent with DataSummaryModal.
          const prodDateStr = format(new Date(r.reading_datetime as string), 'yyyy-MM-dd');
          const prodDt = new Date(prodDateStr + 'T12:00:00'); // noon for stable sorting
          const key = format(prodDt, 'MMM d');
          const row = ensure(key, prodDt.getTime());
          row.production += delta;
          if (!row._permeateSourcePlants) row._permeateSourcePlants = new Set<string>();
          row._permeateSourcePlants.add(plantId);
        });
      } else {
        // ── FALLBACK PATH (permeate_meter_delta columns still NULL) ──────────
        // Use computeEntityDeltas on the raw cumulative permeate_meter odometer.
        //
        // CRITICAL: do NOT pre-filter out is_meter_replacement rows before
        // passing to computeEntityDeltas. If removed, lastReading for that train
        // stays at the old meter value. The next real reading on the new meter
        // (e.g. 227,368) then diffs against the old value (72,691) producing a
        // massive false spike (~154K m3).
        //
        // Instead, include replacement rows with current_reading = permeate_meter
        // (the new meter start value). computeEntityDeltas sees isMR=true and
        // resets lastReading to the new baseline. skipAfterRepl=true means the
        // immediately following reading diffs against that new baseline normally
        // (e.g. Mar 5: 228,106 − 227,368 = 737.7) instead of being zeroed.
        const permeateRoReadings = (roReadings ?? [])
          .filter((r: any) => {
            const plantId = _trainPlantMap.get(r.train_id);
            return plantId && permeateIsProductionPlants.has(plantId)
              && _trainUnitTypeMap.get(r.train_id) !== 'secondary'
              && r.permeate_meter != null;
            // NOTE: is_meter_replacement rows are intentionally kept here
          })
          .map((r: any) => ({ ...r, current_reading: +r.permeate_meter }));

        computeEntityDeltas(permeateRoReadings, 'train_id', null, { skipAfterRepl: true }).forEach(({ r, delta, isMeterReplacement }) => {
          // replacement row and first post-replacement row both return delta=0
          if (delta === 0) return;
          if (isMeterReplacement) return;
          const plantId = _trainPlantMap.get(r.train_id)!;
          const dt = new Date(r.reading_datetime);
          const key = format(dt, 'MMM d');
          const row = ensure(key, dt.getTime());
          row.production += delta;
          if (!row._permeateSourcePlants) row._permeateSourcePlants = new Set<string>();
          row._permeateSourcePlants.add(plantId);
        });
      }
    }

    // Consumption = sum of locator (distribution/endpoint) meter deltas.
    // NOTE: locReadings are now fetched via locator_id (not plant_id) so all
    // plants return data correctly — see the two-step query above.
    computeEntityDeltas(locReadings ?? [], 'locator_id', 'daily_volume', { directModeIds: _directLocatorIds }).forEach(({ r, delta, rawDelta, isMeterReplacement }) => {
      const dt = new Date(r.reading_datetime);
      const key = format(dt, 'MMM d');
      const row = ensure(key, dt.getTime());
      row.consumption += delta;
      if (isMeterReplacement) {
        const entityName = locatorNames?.get(r.locator_id) ?? r.locator_id ?? 'Locator';
        const label = `${entityName} Meter`;
        if (!row._meterReplacements.includes(label)) row._meterReplacements.push(label);
      }
    });

    (roReadings ?? []).forEach((r: any) => {
      const dt = new Date(r.reading_datetime);
      const key = format(dt, 'MMM d');
      const row = ensure(key, dt.getTime());
      if (r.recovery_pct != null) { row.recovery += +r.recovery_pct; row.recoverySamples += 1; }
      if (r.permeate_tds != null) { row.tds += +r.permeate_tds; row.tdsSamples += 1; }
    });

    // Power kWh — priority order mirrors the fixed Plants.tsx PowerConsumptionEnergyMix:
    //   1. Raw JSONB multi-meter delta × per-meter CT multiplier  ← live, never stale
    //   2. Raw single-meter delta × multiplierArr[0]              ← live, single-meter fallback
    //   3. daily_consumption_kwh                                  ← stored at write time; may be stale
    //   4. daily_grid_kwh                                         ← same fallback
    //
    // Rationale: daily_consumption_kwh is computed once when the reading is saved.
    // If the previous-reading baseline was wrong at that moment (meter change, backfill,
    // import ordering), the stored value is permanently wrong — causing chart spikes
    // that disagree with the "Last 7 readings" panel, which always recomputes live.
    // Computing from raw readings first keeps the chart consistent with that panel.
    {
      const sorted = [...(powerReadings ?? [])].sort(
        (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
      );
      // Per-plant tracking state (mirrors Plants.tsx prevGridMeter/prevGridReadings)
      const prevGridMeter    = new Map<string, number | null>();
      const prevGridReadings = new Map<string, Record<string, number> | null>();
      const afterGridRepl    = new Set<string>();

      for (const r of sorted) {
        const pid  = r.plant_id ?? '__';
        const isMR = !!r.is_meter_replacement;
        const gridCurrent = r.meter_reading_kwh != null ? +r.meter_reading_kwh : null;
        const rGmr = r.grid_meter_readings as Record<string, number> | null | undefined;

        if (isMR) {
          // Replacement row: zero this day, reset baseline for next delta
          prevGridMeter.set(pid, gridCurrent);
          prevGridReadings.set(pid, rGmr ?? null);
          afterGridRepl.add(pid);
          // Still record the meter replacement label so the tooltip shows it
          const dt = new Date(r.reading_datetime);
          if (dt >= new Date(startISO)) {
            const dateKey = format(dt, 'yyyy-MM-dd');
            if (dateKey >= startKey && dateKey <= endKey) {
              const key = format(dt, 'MMM d');
              const row = ensure(key, dt.getTime());
              const entityName = plantNames?.get(pid) ?? pid ?? 'Plant';
              const label = `${entityName} Power Meter`;
              if (!row._meterReplacements.includes(label)) row._meterReplacements.push(label);
            }
          }
          continue;
        }

        let gridKwh = 0;
        // Per-meter multiplier array: plant_power_config wins, then billMultiplierMap scalar, then 1
        const multArr: number[] = powerConfigMap?.get(pid) ?? [
          +(r.multiplier ?? 0) > 0 ? +r.multiplier : (billMultiplierMap?.get(pid) ?? 1),
        ];

        if (!afterGridRepl.has(pid)) {
          const pGmr   = prevGridReadings.get(pid) ?? null;
          const pMeter = prevGridMeter.get(pid) ?? null;

          if (rGmr && pGmr && Object.keys(rGmr).length > 0) {
            // Priority 1: multi-meter JSONB delta × per-meter CT multiplier
            let total = 0;
            for (const k of Object.keys(rGmr)) {
              const mi    = parseInt(k, 10);
              const mMult = multArr[mi] ?? multArr[0] ?? 1;
              if (pGmr[k] != null) total += (rGmr[k] - pGmr[k]) * mMult;
            }
            gridKwh = total;
          } else if (pMeter != null && gridCurrent != null) {
            // Priority 2: single-meter legacy — (curr − prev) × multArr[0]
            const rawDelta = gridCurrent - pMeter;
            gridKwh = rawDelta * (multArr[0] ?? 1);
          }

          // Priority 3 & 4: stored daily totals — only when no raw readings available.
          //
          // IMPORTANT multiplier note:
          //   • daily_grid_kwh   — stored post-multiplication (already × CT ratio).
          //                        Use as-is.
          //   • daily_consumption_kwh — stored as the raw meter delta (NOT multiplied)
          //                        when the reading was first saved (e.g. Δ = 11 while
          //                        the actual kWh = 11 × 2400 = 26,400). Applying
          //                        multArr[0] here matches what the Operations history
          //                        table shows and what the physical meter produces.
          //
          // Order: prefer daily_grid_kwh (already correct) → daily_consumption_kwh × mult.
          if (gridKwh === 0) {
            if (r.daily_grid_kwh != null && +r.daily_grid_kwh > 0)
              gridKwh = +r.daily_grid_kwh;
            else if (r.daily_consumption_kwh != null && +r.daily_consumption_kwh > 0)
              gridKwh = +r.daily_consumption_kwh * (multArr[0] ?? 1);
          }
        }
        afterGridRepl.delete(pid);
        prevGridMeter.set(pid, gridCurrent);
        prevGridReadings.set(pid, rGmr ?? null);

        // Only plot rows within the requested window
        const dt = new Date(r.reading_datetime);
        if (dt < new Date(startISO)) continue;
        const dateKey = format(dt, 'yyyy-MM-dd');
        if (dateKey < startKey || dateKey > endKey) continue;

        const key = format(dt, 'MMM d');
        if (gridKwh > 0) {
          const row = ensure(key, dt.getTime());
          row.kwh += gridKwh;
        }

        // productionCost: accumulate ₱ power cost for this day
        if (metric === 'productionCost' && gridKwh > 0) {
          const rate = getRateForDay(pid, dateKey);
          if (rate != null) {
            const row = ensure(key, dt.getTime());
            const solarForCost = (r.daily_solar_kwh != null)
              ? Math.max(0, +r.daily_solar_kwh) : 0;
            row._solarKwhForCost += solarForCost;
            row._powerCostPeso   += gridKwh * rate;
            row._hasTariff        = true;
          }
        }
      }
    }

    // Accumulate daily_solar_kwh per day for the (Grid+Solar) PV ratio line.
    // Skips null/zero rows so the ratio stays null on days with no solar data.
    // Pre-window rows (fetched to seed grid baseline) and out-of-range rows are skipped.
    (powerReadings ?? []).forEach((r: any) => {
      if (r.daily_solar_kwh == null || r.is_meter_replacement) return;
      const solarVal = +r.daily_solar_kwh;
      if (solarVal <= 0) return;
      const dt = new Date(r.reading_datetime);
      if (dt < new Date(startISO)) return;
      const dateKey = format(dt, 'yyyy-MM-dd');
      if (dateKey < startKey || dateKey > endKey) return;
      const key = format(dt, 'MMM d');
      const row = ensure(key, dt.getTime());
      row.solarKwh += solarVal;
    });

    // Chemical cost: chem_cost (₱/day) from production_costs table.
    // Operators log this manually in Costs → Rollup (or via CSV import).
    // Chem Cost (₱/m³) = chem_cost / production_m3  (computed in final map below)
    (costReadings ?? []).forEach((r: any) => {
      const dateKey = r.cost_date;
      if (dateKey < startKey || dateKey > endKey) return;
      const dt = new Date(`${dateKey}T00:00:00`);
      const key = format(dt, 'MMM d');
      const row = ensure(key, dt.getTime());
      const chem = +(r.chem_cost ?? 0);
      row._chemCostPeso += chem;
    });

    const sparseRows = Array.from(byDay.values())
      .sort((a, b) => a.sortKey - b.sortKey)
      .map(({ sortKey: _s, recoverySamples, tdsSamples, _powerCostPeso, _solarKwhForCost, _chemCostPeso, _hasTariff, _permeateSourcePlants, ...d }) => {
        // ── Production Cost formula ────────────────────────────────────────────
        // All three metrics expressed as ₱/m³ (unit cost):
        //   Power Cost  = (grid_kwh × multiplier + solar_kwh) × rate_per_kwh / production_m3
        //   Chem Cost   = chem_cost_₱                                         / production_m3
        //   Prod Cost   = Power Cost + Chem Cost
        //
        // _powerCostPeso already holds grid_kwh × rate_per_kwh.
        // _solarKwhForCost holds the day's solar kWh; we need its rate too.
        // Since solar shares the same tariff rate as grid on a given day, we
        // reuse the already-accumulated ratio: add solar × (rate implied by grid cost / grid kwh).
        // Simpler: store the rate alongside _powerCostPeso so we can apply it to solar.
        // For now, rate was applied per reading — solar cost = _solarKwhForCost already
        // has its rate baked in via _powerCostPeso accumulation below.
        //
        // NOTE: The solar contribution is added to _powerCostPeso at accumulation time.
        // _solarKwhForCost is tracked for informational purposes.
        // Total power cost ₱ = _powerCostPeso (grid cost) + solar cost (₱)
        // Solar cost ₱ is computed below using the average rate derived from grid readings.
        // ── Production volume denominator ─────────────────────────────────────
        // Priority: product meter readings → permeate meter → well readings (raw water).
        // Plants that have no product meter (e.g. direct abstraction wells) report
        // their output volume via well_readings, which accumulates into `d.rawwater`.
        // Using rawwater as fallback lets Power Cost (₱/m³) work for those plants
        // without requiring a separate product meter setup.
        const prodVol = d.production > 0 ? d.production
          : d.rawwater   > 0 ? d.rawwater
          : null;
        // Derive average rate from accumulated grid cost ÷ grid kWh (d.kwh).
        // Then apply that same rate to solar kWh.
        const gridKwh = d.kwh > 0 ? d.kwh : 0;
        const avgRate = (_hasTariff && gridKwh > 0) ? _powerCostPeso / gridKwh : null;
        const solarCostPeso = (avgRate != null && _solarKwhForCost > 0)
          ? _solarKwhForCost * avgRate : 0;
        const totalPowerCostPeso = _powerCostPeso + solarCostPeso;
        const powerCostPerM3 = (_hasTariff && prodVol != null)
          ? +(totalPowerCostPeso / prodVol).toFixed(4) : null;
        const chemCostPerM3  = (prodVol != null && _chemCostPeso > 0)
          ? +(_chemCostPeso  / prodVol).toFixed(4) : null;
        const totalCostPerM3 = (powerCostPerM3 != null || chemCostPerM3 != null)
          ? +((powerCostPerM3 ?? 0) + (chemCostPerM3 ?? 0)).toFixed(4) : null;
        return {
          ...d,
          recovery: recoverySamples ? +(d.recovery / recoverySamples).toFixed(1) : null,
          tds: tdsSamples ? Math.round(d.tds / tdsSamples) : null,
          nrw: calc.nrw(d.production, d.consumption),
          // ₱/m³ unit costs — null when data is missing
          powerCost: powerCostPerM3,
          chemCost:  chemCostPerM3,
          totalCost: totalCostPerM3,
          // _meterReplacements is already in ...d — preserved for the tooltip
          _permeateSourceNames: _permeateSourcePlants
            ? Array.from<string>(_permeateSourcePlants)
                .map((id) => plantNames?.get(id) ?? id)
                .sort()
            : [] as string[],
          // ── Weekly/Monthly rollup support (Foundation) ──────────────────
          // These three are read-only inputs to buildTrendRows' weighted-avg
          // aggregation (see TREND_FIELD_AGG above) — every existing daily
          // consumer of chartData simply ignores them. Without preserving
          // recoverySamples/tdsSamples/prodVol here, a weekly TDS or Cost
          // figure could only be a plain (wrong) average of daily averages
          // instead of the correctly volume/sample-weighted one.
          recoverySamples, tdsSamples, _prodVolForCost: prodVol,
        };
      });

    // ── Gap-fill: insert null-value stub rows for every calendar day that has
    // no readings (e.g. April when data spans Mar→May with a full month gap).
    // Without this, the chart line jumps across the gap and the Overview table
    // omits entire months.  We only fill when the window is ≤ 366 days to
    // avoid generating thousands of stubs for very long ranges.

    // ── Timezone safety: drop any row whose local date falls outside [startKey, endKey].
    // When the user is in UTC+8 (Philippines), a reading stored at e.g.
    // 2026-05-17T16:00:00Z renders as May 18 00:00 local time, so it can
    // slip through the Supabase filter (which also uses endKey) and appear
    // as a future date in the chart. Likewise, pre-window seed readings must
    // not leak into the chart domain. Bounding here is the final safeguard.
    const boundedSparseRows = sparseRows.filter((r) => {
      const dk = format(new Date(r.isoDate), 'yyyy-MM-dd');
      return dk >= startKey && dk <= endKey;
    });

    if (boundedSparseRows.length < 2) return boundedSparseRows;
    const firstDk = format(new Date(boundedSparseRows[0].isoDate), 'yyyy-MM-dd');
    const lastDk  = format(new Date(boundedSparseRows[boundedSparseRows.length - 1].isoDate), 'yyyy-MM-dd');
    const spanDays = (new Date(lastDk).getTime() - new Date(firstDk).getTime()) / 86_400_000;
    if (spanDays > 366) return boundedSparseRows;
    const sparseByDate = new Map(boundedSparseRows.map((r) => [format(new Date(r.isoDate), 'yyyy-MM-dd'), r]));
    const allCalDays = fillDateRange(firstDk, lastDk);
    return allCalDays.map((dk) => {
      if (sparseByDate.has(dk)) return sparseByDate.get(dk)!;
      const dt = new Date(dk + 'T00:00:00');
      return {
        date: format(dt, 'MMM d'),
        isoDate: dt.toISOString(),
        production: 0, consumption: 0, rawwater: 0,
        recovery: null, tds: null, kwh: null, solarKwh: null,
        nrw: 0, powerCost: null, chemCost: null, totalCost: null,
        _meterReplacements: [], _permeateSourceNames: [],
      };
    });
  }, [locReadings, wellReadings, productReadings, roReadings, powerReadings, costReadings, powerTariffs,
      billMultiplierMap, powerConfigMap, metric, wellNames, locatorNames, productMeterNames, plantNames,
      permeateIsProductionPlants, productExcludedPlants, _trainPlantMap, _trainUnitTypeMap, startISO, startKey, endKey, _directLocatorIds, _directProductMeterIds]);

  // ── trendRows: chartData bucketed to the active granularity (M1 + M4) ────
  // chartData itself stays DAILY, unchanged, always — it's still what feeds
  // DataSummaryPopup's day-by-day pivot table. trendRows is the derived,
  // display-only weekly/monthly rollup used by the chart itself (and by the
  // kwh bars / PV tooltip / cost tooltip below it) whenever viewGran !=
  // 'daily'. nrw is re-derived from the BUCKET's summed production/
  // consumption rather than passed through TREND_FIELD_AGG, since NRW% is
  // not independently averageable (see TREND_FIELD_AGG's comment above).
  const trendRows = useMemo(() => {
    if (!usesSharedGranularity) return chartData;
    const fields = TREND_FIELD_AGG[metric];
    if (!fields) return chartData;
    const bucketed = buildTrendRows(chartData as any, {
      granularity: viewGran, fields, rangeStartKey: startKey, rangeEndKey: endKey,
    });
    if (metric === 'production' || metric === 'nrw') {
      return bucketed.map((r) => ({ ...r, nrw: calc.nrw((r.production as number) ?? 0, (r.consumption as number) ?? 0) }));
    }
    return bucketed;
  }, [chartData, usesSharedGranularity, viewGran, metric, startKey, endKey]);

  // Pre-filtered chart rows for the kwh stacked bar — mirrors PowerChart's
  // chartRows useMemo: maps source filter into solarKwh/gridKwh so bars with
  // value 0 are never emitted (avoids phantom bar space in recharts).
  // NOTE: must be declared AFTER trendRows (depends on it) to avoid a
  //       temporal dead zone ("Cannot access 'X' before initialization").
  const kwhChartRows = useMemo(() => {
    if (metric !== 'kwh') return [];
    return trendRows.map((d: any) => ({
      date:     d.date,
      solarKwh: kwhSource !== 'grid'  ? (d.solarKwh ?? 0) : 0,
      gridKwh:  kwhSource !== 'solar' ? (d.kwh      ?? 0) : 0,
      _partial: d._partial,
    }));
  }, [trendRows, kwhSource, metric]);

  return { chartData, trendRows, kwhChartRows };
}
