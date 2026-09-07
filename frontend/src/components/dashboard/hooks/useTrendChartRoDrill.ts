import { useMemo } from 'react';
import { format } from 'date-fns';
import { DRILL_COLORS } from '../TrendChartLegend';
import { buildEntityPivotRows } from '../TrendChartAggregate';
import { toggleIsolateEntity } from '../TrendChartDrillKit';

export function useRoDrillData(p: Record<string, any>) {
  const {
    hasRoDrill, roDrillMode, roReadings, selectedTrainIds,
    metric, viewGran, startKey, endKey,
    _roTrainIdsForReadings, roTrainNames,
    setSelectedTrainIds, trainSearch,
  } = p;

  const valueKey = metric === 'tds' ? 'permeate_tds' : 'recovery_pct';
  const roUnit   = metric === 'tds' ? 'ppm' : '%';

  const roTrainEntities = useMemo<{ id: string; label: string; color: string }[]>(() => {
    if (!hasRoDrill) return [];
    const ids = Array.from(new Set((roReadings ?? []).map((r: any) => r.train_id).filter(Boolean)));
    return ids
      .map((id: string, i) => ({
        id,
        label: roTrainNames?.get(id) ?? `Train ${String(id).slice(-4)}`,
        color: DRILL_COLORS[i % DRILL_COLORS.length],
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [hasRoDrill, roReadings, roTrainNames]);

  const visibleTrainEntities = useMemo(
    () => selectedTrainIds === null
      ? roTrainEntities
      : roTrainEntities.filter((e) => selectedTrainIds.has(e.id)),
    [roTrainEntities, selectedTrainIds],
  );

  const filteredTrainList = useMemo(
    () => trainSearch.trim() === ''
      ? roTrainEntities
      : roTrainEntities.filter((e) =>
          e.label.toLowerCase().includes(trainSearch.trim().toLowerCase()),
        ),
    [roTrainEntities, trainSearch],
  );

  const allTrainsSelected = selectedTrainIds === null || selectedTrainIds.size === roTrainEntities.length;
  const noTrainsSelected  = selectedTrainIds !== null && selectedTrainIds.size === 0;

  function toggleTrain(id: string) {
    setSelectedTrainIds((prev: any) => {
      const current = prev ?? new Set(roTrainEntities.map((e: any) => e.id));
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next.size === roTrainEntities.length ? null : next;
    });
  }
  function selectAllTrains() { setSelectedTrainIds(null); }
  function clearAllTrains()  { setSelectedTrainIds(new Set()); }

  const handleTrainLegendIsolate = (e: any) => {
    const id = e?.dataKey as string | undefined;
    if (!id) return;
    setSelectedTrainIds((prev: any) => toggleIsolateEntity(prev, id, roTrainEntities.map((x: any) => x.id)));
  };

  const roTrainDrillData = useMemo(() => {
    if (!hasRoDrill || roDrillMode !== 'by-train') return [];
    const readings = (roReadings ?? []).filter((r: any) => {
      if (!r.train_id) return false;
      return selectedTrainIds === null || selectedTrainIds.has(r.train_id);
    });
    const acc = new Map<string, Map<string, { sum: number; count: number }>>();
    readings.forEach((r: any) => {
      const val = r[valueKey];
      if (val == null) return;
      const dk = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
      if (!acc.has(dk)) acc.set(dk, new Map());
      const trainAcc = acc.get(dk)!;
      const tid = r.train_id;
      const prev = trainAcc.get(tid) ?? { sum: 0, count: 0 };
      trainAcc.set(tid, { sum: prev.sum + +val, count: prev.count + 1 });
    });
    const dateKeys = Array.from(acc.keys()).sort();
    if (dateKeys.length === 0) return [];

    const avgPivot = new Map<string, Map<string, number>>();
    const weightPivot = new Map<string, Map<string, number>>();
    acc.forEach((trainAcc, dk) => {
      const avgRow = new Map<string, number>();
      const wRow = new Map<string, number>();
      trainAcc.forEach(({ sum, count }, tid) => {
        avgRow.set(tid, +(sum / count).toFixed(metric === 'tds' ? 0 : 1));
        wRow.set(tid, count);
      });
      avgPivot.set(dk, avgRow);
      weightPivot.set(dk, wRow);
    });

    return buildEntityPivotRows(
      avgPivot, dateKeys, visibleTrainEntities, viewGran, startKey, endKey,
      { mode: 'weighted-avg', weightPivot },
    );
  }, [hasRoDrill, roDrillMode, roReadings, visibleTrainEntities, selectedTrainIds, valueKey, metric, viewGran, startKey, endKey]);

  const roHourDrillData = useMemo(() => {
    if (!hasRoDrill || roDrillMode !== 'by-hour') return [];

    const readings = (roReadings ?? []).filter((r: any) => {
      if (selectedTrainIds !== null && r.train_id && !selectedTrainIds.has(r.train_id)) return false;
      return r[valueKey] != null;
    });

    const acc = new Map<string, { sum: number; count: number; ts: number }>();
    readings.forEach((r: any) => {
      const dt = new Date(r.reading_datetime);
      const slotKey = format(dt, 'yyyy-MM-dd HH');
      const slotTs = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), dt.getHours(), 0, 0, 0).getTime();
      const prev = acc.get(slotKey) ?? { sum: 0, count: 0, ts: slotTs };
      acc.set(slotKey, { sum: prev.sum + +r[valueKey], count: prev.count + 1, ts: prev.ts });
    });

    const dec = metric === 'tds' ? 0 : 1;

    return Array.from(acc.entries())
      .sort((a, b) => a[1].ts - b[1].ts)
      .map(([, { sum, count, ts }]) => {
        const dt = new Date(ts);
        return {
          label: format(dt, 'MMM d, haaa').replace('am', 'am').replace('pm', 'pm'),
          value: +(sum / count).toFixed(dec),
        };
      });
  }, [hasRoDrill, roDrillMode, roReadings, selectedTrainIds, valueKey, metric]);

  return {
    valueKey, roUnit,
    roTrainEntities, visibleTrainEntities, filteredTrainList,
    allTrainsSelected, noTrainsSelected,
    toggleTrain, selectAllTrains, clearAllTrains, handleTrainLegendIsolate,
    roTrainDrillData, roHourDrillData,
  };
}
