import { useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from 'react';
import { deltaCache } from '@/lib/deltaCache';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { fmtIsoDate } from '@/lib/format';
import { calc } from '@/lib/calculations';

export interface HistoryRow { date: string; consumption: number; reading?: number; }
export interface SiblingLocator {
  id: string;
  name: string;
  defaultInputMode?: 'raw' | 'direct';
}

const siblingDataKey = (locatorId: string) => `sib_${locatorId}`;

export function useEntityChartData(
  entityId: string,
  entityType: 'locator' | 'well' | 'product_meter',
  range: '30' | '90' | '180' | 'all',
  defaultInputMode: 'raw' | 'direct',
  siblingLocators: SiblingLocator[] = [],
  isBlendingWell?: boolean,
) {
  const isDirectMode =
    ((entityType === 'locator' || entityType === 'well') && defaultInputMode === 'direct') ||
    (entityType === 'product_meter' && defaultInputMode === 'direct');
  const hasSiblings = entityType === 'product_meter' && !!siblingLocators.length;
  const hasBlending = entityType === 'well' && !!isBlendingWell;
  const siblingIds = useMemo(() => siblingLocators.map(l => l.id), [siblingLocators]);
  const siblingModeById = useMemo(() => {
    const map = new Map<string, 'raw' | 'direct'>();
    siblingLocators.forEach(l => map.set(l.id, l.defaultInputMode === 'direct' ? 'direct' : 'raw'));
    return map;
  }, [siblingLocators]);
  const qc = useQueryClient();

  const { data: rows = [], isLoading, error, refetch } = useQuery<HistoryRow[]>({
    queryKey: ['entity-history', entityType, entityId, range, defaultInputMode],
    queryFn: async () => {
      const days = range === 'all' ? 9999 : parseInt(range);
      const since = new Date(Date.now() - days * 86400_000).toISOString();
      let raw: any[] = [];
      if (entityType === 'locator') {
        const { data, error: sbError } = await supabase
          .from('locator_readings')
          .select('reading_datetime, current_reading, previous_reading, daily_volume')
          .eq('locator_id', entityId)
          .gte('reading_datetime', since)
          .order('reading_datetime', { ascending: true });
        if (sbError) throw sbError;
        raw = data ?? [];
      } else if (entityType === 'well') {
        const { data, error: sbError } = await supabase
          .from('well_readings')
          .select('reading_datetime, current_reading, previous_reading, daily_volume')
          .eq('well_id', entityId)
          .gte('reading_datetime', since)
          .order('reading_datetime', { ascending: true });
        if (sbError) throw sbError;
        raw = data ?? [];
      } else {
        const { data, error: sbError } = await supabase
          .from('product_meter_readings' as any)
          .select('reading_datetime, current_reading, previous_reading, daily_volume')
          .eq('meter_id', entityId)
          .gte('reading_datetime', since)
          .order('reading_datetime', { ascending: true });
        if (sbError) throw sbError;
        raw = (data ?? []) as any[];
      }
      let last: number | null = null;
      return raw.map((r: any) => {
        const dateStr = fmtIsoDate(r.reading_datetime);
        let consumption = 0;
        if (isDirectMode) {
          consumption = r.current_reading != null ? +r.current_reading : 0;
        } else if (last != null && r.current_reading != null) {
          consumption = Math.max(0, +r.current_reading - last);
        } else if (r.daily_volume != null && +r.daily_volume > 0) {
          consumption = +r.daily_volume;
        } else if (r.current_reading != null && r.previous_reading != null) {
          consumption = Math.max(0, +r.current_reading - +r.previous_reading);
        }
        if (r.current_reading != null) last = +r.current_reading;
        return { date: dateStr, consumption: +consumption.toFixed(2), reading: r.current_reading != null ? +r.current_reading : undefined };
      }).filter(r => r.date);
    },
    staleTime: 60_000,
  });

  const aggregated = useMemo<HistoryRow[]>(() => {
    const map = new Map<string, HistoryRow>();
    rows.forEach(r => {
      if (map.has(r.date)) {
        map.get(r.date)!.consumption += r.consumption;
        if (r.reading != null) map.get(r.date)!.reading = r.reading;
      } else {
        map.set(r.date, { ...r });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [rows]);

  const { data: siblingRows = [], isLoading: siblingsLoading } = useQuery<{ date: string; locatorId: string; consumption: number }[]>({
    queryKey: ['entity-history-siblings', entityId, range, siblingIds.join(',')],
    enabled: hasSiblings,
    queryFn: async () => {
      const days = range === 'all' ? 9999 : parseInt(range);
      const since = new Date(Date.now() - days * 86400_000).toISOString();
      const { data } = await supabase
        .from('locator_readings')
        .select('locator_id, reading_datetime, current_reading, previous_reading, daily_volume')
        .in('locator_id', siblingIds)
        .gte('reading_datetime', since)
        .order('reading_datetime', { ascending: true });
      return (data ?? []).map((r: any) => {
        const dateStr = fmtIsoDate(r.reading_datetime);
        const isDirect = siblingModeById.get(r.locator_id) === 'direct';
        let consumption = 0;
        if (isDirect) {
          consumption = r.current_reading != null ? +r.current_reading : 0;
        } else if (r.daily_volume != null && +r.daily_volume > 0) {
          consumption = +r.daily_volume;
        } else if (r.current_reading != null && r.previous_reading != null) {
          consumption = Math.max(0, +r.current_reading - +r.previous_reading);
        }
        return { date: dateStr, locatorId: r.locator_id as string, consumption };
      }).filter((r: any) => r.date);
    },
    staleTime: 60_000,
  });

  const siblingByDate = useMemo(() => {
    const map = new Map<string, number>();
    siblingRows.forEach(r => map.set(r.date, (map.get(r.date) ?? 0) + r.consumption));
    return map;
  }, [siblingRows]);

  const siblingByDateAndLocator = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    siblingRows.forEach(r => {
      if (!map.has(r.date)) map.set(r.date, new Map());
      const dayMap = map.get(r.date)!;
      dayMap.set(r.locatorId, (dayMap.get(r.locatorId) ?? 0) + r.consumption);
    });
    return map;
  }, [siblingRows]);

  const totalSiblingConsumption = useMemo(
    () => siblingRows.reduce((s, r) => s + r.consumption, 0),
    [siblingRows],
  );

  const { data: blendingRows = [], isLoading: blendingLoading } = useQuery<{ date: string; volume: number }[]>({
    queryKey: ['entity-history-blending', entityId, range],
    enabled: hasBlending,
    queryFn: async () => {
      const days = range === 'all' ? 9999 : parseInt(range);
      const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('blending_events' as any)
        .select('event_date, volume_m3')
        .eq('well_id', entityId)
        .gte('event_date', since);
      if (error) return [];
      return (data ?? [])
        .map((r: any) => ({ date: String(r.event_date ?? '').slice(0, 10), volume: Number(r.volume_m3) || 0 }))
        .filter((r: any) => r.date);
    },
    staleTime: 60_000,
  });

  const blendingByDate = useMemo(() => {
    const map = new Map<string, number>();
    blendingRows.forEach(r => map.set(r.date, (map.get(r.date) ?? 0) + r.volume));
    return map;
  }, [blendingRows]);

  const totalBlendingVolume = useMemo(
    () => blendingRows.reduce((s, r) => s + r.volume, 0),
    [blendingRows],
  );

  const chartData = useMemo(() => {
    if (hasSiblings) {
      return aggregated.map(r => {
        const siblingTotal = +(siblingByDate.get(r.date) ?? 0).toFixed(2);
        const dayMap = siblingByDateAndLocator.get(r.date);
        const perLocator: Record<string, number> = {};
        siblingLocators.forEach(l => {
          perLocator[siblingDataKey(l.id)] = +(dayMap?.get(l.id) ?? 0).toFixed(2);
        });
        return { ...r, siblingTotal, nrw: calc.nrw(r.consumption, siblingTotal), ...perLocator };
      });
    }
    if (hasBlending) {
      return aggregated.map(r => {
        const blendedVolume = +(blendingByDate.get(r.date) ?? 0).toFixed(2);
        const blendedPct = r.consumption > 0 ? +((blendedVolume / r.consumption) * 100).toFixed(1) : null;
        return { ...r, blendedVolume, blendedPct };
      });
    }
    return aggregated;
  }, [aggregated, hasSiblings, siblingByDate, siblingByDateAndLocator, siblingLocators, hasBlending, blendingByDate]);

  const periodNrw = hasSiblings ? calc.nrw(
    aggregated.reduce((s, r) => s + r.consumption, 0),
    totalSiblingConsumption,
  ) : null;

  const totalConsumption = aggregated.reduce((s, r) => s + r.consumption, 0);
  const avgConsumption = aggregated.length ? totalConsumption / aggregated.length : 0;

  const periodBlendedPct = hasBlending && totalConsumption > 0
    ? +((totalBlendingVolume / totalConsumption) * 100).toFixed(1)
    : null;

  const invalidateCaches = useCallback((trainId: string) => {
    qc.invalidateQueries({ queryKey: ['entity-history', 'well', trainId] });
    deltaCache.invalidate(trainId);
  }, [qc]);

  return {
    isDirectMode, hasSiblings, hasBlending, siblingIds, siblingModeById,
    rows, aggregated, isLoading, error, refetch, siblingsLoading,
    siblingRows, siblingByDate, siblingByDateAndLocator, totalSiblingConsumption,
    blendingRows, blendingLoading, blendingByDate, totalBlendingVolume,
    chartData, periodNrw, totalConsumption, avgConsumption, periodBlendedPct,
    invalidateCaches, qc,
  };
}

export function fmtNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}
