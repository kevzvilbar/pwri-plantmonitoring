import { useMemo } from 'react';
import { DRILL_COLORS } from '../TrendChartLegend';
import { buildEntityPivot } from '../TrendChartPivotShared';
import { buildEntityPivotRows } from '../TrendChartAggregate';

export function useWellEntities(p: Record<string, any>) {
  const {
    metric, selectedWellIds, setSelectedWellIds,
    wellReadings, wellNames, rawwaterBreakdown,
    startKey, endKey, viewGran,
  } = p;

  const wellSearch = p.wellSearch ?? '';

  const wellEntities = useMemo<{ id: string; label: string; color: string }[]>(() => {
    if (metric !== 'rawwater') return [];
    const ids = Array.from(new Set((wellReadings ?? []).map((r: any) => r.well_id).filter(Boolean)));
    return ids
      .map((id: string, i) => ({
        id,
        label: wellNames?.get(id) ?? `Well ${String(id).slice(-4)}`,
        color: DRILL_COLORS[i % DRILL_COLORS.length],
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [metric, wellReadings, wellNames]);

  const filteredWellList = useMemo(
    () => wellSearch.trim() === ''
      ? wellEntities
      : wellEntities.filter((e) =>
          e.label.toLowerCase().includes(wellSearch.trim().toLowerCase()),
        ),
    [wellEntities, wellSearch],
  );

  const allWellsSelected = selectedWellIds === null || selectedWellIds.size === wellEntities.length;
  const noneWellsSelected = selectedWellIds !== null && selectedWellIds.size === 0;

  function toggleWell(id: string) {
    setSelectedWellIds((prev: any) => {
      const current = prev ?? new Set(wellEntities.map((e: any) => e.id));
      const next = new Set(current);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next.size === wellEntities.length ? null : next;
    });
  }
  function selectAllWells() { setSelectedWellIds(null); }
  function clearAllWells() { setSelectedWellIds(new Set()); }

  const visibleWellEntities = useMemo(
    () => selectedWellIds === null ? wellEntities : wellEntities.filter((e) => selectedWellIds.has(e.id)),
    [wellEntities, selectedWellIds],
  );

  return {
    wellEntities, visibleWellEntities, filteredWellList,
    allWellsSelected, noneWellsSelected,
    toggleWell, selectAllWells, clearAllWells,
  };
}

export function useWellPresets(p: Record<string, any>) {
  const { wellEntities, selectedWellIds, setSelectedWellIds, wellReadings, startKey } = p;

  const wellTotals = useMemo<Map<string, number>>(() => {
    const totals = new Map<string, number>();
    if (!wellReadings) return totals;
    const sorted = [...wellReadings].sort(
      (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
    );
    const { pivot } = buildEntityPivot(sorted, 'well_id', undefined, startKey);
    pivot.forEach((entityMap: any) => {
      entityMap.forEach((val: any, id: any) => {
        totals.set(id, (totals.get(id) ?? 0) + val);
      });
    });
    return totals;
  }, [wellReadings, startKey]);

  const selectTopNWells = (n: number) => {
    const sorted = [...wellEntities].sort((a: any, b: any) => (wellTotals.get(b.id) ?? 0) - (wellTotals.get(a.id) ?? 0));
    const topIds = sorted.slice(0, n).map((e: any) => e.id);
    setSelectedWellIds(new Set(topIds));
  };

  return { wellTotals, selectTopNWells };
}

export function useWellEntityRows(p: Record<string, any>) {
  const { metric, rawwaterBreakdown, wellReadings, visibleWellEntities, viewGran, startKey, endKey } = p;

  const wellEntityRows = useMemo(() => {
    if (metric !== 'rawwater' || rawwaterBreakdown !== 'by-well') return [];
    const sorted = [...(wellReadings ?? [])].sort(
      (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
    );
    const { pivot, dateKeys } = buildEntityPivot(sorted, 'well_id', undefined, startKey);
    return buildEntityPivotRows(pivot, dateKeys, visibleWellEntities, viewGran, startKey, endKey);
  }, [metric, rawwaterBreakdown, wellReadings, visibleWellEntities, viewGran, startKey, endKey]);

  return { wellEntityRows };
}
