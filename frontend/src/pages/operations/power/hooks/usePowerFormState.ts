import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePlants } from '@/hooks/usePlants';
import { useIsMobile } from '@/hooks/use-mobile';
import { format } from 'date-fns';
import { ALERTS } from '@/lib/calculations';
import { computeRollingAverageRateFromDeltas, classifyDeviation, type VolumePoint } from '@/lib/flowRateGuards';

export function usePowerFormState() {
  const qc = useQueryClient();
  const { user, isAdmin, isManager, isDataAnalyst } = useAuth();
  const { data: plants } = usePlants();
  const isMobile = useIsMobile();

  const [plantId, setPlantId] = useState('');
  const [reading, setReading] = useState('');
  const [solarReading, setSolarReading] = useState('');
  const [dt, setDt] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [powerHistoryOpen, setPowerHistoryOpen] = useState<{ type: 'solar'; idx: number } | { type: 'grid'; idx: number } | null>(null);
  const [replaceMeterIdx, setReplaceMeterIdx] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [multiplierInput, setMultiplierInput] = useState('');
  const [gridMeterReadings, setGridMeterReadings] = useState<string[]>(['', '', '', '', '']);
  const [solarMeterReadings, setSolarMeterReadings] = useState<string[]>(['', '', '', '', '']);
  const [solarInputMode, setSolarInputMode] = useState<'raw' | 'direct'>('raw');
  const [powerAnomaly, setPowerAnomaly] = useState<{
    result: ReturnType<typeof classifyDeviation>;
    kind: 'grid' | 'solar';
    idx: number;
  } | null>(null);
  const [anomalyRemark, setAnomalyRemark] = useState('');
  const [gapDialogOpen, setGapDialogOpen] = useState(false);
  const [gapSaving, setGapSaving] = useState(false);
  const [savingMeter, setSavingMeter] = useState<string | null>(null);

  const setGridMeterReading = (idx: number, val: string) =>
    setGridMeterReadings(prev => { const next = [...prev]; next[idx] = val; return next; });
  const setSolarMeterReading = (idx: number, val: string) =>
    setSolarMeterReadings(prev => { const next = [...prev]; next[idx] = val; return next; });

  const todayDateStr = format(new Date(), 'yyyy-MM-dd');

  const { data: powerConfig, isLoading: configLoading } = useQuery({
    queryKey: ['plant-power-config', plantId],
    queryFn: async () => {
      if (!plantId) return null;
      try {
        const { data, error } = await (supabase.from('plant_power_config' as any) as any)
          .select('solar_meter_count, solar_meter_names, grid_meter_count, grid_meter_names, grid_meter_multipliers')
          .eq('plant_id', plantId).maybeSingle();
        if (!error && data) return data as any;
      } catch { /* table may not exist */ }
      try {
        const raw = localStorage.getItem(`power_config_${plantId}`);
        if (raw) return JSON.parse(raw);
      } catch { /* ignore */ }
      return null;
    },
    enabled: !!plantId,
  });

  const { data: meterConfig } = useQuery({
    queryKey: ['plant-meter-config', plantId],
    queryFn: async () => {
      if (!plantId) return null;
      try {
        const { data, error } = await (supabase.from('plant_meter_config' as any) as any)
          .select('config').eq('plant_id', plantId).maybeSingle();
        if (!error && data?.config) return data.config as any;
      } catch { /* table may not exist */ }
      try {
        const raw = localStorage.getItem(`plant_meter_config_${plantId}`);
        if (raw) return JSON.parse(raw);
      } catch { /* ignore */ }
      return null;
    },
    enabled: !!plantId,
  });

  useEffect(() => {
    const mode = meterConfig?.default_solar_input_mode;
    if (mode === 'direct' || mode === 'raw') setSolarInputMode(mode);
    else setSolarInputMode('raw');
  }, [plantId, meterConfig?.default_solar_input_mode]);

  const plant = useMemo(() => plants?.find((p) => p.id === plantId), [plants, plantId]);
  const showSolar = !!plant?.has_solar;
  const showGrid = plant?.has_grid !== false;

  const solarMeterCount = (powerConfig?.solar_meter_count as number) ?? 1;
  const gridMeterCount = (powerConfig?.grid_meter_count as number) ?? 1;
  const solarMeterNames: string[] = powerConfig?.solar_meter_names ?? [];
  const gridMeterNames: string[] = powerConfig?.grid_meter_names ?? [];

  const getSolarLabel = (idx: number) => solarMeterNames[idx] ?? (solarMeterCount === 1 ? 'Solar Power Reading' : `Solar Meter ${idx + 1}`);
  const getGridLabel = (idx: number) => gridMeterNames[idx] ?? (gridMeterCount === 1 ? 'Grid Power Reading' : `Grid Meter ${idx + 1}`);

  const powerMeterItems = useMemo<Array<{ type: 'grid' | 'solar'; idx: number }>>(() => {
    const items: Array<{ type: 'grid' | 'solar'; idx: number }> = [];
    for (let i = 0; i < gridMeterCount; i++) items.push({ type: 'grid', idx: i });
    if (showSolar) for (let i = 0; i < solarMeterCount; i++) items.push({ type: 'solar', idx: i });
    return items;
  }, [gridMeterCount, solarMeterCount, showSolar]);

  const configMultiplierArr = powerConfig?.grid_meter_multipliers;

  const getGridMeterMult = (idx: number): number =>
    Array.isArray(configMultiplierArr) && +configMultiplierArr[idx] > 0
      ? +configMultiplierArr[idx]
      : 1;

  const configMultiplier: number | null =
    Array.isArray(configMultiplierArr) && configMultiplierArr.length > 0 && +configMultiplierArr[0] > 0
      ? +configMultiplierArr[0]
      : null;

  const canEditMultiplier = (isAdmin || isManager || isDataAnalyst) && !!plantId && !configLoading;
  const effectiveMultiplier = configMultiplier ?? (+multiplierInput || 1);

  const { data: history } = useQuery({
    queryKey: ['op-power', plantId],
    queryFn: async () => {
      if (!plantId) return [] as any[];
      const { data, error } = await supabase
        .from('power_readings')
        .select('id,plant_id,reading_datetime,meter_reading_kwh,grid_meter_readings,daily_consumption_kwh,daily_solar_kwh,daily_grid_kwh,solar_meter_reading,is_meter_replacement,is_estimated,recorded_by')
        .eq('plant_id', plantId)
        .order('reading_datetime', { ascending: false })
        .limit(8);
      if (!error && data) return data as any[];
      const { data: fallback, error: fallbackErr } = await supabase
        .from('power_readings')
        .select('id,plant_id,reading_datetime,meter_reading_kwh,daily_consumption_kwh,is_meter_replacement,is_estimated,recorded_by')
        .eq('plant_id', plantId)
        .order('reading_datetime', { ascending: false })
        .limit(8);
      if (!fallbackErr && fallback) return fallback as any[];
      const { data: minimal } = await supabase
        .from('power_readings')
        .select('id,plant_id,reading_datetime,meter_reading_kwh')
        .eq('plant_id', plantId)
        .order('reading_datetime', { ascending: false })
        .limit(8);
      return (minimal ?? []) as any[];
    },
    enabled: !!plantId,
    staleTime: 120_000,
    refetchInterval: 120_000,
  });

  const { data: powerHistory14d } = useQuery({
    queryKey: ['op-power-history-14d', plantId],
    queryFn: async () => {
      if (!plantId) return [] as any[];
      const since = new Date();
      since.setDate(since.getDate() - 14);
      const { data } = await supabase
        .from('power_readings')
        .select('reading_datetime,daily_consumption_kwh')
        .eq('plant_id', plantId)
        .gte('reading_datetime', since.toISOString())
        .not('daily_consumption_kwh', 'is', null);
      return data ?? [];
    },
    enabled: !!plantId,
    staleTime: 5 * 60_000,
  });

  const avgPowerRate = useMemo(() => {
    const points: VolumePoint[] = (powerHistory14d ?? [])
      .filter((r: any) => Number(r.daily_consumption_kwh) > 0)
      .map((r: any) => ({ volume: Number(r.daily_consumption_kwh), at: new Date(r.reading_datetime) }));
    return computeRollingAverageRateFromDeltas(points, 14);
  }, [powerHistory14d]);

  const { data: gapReasonToday } = useQuery({
    queryKey: ['power-gap-reason-for-date', plantId, todayDateStr],
    enabled: !!plantId,
    queryFn: async () => {
      const { data } = await (supabase.from('reading_gap_reasons' as any) as any)
        .select('reason_category, reason_detail')
        .eq('entity_type', 'power')
        .eq('entity_id', plantId)
        .eq('gap_date', todayDateStr)
        .maybeSingle();
      return data as { reason_category: string; reason_detail: string | null } | null;
    },
  });

  const prevRow = useMemo(() => history?.find((r: any) => r.id !== editingId) ?? null, [history, editingId]);
  const prevGrid = prevRow?.meter_reading_kwh ?? null;
  const prevSolar = prevRow?.solar_meter_reading ?? null;

  const getLatestGridReading = useCallback((meterIdx: number): number | null => {
    if (!history || history.length === 0) return null;
    for (const r of history) {
      if (r.id === editingId) continue;
      const gmr = r.grid_meter_readings as Record<string, number> | null | undefined;
      const val = gmr?.[String(meterIdx)] ?? (meterIdx === 0 ? r.meter_reading_kwh : null);
      if (val != null && !isNaN(Number(val))) return Number(val);
    }
    return null;
  }, [history, editingId]);

  useEffect(() => {
    if (!prevRow) return;
    setGridMeterReadings(curr =>
      curr.map((val, idx) => {
        if (val !== '') return val;
        const prevVal = getLatestGridReading(idx);
        return prevVal != null ? prevVal.toFixed(2) : val;
      }),
    );
    setReading(r => {
      if (r !== '') return r;
      const prevVal0 = getLatestGridReading(0);
      return prevVal0 != null ? prevVal0.toFixed(2) : r;
    });
  }, [prevRow?.id, getLatestGridReading]);

  useEffect(() => {
    if (!prevRow || solarInputMode !== 'raw') return;
    setSolarMeterReadings(curr =>
      curr.map((val, idx) => {
        if (val !== '') return val;
        if (idx === 0 && prevSolar != null) return prevSolar.toFixed(2);
        return val;
      }),
    );
    setSolarReading(r => {
      if (r !== '') return r;
      return prevSolar != null ? prevSolar.toFixed(2) : r;
    });
  }, [prevRow?.id, solarInputMode, prevSolar]);

  const deltaGrid = prevGrid != null && reading ? +reading - prevGrid : null;
  const deltaSolar = solarInputMode === 'direct'
    ? (solarReading ? +solarReading : null)
    : (prevSolar != null && solarReading ? +solarReading - prevSolar : null);
  const daily = showSolar ? deltaGrid : (prevGrid != null && reading ? +reading - prevGrid : null);
  const dailyEffective = daily != null ? daily * effectiveMultiplier : null;

  return {
    plantId, setPlantId,
    reading, setReading,
    solarReading, setSolarReading,
    dt, setDt,
    editingId, setEditingId,
    powerHistoryOpen, setPowerHistoryOpen,
    replaceMeterIdx, setReplaceMeterIdx,
    importOpen, setImportOpen,
    multiplierInput, setMultiplierInput,
    gridMeterReadings, setGridMeterReadings,
    solarMeterReadings, setSolarMeterReadings,
    solarInputMode, setSolarInputMode,
    powerAnomaly, setPowerAnomaly,
    anomalyRemark, setAnomalyRemark,
    gapDialogOpen, setGapDialogOpen,
    gapSaving, setGapSaving,
    savingMeter, setSavingMeter,
    setGridMeterReading,
    setSolarMeterReading,
    plants, powerConfig, configLoading, meterConfig,
    history, powerHistory14d, avgPowerRate,
    gapReasonToday, todayDateStr,
    plant, showSolar, showGrid,
    solarMeterCount, gridMeterCount,
    solarMeterNames, gridMeterNames,
    getSolarLabel, getGridLabel,
    powerMeterItems,
    configMultiplierArr, getGridMeterMult, configMultiplier,
    canEditMultiplier, effectiveMultiplier,
    deltaGrid, deltaSolar, daily, dailyEffective,
    prevGrid, prevSolar, prevRow,
    getLatestGridReading,
    isMobile,
    isAdmin, isManager, isDataAnalyst,
    user,
    qc,
  };
}
