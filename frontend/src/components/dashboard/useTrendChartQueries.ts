// Split out of TrendChart.tsx as part of file-size and modularity refactoring.
// This coordinator hook combines entity metadata, water readings, and power/cost queries.
import { useTrendEntityMeta } from './trendQueries/useTrendEntityMeta';
import { useTrendWaterQueries } from './trendQueries/useTrendWaterQueries';
import { useTrendPowerCostQueries } from './trendQueries/useTrendPowerCostQueries';

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
  const needsRoReadings = metric === 'recovery' || metric === 'tds' || metric === 'plantHealth' || metric === 'roFlowBalance' || metric === 'chlorine';
  // productionCost also needs power readings (kWh delta × multiplier) and tariffs (₱/kWh).
  const needsPowerReadings = metric === 'pv' || metric === 'productionCost' || metric === 'kwh';
  // production_costs stores chem_cost (₱ per day) — still used for chemical side.
  const needsCostReadings = metric === 'productionCost';
  // needsPermeateProduction: we may need permeate_meter_delta from ro_train_readings
  // as the production source for plants where permeate_is_production = true.
  const needsPermeateProduction = metric === 'production' || metric === 'nrw' || metric === 'pv' || metric === 'productionCost';

  const chartRefetchInterval = false;
  const chartStaleTime = 5 * 60_000;

  const entityMeta = useTrendEntityMeta({
    plantIds,
    needsWellReadings,
    needsLocReadings,
    needsProductMeterReadings,
    needsPowerReadings,
    needsPermeateProduction,
    needsRoReadings,
  });

  const waterQueries = useTrendWaterQueries({
    metric,
    plantIds,
    startISO,
    endISO,
    startKey,
    endKey,
    chartStaleTime,
    chartRefetchInterval,
    needsLocReadings,
    needsProductMeterReadings,
    needsWellReadings,
    needsRoReadings,
    needsPermeateProduction,
    locatorIdsForReadings: entityMeta._locatorIdsForReadings,
    roTrainIdsForReadings: entityMeta._roTrainIdsForReadings,
  });

  const powerCostQueries = useTrendPowerCostQueries({
    metric,
    plantIds,
    startISO,
    startKey,
    endKey,
    chartStaleTime,
    chartRefetchInterval,
    needsPowerReadings,
    needsCostReadings,
  });

  const isFetching =
    waterQueries.fetchingLoc ||
    waterQueries.fetchingWell ||
    waterQueries.fetchingRo ||
    waterQueries.fetchingProduct ||
    powerCostQueries.fetchingPower ||
    powerCostQueries.fetchingCost;

  const queryError = (
    waterQueries.errLoc ||
    waterQueries.errWell ||
    waterQueries.errRo ||
    waterQueries.errProduct ||
    powerCostQueries.errPower ||
    powerCostQueries.errCost
  ) as Error | null;

  const retryFailedQueries = () => {
    if (waterQueries.errLoc) waterQueries.refetchLoc();
    if (waterQueries.errWell) waterQueries.refetchWell();
    if (waterQueries.errRo) waterQueries.refetchRo();
    if (waterQueries.errProduct) waterQueries.refetchProduct();
    if (powerCostQueries.errPower) powerCostQueries.refetchPower();
    if (powerCostQueries.errCost) powerCostQueries.refetchCost();
  };

  return {
    ...entityMeta,
    ...waterQueries,
    ...powerCostQueries,
    isFetching,
    queryError,
    retryFailedQueries,
  };
}
