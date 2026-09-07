import { useMemo } from 'react';
import { DRILL_COLORS } from '../TrendChartLegend';
import { type DrillFocus, toggleIsolateEntity } from '../TrendChartDrillKit';
import { buildEntityPivot } from '../TrendChartPivotShared';

export function useTrendChartLocators(p: Record<string, any>) {
  const {
    metric, drillFocus, setDrillFocus, drillMode, range,
    selectedLocatorIds, setSelectedLocatorIds, locatorSearch,
    selectedTrainIds, setSelectedTrainIds, trainSearch,
    selectedWellIds, setSelectedWellIds,
    prodDrillSource, roDrillMode, phDrillMode, setPhDrillMode, phDayFocus, setPhDayFocus,
    viewGran, setViewGran, viewBreakdown, setViewBreakdown, rawwaterBreakdown,
    hasConsumptionDrill, hasRoDrill, hasPlantHealth,
    startKey, endKey,
    trendRows, chartData,
    wellNames, locatorNames, productMeterNames, plantNames, roTrainNames,
    wellReadings, locReadings, productReadings, roReadings,
    _directLocatorIds, _directProductMeterIds, _roTrainIdsForReadings, _trainPlantMap, _trainUnitTypeMap,
  } = p;

  const usePermeateForSource = (metric === 'production')
    && (productReadings ?? []).length === 0
    && (roReadings ?? []).length > 0;

  const drillEntities = useMemo<{ id: string; label: string; color: string }[]>(() => {
    if (!hasConsumptionDrill) return [];
    const ids = Array.from(new Set((locReadings ?? []).map((r: any) => r.locator_id).filter(Boolean)));
    return ids
      .map((id: string, i) => ({
        id,
        label: locatorNames?.get(id) ?? `Locator ${id.slice(-4)}`,
        color: DRILL_COLORS[i % DRILL_COLORS.length],
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [hasConsumptionDrill, locReadings, locatorNames]);

  const sourceDrillEntities = useMemo<{ id: string; label: string; color: string }[]>(() => {
    if (metric !== 'production') return [];
    if (usePermeateForSource) {
      const ids = Array.from(new Set(
        (roReadings ?? [])
          .map((r: any) => r.train_id)
          .filter((id: any) => id && _trainUnitTypeMap.get(id) !== 'secondary'),
      ));
      return ids
        .map((id: string, i) => ({
          id,
          label: roTrainNames?.get(id) ?? `RO Train ${String(id).slice(-4)}`,
          color: DRILL_COLORS[i % DRILL_COLORS.length],
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }
    const ids = Array.from(new Set((productReadings ?? []).map((r: any) => r.meter_id).filter(Boolean)));
    return ids
      .map((id: string, i) => ({
        id,
        label: productMeterNames?.get(id) ?? `Meter ${id.slice(-4)}`,
        color: DRILL_COLORS[i % DRILL_COLORS.length],
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [metric, usePermeateForSource, productReadings, roReadings, productMeterNames, roTrainNames, _trainUnitTypeMap]);

  const activeEntities = metric === 'production' && prodDrillSource === 'source'
    ? sourceDrillEntities : drillEntities;

  const visibleEntities = useMemo(
    () => selectedLocatorIds === null
      ? activeEntities
      : activeEntities.filter((e) => selectedLocatorIds.has(e.id)),
    [activeEntities, selectedLocatorIds],
  );

  const filteredLocatorList = useMemo(
    () => locatorSearch.trim() === ''
      ? activeEntities
      : activeEntities.filter((e) =>
          e.label.toLowerCase().includes(locatorSearch.trim().toLowerCase()),
        ),
    [activeEntities, locatorSearch],
  );

  const allSelected = selectedLocatorIds === null || selectedLocatorIds.size === activeEntities.length;
  const noneSelected = selectedLocatorIds !== null && selectedLocatorIds.size === 0;

  function toggleLocator(id: string) {
    setSelectedLocatorIds((prev: any) => {
      const current = prev ?? new Set(activeEntities.map((e: any) => e.id));
      const next = new Set(current);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next.size === activeEntities.length ? null : next;
    });
  }
  function selectAllLocators() { setSelectedLocatorIds(null); }
  function clearAllLocators() { setSelectedLocatorIds(new Set()); }

  const handleLegendIsolate = (e: any) => {
    const id = e?.dataKey as string | undefined;
    if (!id) return;
    setSelectedLocatorIds((prev: any) => toggleIsolateEntity(prev, id, activeEntities.map((x: any) => x.id)));
  };

  return {
    usePermeateForSource, drillEntities, sourceDrillEntities,
    activeEntities, visibleEntities, filteredLocatorList,
    allSelected, noneSelected,
    toggleLocator, selectAllLocators, clearAllLocators, handleLegendIsolate,
  };
}

export function useLocatorPresets(p: Record<string, any>) {
  const { activeEntities, selectedLocatorIds, setSelectedLocatorIds, locReadings, _directLocatorIds } = p;

  const locatorTotals = useMemo<Map<string, number>>(() => {
    const totals = new Map<string, number>();
    if (!locReadings) return totals;
    const sorted = [...locReadings].sort(
      (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
    );
    const { pivot } = buildEntityPivot(sorted, 'locator_id', _directLocatorIds);
    pivot.forEach((entityMap: any) => {
      entityMap.forEach((val: any, id: any) => {
        totals.set(id, (totals.get(id) ?? 0) + val);
      });
    });
    return totals;
  }, [locReadings, _directLocatorIds]);

  const selectTopNLocators = (n: number) => {
    const sorted = [...activeEntities].sort((a: any, b: any) => (locatorTotals.get(b.id) ?? 0) - (locatorTotals.get(a.id) ?? 0));
    const topIds = sorted.slice(0, n).map((e: any) => e.id);
    setSelectedLocatorIds(new Set(topIds));
  };

  return { locatorTotals, selectTopNLocators };
}
