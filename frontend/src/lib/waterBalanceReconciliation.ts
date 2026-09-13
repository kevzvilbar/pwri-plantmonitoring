/**
 * waterBalanceReconciliation.ts
 *
 * Mathematical engine for plant water balance conservation and permeate reconciliation.
 * Strictly adheres to real physical principles:
 *   - Raw In = Well Extractions
 *   - RO Permeate = Sum of RO Train Permeate deltas
 *   - Product Metered = Sum of bulk product meter deltas
 *   - Reconciliation Variance = RO Permeate - Product Metered
 *   - Reconciled Production = RO Permeate, OR Product Metered, OR (in 'both'
 *     mode, where the two meters read genuinely different water) their SUM
 *   - Distribution Input = Reconciled Production + Blending
 *   - Non-Revenue Water (NRW) = Distribution Input - Locator Consumption
 */

export type ReconciliationStatus = 'balanced' | 'marginal' | 'alert';

export interface TrainPermeateDetail {
  trainId: string;
  trainNumber: number;
  name?: string | null;
  volume: number;
}

export interface ProductMeterDetail {
  meterId: string;
  name: string;
  volume: number;
}

export interface PermeateReconciliationResult {
  totalTrainPermeate: number;
  totalProductMeter: number;
  deltaVariance: number;
  variancePct: number | null;
  status: ReconciliationStatus;
  trainDetails: TrainPermeateDetail[];
  meterDetails: ProductMeterDetail[];
  hasTrainData: boolean;
  hasProductData: boolean;
}

export interface PlantWaterBalanceSummary {
  hasAnyData: boolean;
  rawWaterIn: number;
  roPermeate: number;
  productMetered: number;
  reconciledProduction: number;
  blending: number;
  distributionInput: number;
  locatorConsumption: number;
  nrwVolume: number;
  nrwPct: number | null;
  reconciliation: PermeateReconciliationResult;
  /** Volume attribution mapped to individual topology node IDs */
  nodeVolumes: Record<string, number>;
}

/**
 * Classifies reconciliation discrepancy into industrial SCADA operational bands:
 *   - <= 2.0%: Balanced (Standard flow meter calibration tolerance)
 *   - 2.1% - 5.0%: Marginal Discrepancy (Calibration drift or auxiliary wash/CIP usage)
 *   - > 5.0%: Actionable Variance Alert (Potential header leak, faulty meter, or bypass)
 */
export function classifyReconciliationVariance(variancePct: number | null): ReconciliationStatus {
  if (variancePct === null) return 'balanced';
  if (variancePct <= 2.0) return 'balanced';
  if (variancePct <= 5.0) return 'marginal';
  return 'alert';
}

/**
 * Computes permeate reconciliation between individual RO trains and bulk product meters.
 */
export function computePermeateReconciliation(
  trainDetails: TrainPermeateDetail[],
  meterDetails: ProductMeterDetail[]
): PermeateReconciliationResult {
  const totalTrainPermeate = trainDetails.reduce((sum, t) => sum + (t.volume > 0 ? t.volume : 0), 0);
  const totalProductMeter = meterDetails.reduce((sum, m) => sum + (m.volume > 0 ? m.volume : 0), 0);

  const hasTrainData = trainDetails.length > 0 && totalTrainPermeate > 0;
  const hasProductData = meterDetails.length > 0 && totalProductMeter > 0;

  const deltaVariance = totalTrainPermeate - totalProductMeter;

  let variancePct: number | null = null;
  if (hasProductData && totalProductMeter > 0) {
    variancePct = (Math.abs(deltaVariance) / totalProductMeter) * 100;
  } else if (hasTrainData && totalTrainPermeate > 0) {
    variancePct = (Math.abs(deltaVariance) / totalTrainPermeate) * 100;
  }

  const status = classifyReconciliationVariance(variancePct);

  return {
    totalTrainPermeate,
    totalProductMeter,
    deltaVariance,
    variancePct,
    status,
    trainDetails,
    meterDetails,
    hasTrainData,
    hasProductData,
  };
}

/**
 * Computes the complete plant water balance conservation and node attribution.
 */
export function computePlantWaterBalanceSummary({
  wellVolumes,
  trainPermeateDetails,
  productMeterDetails,
  locatorVolumes,
  blendingVolume,
  permeateIsProduction,
  bothSourcesAdded = false,
}: {
  wellVolumes: { wellId: string; volume: number }[];
  trainPermeateDetails: TrainPermeateDetail[];
  productMeterDetails: ProductMeterDetail[];
  locatorVolumes: { locatorId: string; volume: number }[];
  blendingVolume: number;
  permeateIsProduction: boolean;
  /**
   * True when the plant's "Production volume source" is configured as
   * 'both' (product meter + permeate) — a DEDICATED product meter and the
   * RO permeate are two genuinely independent water sources (e.g. this
   * plant's own RO output plus bulk water purchased from an outside
   * supplier, metered on arrival). Reconciled production is then the SUM
   * of both streams rather than a pick-one, matching the "Two independent
   * sources — totals are added together" promise on the Plant Config page.
   * Takes precedence over `permeateIsProduction` (which the config page
   * also sets true for 'both', purely so the permeate cut-off-time panel
   * — irrelevant here — shows for both 'permeate' and 'both' modes).
   */
  bothSourcesAdded?: boolean;
}): PlantWaterBalanceSummary {
  const nodeVolumes: Record<string, number> = {};

  // 1. Raw Water
  let rawWaterIn = 0;
  wellVolumes.forEach(({ wellId, volume }) => {
    const v = Math.max(0, volume || 0);
    rawWaterIn += v;
    nodeVolumes[wellId] = (nodeVolumes[wellId] || 0) + v;
  });

  // 2. Permeate Reconciliation
  const reconciliation = computePermeateReconciliation(trainPermeateDetails, productMeterDetails);

  trainPermeateDetails.forEach(({ trainId, volume }) => {
    const v = Math.max(0, volume || 0);
    nodeVolumes[trainId] = (nodeVolumes[trainId] || 0) + v;
  });

  productMeterDetails.forEach(({ meterId, volume }) => {
    const v = Math.max(0, volume || 0);
    nodeVolumes[meterId] = (nodeVolumes[meterId] || 0) + v;
  });

  // 3. Reconciled Production
  // 'both' mode: product meter and permeate are independent sources — ADD them.
  // Otherwise: permeate_is_production enabled -> take RO trains; disabled -> bulk product meters.
  const roPermeate = reconciliation.totalTrainPermeate;
  const productMetered = reconciliation.totalProductMeter;
  const reconciledProduction = bothSourcesAdded
    ? roPermeate + productMetered
    : permeateIsProduction
    ? roPermeate
    : productMetered;

  // 4. Distribution & Consumption
  const blending = Math.max(0, blendingVolume || 0);
  const distributionInput = reconciledProduction + blending;

  let locatorConsumption = 0;
  locatorVolumes.forEach(({ locatorId, volume }) => {
    const v = Math.max(0, volume || 0);
    locatorConsumption += v;
    nodeVolumes[locatorId] = (nodeVolumes[locatorId] || 0) + v;
  });

  // 5. Non-Revenue Water (NRW)
  const nrwVolume = Math.max(0, distributionInput - locatorConsumption);
  const nrwPct = distributionInput > 0 ? (nrwVolume / distributionInput) * 100 : null;

  const hasAnyData =
    rawWaterIn > 0 ||
    roPermeate > 0 ||
    productMetered > 0 ||
    blending > 0 ||
    locatorConsumption > 0;

  return {
    hasAnyData,
    rawWaterIn,
    roPermeate,
    productMetered,
    reconciledProduction,
    blending,
    distributionInput,
    locatorConsumption,
    nrwVolume,
    nrwPct,
    reconciliation,
    nodeVolumes,
  };
}
