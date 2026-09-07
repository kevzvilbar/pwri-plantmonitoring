import { useMemo } from 'react';
import { format } from 'date-fns';
import { buildEntityPivot } from '../TrendChartPivotShared';
import { buildEntityPivotRows, getIsoWeekStart } from '../TrendChartAggregate';

export function useEntityRows(p: Record<string, any>) {
  const {
    hasConsumptionDrill, drillMode, prodDrillSource, metric,
    locReadings, productReadings, roReadings,
    usePermeateForSource, visibleEntities,
    _directLocatorIds, _directProductMeterIds,
    viewGran, startKey, endKey, _trainUnitTypeMap,
  } = p;

  const entityRows = useMemo(() => {
    if (!hasConsumptionDrill || drillMode !== 'drilldown') return [];
    const isSource = metric === 'production' && prodDrillSource === 'source';

    let pivot: Map<string, Map<string, number>>;
    let dateKeys: string[];

    if (isSource && usePermeateForSource) {
      const roSorted = [...(roReadings ?? [])].sort(
        (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
      );
      const p2 = new Map<string, Map<string, number>>();
      roSorted.forEach((r: any) => {
        if (r.is_meter_replacement) return;
        if (_trainUnitTypeMap.get(r.train_id) === 'secondary') return;
        const delta = r.permeate_meter_delta != null
          ? Math.max(0, +r.permeate_meter_delta)
          : r.permeate_meter != null && r.permeate_meter_prev != null
            ? Math.max(0, +r.permeate_meter - +r.permeate_meter_prev)
            : null;
        if (delta === null || delta === 0) return;
        const dk = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
        const tid = r.train_id ?? '__';
        if (!p2.has(dk)) p2.set(dk, new Map());
        p2.get(dk)!.set(tid, (p2.get(dk)!.get(tid) ?? 0) + delta);
      });
      pivot = p2;
      dateKeys = Array.from(p2.keys()).sort();
    } else if (isSource) {
      const sorted = [...(productReadings ?? [])].sort(
        (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
      );
      const built = buildEntityPivot(sorted, 'meter_id', _directProductMeterIds);
      pivot = built.pivot; dateKeys = built.dateKeys;
    } else {
      const sorted = [...(locReadings ?? [])].sort(
        (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
      );
      const built = buildEntityPivot(sorted, 'locator_id', _directLocatorIds);
      pivot = built.pivot; dateKeys = built.dateKeys;
    }

    return buildEntityPivotRows(pivot, dateKeys, visibleEntities, viewGran, startKey, endKey);
  }, [
    hasConsumptionDrill, drillMode, prodDrillSource, metric,
    locReadings, productReadings, roReadings,
    usePermeateForSource, visibleEntities,
    _directLocatorIds, _directProductMeterIds,
    viewGran, startKey, endKey, _trainUnitTypeMap,
  ]);

  return { entityRows };
}
