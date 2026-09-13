/**
 * plantReconciliation.ts
 *
 * Pure, testable aggregation backing the dashboard's ReconciliationHealthCard:
 * turns raw ro_train_readings / product_meter_readings rows into per-plant
 * permeate-vs-product reconciliation rows.
 *
 * Kept separate from useReconciliationHealthTotals.ts (which only wires it to
 * React Query + the app date range) so the config gating and the delta math can
 * be unit-tested without any hooks or supabase involved.
 */

import { computeEntityDeltas } from '@/lib/entityDeltas';
import {
  computePermeateReconciliation,
  type TrainPermeateDetail,
  type ProductMeterDetail,
  type PermeateReconciliationResult,
} from '@/lib/waterBalanceReconciliation';

export interface PlantReconciliationRow {
  plantId: string;
  plantName: string;
  result: PermeateReconciliationResult;
}

export interface ReconciliationBuildInput {
  roReadings: any[];
  productReadings: any[];
  roTrains: {
    id: string;
    plant_id: string;
    train_number: number;
    name?: string | null;
    unit_type?: string | null;
  }[];
  productMeters: { id: string; plant_id: string; name: string; is_derived: boolean }[];
  plants: { id: string; name: string }[];
  /** Plants running a dedicated product meter (see resolveReconcilablePlantIds). */
  reconcilablePlantIds: Set<string>;
  /** Secondary (2nd-pass) RO unit ids — never reconciled against a bulk meter. */
  secondaryTrainIds: Set<string>;
}

/**
 * Plants that can be reconciled against their RO permeate: those running a
 * DEDICATED product meter (`ro_production_source === 'product'`). 'permeate'
 * plants (permeate IS production — any product meter just re-reads the same
 * flow) and 'both' plants (permeate + product are independent sources whose
 * totals get ADDED, so a gap is expected, not a fault) are excluded — neither
 * has a meaningful permeate↔product delta.
 *
 * Plants absent from plant_meter_config fall back to the DEFAULT_METER_CONFIG
 * default of 'product' — the same fallback shared.tsx applies on the config
 * page — so a plant that simply never opened the config page still shows up
 * rather than silently disappearing from the triage list.
 */
export function resolveReconcilablePlantIds(
  plants: { id: string }[],
  meterConfigs: { plant_id: string; config?: { ro_production_source?: string | null } | null }[],
): Set<string> {
  const out = new Set<string>();
  meterConfigs.forEach((c) => {
    if ((c.config?.ro_production_source ?? 'product') === 'product') out.add(c.plant_id);
  });
  plants.forEach((p) => {
    if (!meterConfigs.some((c) => c.plant_id === p.id)) out.add(p.id);
  });
  return out;
}

/**
 * Aggregates raw readings into per-plant reconciliation rows.
 *
 * Per-train permeate deltas and per-meter product deltas are summed the same
 * way useWaterBalanceReconciliation.ts does (stored permeate_meter_delta
 * preferred, permeate_meter − permeate_meter_prev fallback, replacement rows
 * skipped, negatives clamped, is_derived meters in direct mode), grouped by
 * plant and fed to computePermeateReconciliation. Plants are dropped when they
 * are not reconciliable by config or have no readings in the window. Rows come
 * back worst-variance-first.
 */
export function buildPlantReconciliationRows(input: ReconciliationBuildInput): PlantReconciliationRow[] {
  const {
    roReadings, productReadings, roTrains, productMeters, plants,
    reconcilablePlantIds, secondaryTrainIds,
  } = input;

  // ── Per-train permeate delta (mirrors useWaterBalanceReconciliation.ts) ──
  const trainVolumeMap = new Map<string, number>();
  roReadings.forEach((r: any) => {
    if (!r?.train_id || r.is_meter_replacement) return;
    if (secondaryTrainIds.has(r.train_id)) return;
    const delta =
      r.permeate_meter_delta != null
        ? Math.max(0, +r.permeate_meter_delta)
        : r.permeate_meter != null && r.permeate_meter_prev != null
        ? Math.max(0, +r.permeate_meter - +r.permeate_meter_prev)
        : 0;
    trainVolumeMap.set(r.train_id, (trainVolumeMap.get(r.train_id) || 0) + delta);
  });

  // ── Per-meter product delta (is_derived meters are direct-mode) ──────────
  const directProductMeterIds = new Set(productMeters.filter((m) => m.is_derived).map((m) => m.id));
  const prodDeltas = computeEntityDeltas(productReadings, 'meter_id', 'daily_volume', {
    directModeIds: directProductMeterIds,
  });
  const meterVolumeMap = new Map<string, number>();
  prodDeltas.forEach(({ r, delta }) => {
    if (r?.meter_id) meterVolumeMap.set(r.meter_id, (meterVolumeMap.get(r.meter_id) || 0) + delta);
  });

  // ── Group by plant — only for reconciliable plants, primary units only ───
  const byPlant = new Map<string, { trains: TrainPermeateDetail[]; meters: ProductMeterDetail[] }>();
  roTrains.forEach((t) => {
    if (!reconcilablePlantIds.has(t.plant_id)) return;
    if (secondaryTrainIds.has(t.id)) return;
    const entry = byPlant.get(t.plant_id) ?? { trains: [], meters: [] };
    entry.trains.push({
      trainId: t.id,
      trainNumber: t.train_number,
      name: t.name,
      volume: trainVolumeMap.get(t.id) ?? 0,
    });
    byPlant.set(t.plant_id, entry);
  });
  productMeters.forEach((m) => {
    if (!reconcilablePlantIds.has(m.plant_id)) return;
    const entry = byPlant.get(m.plant_id) ?? { trains: [], meters: [] };
    entry.meters.push({ meterId: m.id, name: m.name, volume: meterVolumeMap.get(m.id) ?? 0 });
    byPlant.set(m.plant_id, entry);
  });

  const plantNameMap = new Map<string, string>();
  plants.forEach((p) => plantNameMap.set(p.id, p.name));

  const out: PlantReconciliationRow[] = [];
  byPlant.forEach((entry, plantId) => {
    const result = computePermeateReconciliation(entry.trains, entry.meters);
    // Only plants with BOTH streams actually reading in the window are
    // comparable — a plant whose meters have no data has nothing to reconcile.
    if (!result.hasTrainData || !result.hasProductData) return;
    out.push({ plantId, plantName: plantNameMap.get(plantId) ?? 'Unknown plant', result });
  });

  // Worst variance first so the plants most likely to need attention surface at the top.
  out.sort((a, b) => (b.result.variancePct ?? 0) - (a.result.variancePct ?? 0));
  return out;
}