import { useMemo } from 'react';
import { format } from 'date-fns';
import { getIsoWeekStart } from '../TrendChartAggregate';

export function usePlantHealthData(p: Record<string, any>) {
  const { hasPlantHealth, roReadings, _roTrainIdsForReadings, roTrainNames } = p;

  const phTotalTrains = (_roTrainIdsForReadings ?? []).length;

  function buildPhHealthRows(
    readings: any[],
    slotKeyFn: (d: Date) => string,
    labelFn:   (d: Date) => string,
  ) {
    if (!phTotalTrains) return [] as {
      date: string; healthPct: number | null;
      onlineCount: number | null; offlineCount: number | null;
      totalTrains: number; offlineTrains: string[];
    }[];
    const acc = new Map<string, { trains: Set<string>; ts: number }>();
    readings.forEach((r: any) => {
      if (!r.train_id) return;
      const dt  = new Date(r.reading_datetime);
      const key = slotKeyFn(dt);
      if (!acc.has(key)) acc.set(key, { trains: new Set(), ts: dt.getTime() });
      acc.get(key)!.trains.add(r.train_id);
    });
    const allTrainIds  = new Set<string>(_roTrainIdsForReadings ?? []);
    const trainLabel   = (id: string) =>
      roTrainNames?.get(id) ?? `Train ${String(id).slice(-4)}`;

    return Array.from(acc.entries())
      .sort((a, b) => a[1].ts - b[1].ts)
      .map(([key, { trains, ts }]) => {
        const onlineCount  = trains.size;
        const totalTrains  = phTotalTrains;
        const offlineCount = Math.max(0, totalTrains - onlineCount);
        const healthPct    = totalTrains > 0
          ? Math.round((onlineCount / totalTrains) * 100) : null;
        const offlineTrains = Array.from<string>(allTrainIds)
          .filter(id => !trains.has(id))
          .map(trainLabel);
        const dt = new Date(ts);
        return {
          date: labelFn(dt),
          healthPct,
          onlineCount,
          offlineCount,
          totalTrains,
          offlineTrains,
          _slotKey: key,
        };
      });
  }

  const phDailyData = useMemo(() => {
    if (!hasPlantHealth) return [];
    return buildPhHealthRows(
      roReadings ?? [],
      (d) => format(d, 'yyyy-MM-dd'),
      (d) => format(d, 'MMM d'),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPlantHealth, roReadings, _roTrainIdsForReadings, roTrainNames, phTotalTrains]);

  const phHourlyData = useMemo(() => {
    if (!hasPlantHealth) return [];
    return buildPhHealthRows(
      roReadings ?? [],
      (d) => format(d, 'yyyy-MM-dd HH'),
      (d) => format(d, 'MMM d, haaa'),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPlantHealth, roReadings, _roTrainIdsForReadings, roTrainNames, phTotalTrains]);

  const phMonthlyData = useMemo(() => {
    if (!hasPlantHealth || !phTotalTrains) return [];
    const dayAcc = new Map<string, Set<string>>();
    (roReadings ?? []).forEach((r: any) => {
      if (!r.train_id) return;
      const dk = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
      if (!dayAcc.has(dk)) dayAcc.set(dk, new Set());
      dayAcc.get(dk)!.add(r.train_id);
    });
    const monthAcc = new Map<string, { sumPct: number; count: number; ts: number }>();
    dayAcc.forEach((trains, dk) => {
      const mk  = dk.slice(0, 7);
      const pct = (trains.size / phTotalTrains) * 100;
      const ts  = new Date(dk + 'T00:00:00').getTime();
      const prev = monthAcc.get(mk) ?? { sumPct: 0, count: 0, ts };
      monthAcc.set(mk, { sumPct: prev.sumPct + pct, count: prev.count + 1, ts: prev.ts });
    });
    return Array.from(monthAcc.entries())
      .sort((a, b) => a[1].ts - b[1].ts)
      .map(([, { sumPct, count, ts }]) => ({
        date:         format(new Date(ts), 'MMM yyyy'),
        healthPct:    Math.round(sumPct / count),
        onlineCount:  null as number | null,
        offlineCount: null as number | null,
        totalTrains:  phTotalTrains,
        offlineTrains: [] as string[],
        _slotKey:     '',
      }));
  }, [hasPlantHealth, roReadings, phTotalTrains]);

  const phWeeklyData = useMemo(() => {
    if (!hasPlantHealth || !phTotalTrains) return [];
    const dayAcc = new Map<string, Set<string>>();
    (roReadings ?? []).forEach((r: any) => {
      if (!r.train_id) return;
      const dk = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
      if (!dayAcc.has(dk)) dayAcc.set(dk, new Set());
      dayAcc.get(dk)!.add(r.train_id);
    });
    const weekAcc = new Map<string, { sumPct: number; count: number; ts: number; label: string }>();
    dayAcc.forEach((trains, dk) => {
      const dayDate = new Date(dk + 'T00:00:00');
      const weekStart = getIsoWeekStart(dayDate);
      const wk = format(weekStart, 'yyyy-MM-dd');
      const pct = (trains.size / phTotalTrains) * 100;
      const prev = weekAcc.get(wk) ?? { sumPct: 0, count: 0, ts: weekStart.getTime(), label: `Wk of ${format(weekStart, 'MMM d')}` };
      weekAcc.set(wk, { sumPct: prev.sumPct + pct, count: prev.count + 1, ts: prev.ts, label: prev.label });
    });
    return Array.from(weekAcc.values())
      .sort((a, b) => a.ts - b.ts)
      .map(({ sumPct, count, label }) => ({
        date:         label,
        healthPct:    Math.round(sumPct / count),
        onlineCount:  null as number | null,
        offlineCount: null as number | null,
        totalTrains:  phTotalTrains,
        offlineTrains: [] as string[],
        _slotKey:     '',
      }));
  }, [hasPlantHealth, roReadings, phTotalTrains]);

  const phFocusedHourlyData = p.phDayFocus
    ? phHourlyData.filter((r: any) => typeof r._slotKey === 'string' && r._slotKey.startsWith(p.phDayFocus))
    : phHourlyData;

  const phActiveData = hasPlantHealth
    ? p.phDrillMode === 'hourly'  ? phFocusedHourlyData
    : p.phDrillMode === 'weekly' ? phWeeklyData
    : p.phDrillMode === 'monthly' ? phMonthlyData
    : phDailyData
    : [];

  const handlePhDayDotActivate = (payload: Record<string, unknown> | undefined) => {
    const key = payload?._slotKey as string | undefined;
    if (!key) return;
    p.setPhDayFocus(key);
    p.setPhDrillMode('hourly');
  };

  return {
    phTotalTrains,
    phDailyData, phHourlyData, phMonthlyData, phWeeklyData,
    phFocusedHourlyData, phActiveData, handlePhDayDotActivate,
  };
}
