/**
 * useAlertsData — P3-7 of docs/NAV-IA-REMEDIATION-PLAN.md
 *
 * Everything `useDashboardAlerts` needs, derived anywhere in the app.
 *
 * Before this, the alarm computation only ran while `pages/Dashboard.tsx` was
 * mounted, so a cold open on /operations (or any other route) showed "All plant
 * systems and sensors operating normally" — a lie, because nothing had been
 * evaluated yet. `<AlertsRuntime />` now owns that computation at the app-shell
 * level.
 *
 * The three domain hooks below are also called by Dashboard.tsx with identical
 * arguments, so React Query dedupes them by key: when Dashboard is mounted
 * there is no extra network traffic, and on every other route these are the
 * only queries that run.
 */
import { useMemo, useCallback } from 'react';
import { format, subDays } from 'date-fns';
import { usePlantStore } from '@/store/plantStore';
import { useAlertStore } from '@/store/alertStore';
import { useVisiblePlants } from '@/hooks/useVisiblePlants';
import { useProductionStats, useQualityStats, usePowerStats, useDashboardAlerts } from '@/pages/Dashboard/hooks';
import { useAlertEvents } from './useAlertEvents';

export function useAlertsData() {
  const selectedPlantId = usePlantStore((s) => s.selectedPlantId);
  const addAlerts = useAlertStore((s) => s.addAlerts);
  const clearConditionAlerts = useAlertStore((s) => s.clearConditionAlerts);
  const serverStatusByKey = useAlertStore((s) => s.serverStatusByKey);
  const plantAlerts = useAlertStore((s) => s.plantAlerts);

  // P5-1 (D5): the same visibility rule as the TopBar, Alerts page, Plants
  // page and Dashboard. The alarm set is computed only for plants the user
  // may see, narrowed further by the global plant picker.
  const { plants: visiblePlants } = useVisiblePlants();

  const scopedPlants = useMemo(
    () => (selectedPlantId ? visiblePlants.filter((p) => p.id === selectedPlantId) : visiblePlants),
    [visiblePlants, selectedPlantId],
  );
  const plantIds = scopedPlants.map((p) => p.id);
  const plantIdsKey = plantIds.join(',');
  const { record: recordAlertEvent } = useAlertEvents(plantIds);

  const handleClearConditionAlerts = useCallback((ids: string[]) => {
    // D2: When a condition clears, if an alert had an acknowledged, resolved,
    // or snoozed status on the server, append a 'reopened' event so the server
    // status resets to 'active' and future recurrences are not suppressed.
    const byId = new Map(plantAlerts.map((a) => [a.id, a]));
    ids.forEach((id) => {
      const currentServerStatus = serverStatusByKey[id];
      if (currentServerStatus && currentServerStatus !== 'active') {
        const alert = byId.get(id);
        void recordAlertEvent({
          alertKey: id,
          action: 'reopened',
          plantId: alert?.plantId ?? null,
        });
      }
    });
    clearConditionAlerts(ids);
  }, [clearConditionAlerts, serverStatusByKey, plantAlerts, recordAlertEvent]);

  // Same UTC-safe day boundaries as Dashboard.tsx (Bug 4 fix there): build
  // YYYY-MM-DD from the LOCAL calendar date, then read it as UTC midnight, so
  // a reading logged at 08:00 PHT is not pushed into yesterday.
  const _localDateStr = format(new Date(), 'yyyy-MM-dd');
  const _yesterdayKey = format(subDays(new Date(), 1), 'yyyy-MM-dd');
  const today = new Date(_localDateStr + 'T00:00:00').toISOString();
  const yesterday = new Date(format(subDays(new Date(), 1), 'yyyy-MM-dd') + 'T00:00:00').toISOString();

  const prodStats = useProductionStats({
    plantIds,
    today,
    yesterday,
    _localDateStr,
    _yesterdayKey,
  });

  const qualityStats = useQualityStats({
    plantIds,
    plants: scopedPlants,
    todayWells: prodStats.todayWells,
  });

  const powerStats = usePowerStats({
    plantIds,
    today,
    yesterday,
    production: prodStats.production,
  });

  useDashboardAlerts({
    selectedPlantId,
    addAlerts,
    clearConditionAlerts: handleClearConditionAlerts,
    plants: scopedPlants,
    plantIds,
    latestRO: qualityStats.latestRO,
    roAvgFlowByTrain: qualityStats.roAvgFlowByTrain,
    recentPretreatment: qualityStats.recentPretreatment,
    latestPumpReadings: qualityStats.latestPumpReadings,
    powerAvgByPlant: powerStats.powerAvgByPlant,
    prevPowerRowByPlant: powerStats.prevPowerRowByPlant,
    todayPower: powerStats.todayPower,
    powerIsStale: powerStats.powerIsStale,
    nrw: prodStats.nrw,
    nrwBreached: prodStats.nrwBreached,
    qualityTrainMeta2: qualityStats.qualityTrainMeta2,
  });

  return { plantIds, plantIdsKey };
}
