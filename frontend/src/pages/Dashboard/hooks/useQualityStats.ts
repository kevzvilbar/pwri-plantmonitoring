import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { subDays } from 'date-fns';
import { computeROAverageFlowRate, type ROMeterKind } from '@/lib/roReadingGuards';

export interface UseQualityStatsParams {
  plantIds: string[];
  plants: { id: string; code?: string | null; name?: string | null }[] | undefined;
  todayWells?: any[];
}

export function useQualityStats({
  plantIds,
  plants,
  todayWells = [],
}: UseQualityStatsParams) {
  const { data: _qualityTrainMeta } = useQuery({
    queryKey: ['dash-quality-train-meta', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return { ids: [] as string[], metaMap: new Map<string, { plant_id: string; train_number: number | null; train_name: string | null; well_id: string | null; unit_type: string | null }>() };
      const { data, error } = await supabase
        .from('ro_trains')
        .select('id, plant_id, train_number, name, well_id, unit_type')
        .in('plant_id', plantIds);
      if (error) throw error;
      const rows = data ?? [];
      const metaMap = new Map<string, { plant_id: string; train_number: number | null; train_name: string | null; well_id: string | null; unit_type: string | null }>();
      rows.forEach((t) => metaMap.set(t.id, {
        plant_id:     t.plant_id,
        train_number: t.train_number ?? null,
        train_name:   t.name ?? null,
        well_id:      t.well_id ?? null,
        unit_type:    t.unit_type ?? 'primary',
      }));
      return { ids: rows.map((t) => t.id), metaMap };
    },
    enabled: plantIds.length > 0,
    staleTime: 10 * 60_000,
  });
  const qualityTrainIds   = _qualityTrainMeta?.ids    ?? [];
  const qualityTrainMeta2 = _qualityTrainMeta?.metaMap ?? new Map<string, { plant_id: string; train_number: number | null; train_name: string | null; well_id: string | null; unit_type: string | null }>();

  const { data: wellNamesByTrainWell = new Map<string, string>() } = useQuery({
    queryKey: ['dash-well-names-for-trains', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return new Map<string, string>();
      const { data, error } = await supabase.from('wells').select('id, name').in('plant_id', plantIds);
      if (error) throw error;
      const map = new Map<string, string>();
      (data ?? []).forEach((w) => map.set(w.id, w.name));
      return map;
    },
    enabled: plantIds.length > 0,
    staleTime: 10 * 60_000,
  });

  const { data: latestRO = [] } = useQuery({
    queryKey: ['dash-ro-recent', qualityTrainIds],
    queryFn: async () => {
      if (!qualityTrainIds.length) return [];
      const since = subDays(new Date(), 1).toISOString();
      const { data, error } = await supabase
        .from('ro_train_readings')
        .select('id,train_id,permeate_tds,feed_tds,dp_psi,recovery_pct,permeate_ph,turbidity_ntu,reading_datetime,feed_meter_delta,permeate_meter_delta,reject_meter_delta,norm_status')
        .in('train_id', qualityTrainIds)
        .gte('reading_datetime', since)
        .order('reading_datetime', { ascending: false });
      if (error) throw new Error(`ro_train_readings (quality): ${error.message}`);
      return (data ?? []).map((r) => {
        const meta = qualityTrainMeta2.get(r.train_id);
        return {
          ...r,
          plant_id:     meta?.plant_id     ?? null,
          train_number: meta?.train_number ?? null,
          train_name:   meta?.train_name   ?? null,
          well_id:      meta?.well_id      ?? null,
        };
      });
    },
    enabled: qualityTrainIds.length > 0,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  const { data: roHistory10d = [] } = useQuery({
    queryKey: ['dash-ro-history-10d', qualityTrainIds],
    queryFn: async () => {
      if (!qualityTrainIds.length) return [];
      const since = subDays(new Date(), 10).toISOString();
      const { data, error } = await supabase
        .from('ro_train_readings')
        .select('train_id,reading_datetime,feed_meter,permeate_meter,reject_meter')
        .in('train_id', qualityTrainIds)
        .gte('reading_datetime', since)
        .order('reading_datetime', { ascending: true });
      if (error) throw new Error(`ro_train_readings (10d history): ${error.message}`);
      return data ?? [];
    },
    enabled: qualityTrainIds.length > 0,
    staleTime: 15 * 60_000,
  });

  const roAvgFlowByTrain = useMemo(() => {
    const byTrain = new Map<string, any[]>();
    (roHistory10d ?? []).forEach((r) => {
      const key = String(r.train_id ?? 'unknown');
      if (!byTrain.has(key)) byTrain.set(key, []);
      byTrain.get(key)!.push(r);
    });
    const out = new Map<string, Record<ROMeterKind, number | null>>();
    byTrain.forEach((rows, trainId) => {
      const rates: Record<ROMeterKind, number | null> = { feed: null, permeate: null, reject: null };
      (['feed', 'permeate', 'reject'] as ROMeterKind[]).forEach((kind) => {
        const col = `${kind}_meter`;
        const points = rows
          .filter((r: any) => r[col] != null)
          .map((r: any) => ({ value: r[col], at: new Date(r.reading_datetime) }));
        rates[kind] = computeROAverageFlowRate(points, 10);
      });
      out.set(trainId, rates);
    });
    return out;
  }, [roHistory10d]);

  const { data: recentPretreatment = [] } = useQuery({
    queryKey: ['dash-pretreatment-recent', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const since = subDays(new Date(), 2).toISOString();
      const { data, error } = await supabase
        .from('ro_pretreatment_readings')
        .select('id,train_id,plant_id,reading_datetime,afm_units,filter_housings,booster_pumps')
        .in('plant_id', plantIds)
        .gte('reading_datetime', since)
        .order('reading_datetime', { ascending: false });
      if (error) throw new Error(`ro_pretreatment_readings: ${error.message}`);
      return data ?? [];
    },
    enabled: plantIds.length > 0,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  const { data: latestPumpReadings = [] } = useQuery({
    queryKey: ['dash-pump-readings-recent', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const since = subDays(new Date(), 1).toISOString();
      const { data, error } = await supabase
        .from('pump_readings')
        .select('id,train_id,plant_id,pump_type,pump_number,reading_datetime,l1_amp,l2_amp,l3_amp,voltage')
        .in('plant_id', plantIds)
        .gte('reading_datetime', since)
        .order('reading_datetime', { ascending: false });
      if (error) throw new Error(`pump_readings: ${error.message}`);
      const latestByPump = new Map<string, any>();
      (data ?? []).forEach((r) => {
        const key = `${r.train_id}-${r.pump_type}-${r.pump_number}`;
        if (!latestByPump.has(key)) latestByPump.set(key, r);
      });
      return Array.from(latestByPump.values());
    },
    enabled: plantIds.length > 0,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  // ── Aggregates ────────────────────────────────────────────────────────────
  const roByTrain = useMemo(() => {
    const seen = new Set<string>();
    const rows: any[] = [];
    latestRO.forEach((r: any) => {
      const key = `${r.plant_id}__${r.train_number ?? '?'}`;
      if (seen.has(key)) return;
      seen.add(key);
      const wellName = r.well_id ? (wellNamesByTrainWell?.get(r.well_id) ?? null) : null;
      rows.push({ ...r, train_name: wellName ?? r.train_name });
    });
    rows.sort((a, b) => {
      if (a.plant_id !== b.plant_id) return String(a.plant_id).localeCompare(String(b.plant_id));
      return (a.train_number ?? 0) - (b.train_number ?? 0);
    });
    return rows;
  }, [latestRO, wellNamesByTrainWell]);

  const wellsByQuality = useMemo(() => {
    const latestByWell = new Map<string, any>();
    todayWells.forEach((r: any) => {
      if (r.tds_ppm != null || r.turbidity_ntu != null) {
        latestByWell.set(r.well_id as string, r);
      }
    });
    const rows: any[] = [];
    latestByWell.forEach((r) => {
      const wellName = wellNamesByTrainWell?.get(r.well_id as string) ?? null;
      rows.push({
        ...r,
        well_id: r.well_id,
        train_name: wellName ?? `Well ${String(r.well_id).slice(-4)}`,
      });
    });
    rows.sort((a, b) => {
      if (a.plant_id !== b.plant_id) return String(a.plant_id).localeCompare(String(b.plant_id));
      return String(a.train_name).localeCompare(String(b.train_name));
    });
    return rows;
  }, [todayWells, wellNamesByTrainWell]);

  const avgPermTds = roByTrain.length
    ? +(roByTrain.reduce((s, r) => s + (r.permeate_tds ?? 0), 0) / roByTrain.length).toFixed(0)
    : null;
  const avgFeedTds = roByTrain.length
    ? +(roByTrain.reduce((s, r) => s + (r.feed_tds ?? 0), 0) / roByTrain.length).toFixed(0)
    : null;
  const avgRecovery = roByTrain.length
    ? +(roByTrain.reduce((s, r) => s + (r.recovery_pct ?? 0), 0) / roByTrain.length).toFixed(1)
    : null;
  const avgTurb = roByTrain.length
    ? +(roByTrain.reduce((s, r) => s + (r.turbidity_ntu ?? 0), 0) / roByTrain.length).toFixed(2)
    : null;

  const wellsWithTds  = wellsByQuality.filter((r) => r.tds_ppm != null);
  const wellsWithNtu  = wellsByQuality.filter((r) => r.turbidity_ntu != null);
  const avgRawTds = wellsWithTds.length
    ? +(wellsWithTds.reduce((s, r) => s + (r.tds_ppm ?? 0), 0) / wellsWithTds.length).toFixed(0)
    : null;
  const avgRawTurb = wellsWithNtu.length
    ? +(wellsWithNtu.reduce((s, r) => s + (r.turbidity_ntu ?? 0), 0) / wellsWithNtu.length).toFixed(2)
    : null;

  const plantCodeById = useMemo(() => {
    const m = new Map<string, string>();
    (plants ?? []).forEach((p: any) => m.set(p.id, p.code ?? p.name ?? p.id));
    return m;
  }, [plants]);

  return {
    qualityTrainIds,
    qualityTrainMeta2,
    wellNamesByTrainWell,
    latestRO,
    roHistory10d,
    roAvgFlowByTrain,
    recentPretreatment,
    latestPumpReadings,
    // Aggregates
    roByTrain,
    wellsByQuality,
    avgPermTds,
    avgFeedTds,
    avgRecovery,
    avgTurb,
    avgRawTds,
    avgRawTurb,
    plantCodeById,
  };
}
