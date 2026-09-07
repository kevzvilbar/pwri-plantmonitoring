import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { usePlants } from '@/hooks/usePlants';
import { useAuth } from '@/hooks/useAuth';
import { format } from 'date-fns';
import { computeRollingAverageRateFromDeltas, type VolumePoint } from '@/lib/flowRateGuards';
import {
  formatCooldown,
  invalidateLocatorDash,
  invalidateWellDash,
  invalidateDashboard,
  invalidateProductMeterDash,
  invalidatePowerDash,
  invalidateRODash,
  invalidateChemDash,
} from '../../shared';

export function useProductSectionData({
  highlightId,
  isMobile,
  user,
}: {
  highlightId?: string | null;
  isMobile: boolean;
  user: { id?: string } | null | undefined;
}) {
  const qc = useQueryClient();
  const { data: plants } = usePlants();
  const [plantId, setPlantId] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [pulseId, setPulseId] = useState<string | null>(null);

  const { data: meters, isLoading: metersLoading } = useQuery({
    queryKey: ['op-product-meters', plantId],
    queryFn: async () => {
      if (!plantId) return [];
      let { data, error } = await supabase
        .from('product_meters' as any)
        .select('id, name, status, sort_order, meter_serial, is_derived, derived_from_locator_id, created_at')
        .eq('plant_id', plantId)
        .order('sort_order', { ascending: true });
      if (error?.message?.includes('is_derived') || error?.message?.includes('derived_from_locator_id')) {
        ({ data, error } = await supabase
          .from('product_meters' as any)
          .select('id, name, status, sort_order, meter_serial, created_at')
          .eq('plant_id', plantId)
          .order('sort_order', { ascending: true }));
      }
      if (error?.message?.includes('meter_serial')) {
        ({ data, error } = await supabase
          .from('product_meters' as any)
          .select('id, name, status, sort_order, created_at')
          .eq('plant_id', plantId)
          .order('sort_order', { ascending: true }));
      }
      if (error?.message?.includes('sort_order')) {
        ({ data, error } = await supabase
          .from('product_meters' as any)
          .select('id, name, status, meter_serial, created_at')
          .eq('plant_id', plantId)
          .order('created_at', { ascending: true }));
        if (error?.message?.includes('meter_serial')) {
          ({ data, error } = await supabase
            .from('product_meters' as any)
            .select('id, name, status, created_at')
            .eq('plant_id', plantId)
            .order('created_at', { ascending: true }));
        }
      }
      if (error?.message?.includes('status')) {
        const { data: fallback, error: fallbackErr } = await supabase
          .from('product_meters' as any)
          .select('id, name, created_at')
          .eq('plant_id', plantId)
          .order('created_at', { ascending: true });
        if (fallbackErr) throw fallbackErr;
        return ((fallback ?? []) as any[]).map((m: any) => ({ ...m, status: 'Active' }));
      }
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!plantId,
  });

  useEffect(() => {
    if (!highlightId || isMobile) return;
    const el = rowRefs.current[highlightId];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setPulseId(highlightId);
    const t = setTimeout(() => setPulseId(null), 2200);
    return () => clearTimeout(t);
  }, [highlightId, isMobile, meters]);

  const { data: latestReadings } = useQuery({
    queryKey: ['product-readings-latest-v2', plantId],
    queryFn: async () => {
      if (!plantId) return [];
      const { data, error } = await (supabase.from('product_meter_readings_latest' as any) as any)
        .select('*')
        .eq('plant_id', plantId);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!plantId,
  });

  const latestByMeter = useMemo(() => {
    const m: Record<string, any> = {};
    for (const r of latestReadings ?? []) m[r.meter_id] = r;
    return m;
  }, [latestReadings]);

  const { data: recentProductReadings } = useQuery({
    queryKey: ['product-readings-10day', plantId],
    queryFn: async () => {
      if (!plantId) return [];
      const since = new Date();
      since.setDate(since.getDate() - 10);
      const { data, error } = await supabase
        .from('product_meter_readings' as any)
        .select('meter_id, daily_volume, reading_datetime')
        .eq('plant_id', plantId)
        .gte('reading_datetime', since.toISOString())
        .order('reading_datetime', { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!plantId,
  });

  const avgByMeter = useMemo(() => {
    const byMeter: Record<string, VolumePoint[]> = {};
    for (const r of recentProductReadings ?? []) {
      if (r.daily_volume != null && r.daily_volume > 0 && r.reading_datetime) {
        (byMeter[r.meter_id] ||= []).push({ volume: r.daily_volume, at: new Date(r.reading_datetime) });
      }
    }
    const result: Record<string, number | null> = {};
    for (const [id, points] of Object.entries(byMeter))
      result[id] = computeRollingAverageRateFromDeltas(points, 10);
    return result;
  }, [recentProductReadings]);

  const derivedLocatorIds = useMemo(
    () => [...new Set((meters ?? []).map((m: any) => m.derived_from_locator_id).filter(Boolean))],
    [meters],
  );

  const { data: mirrorSourceLocators } = useQuery({
    queryKey: ['product-meter-mirror-sources', derivedLocatorIds.join(',')],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('locators').select('id, name, plant_id').in('id', derivedLocatorIds as string[]);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: derivedLocatorIds.length > 0,
  });

  const mirrorSourceById = useMemo(() => {
    const plantNameById: Record<string, string> = {};
    for (const p of plants ?? []) plantNameById[p.id] = p.name;
    const m: Record<string, { locatorName: string; plantName: string }> = {};
    for (const l of mirrorSourceLocators ?? []) {
      m[l.id] = { locatorName: l.name, plantName: plantNameById[l.plant_id] ?? 'another plant' };
    }
    return m;
  }, [mirrorSourceLocators, plants]);

  const todayDateStr = format(new Date(), 'yyyy-MM-dd');

  const { data: gapReasons } = useQuery({
    queryKey: ['product-gap-reasons', plantId, todayDateStr],
    enabled: !!plantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reading_gap_reasons' as any)
        .select('*')
        .eq('plant_id', plantId)
        .eq('entity_type', 'product')
        .eq('gap_date', todayDateStr);
      if (error) return [];
      return (data ?? []) as any[];
    },
  });

  const gapReasonsByMeter = useMemo(() => {
    const m: Record<string, any> = {};
    (gapReasons ?? []).forEach((g: any) => { m[g.entity_id] = g; });
    return m;
  }, [gapReasons]);

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['op-product-meters', plantId] });
    qc.invalidateQueries({ queryKey: ['product-readings-latest-v2', plantId] });
    qc.invalidateQueries({ queryKey: ['product-gap-reasons', plantId] });
    qc.invalidateQueries({ queryKey: ['dash-product-meters-today'] });
    qc.invalidateQueries({ queryKey: ['dash-product-meters-yest'] });
    qc.invalidateQueries({ queryKey: ['dash-ro-permeate-today'] });
    qc.invalidateQueries({ queryKey: ['dash-ro-permeate-yest'] });
    qc.invalidateQueries({ queryKey: ['dash-loc-today'] });
    qc.invalidateQueries({ queryKey: ['dash-loc-yest'] });
    qc.invalidateQueries({ queryKey: ['dash-wells-today'] });
    qc.invalidateQueries({ queryKey: ['dash-wells-yest'] });
    qc.invalidateQueries({ queryKey: ['dash-costs-today'] });
    qc.invalidateQueries({ queryKey: ['dash-summary-recent'] });
    qc.invalidateQueries({ queryKey: ['dash-chem'] });
    qc.invalidateQueries({ queryKey: ['alerts-feed'] });
    qc.invalidateQueries({ queryKey: ['trend-loc'] });
    qc.invalidateQueries({ queryKey: ['trend-product'] });
    qc.invalidateQueries({ queryKey: ['trend-well'] });
    qc.invalidateQueries({ queryKey: ['trend-power'] });
    qc.invalidateQueries({ queryKey: ['trend-cost'] });
    qc.invalidateQueries({ queryKey: ['trend-ro'] });
    invalidateProductMeterDash(qc);
  }, [qc, plantId]);

  return {
    plantId,
    setPlantId,
    importOpen,
    setImportOpen,
    meters,
    metersLoading,
    latestByMeter,
    avgByMeter,
    mirrorSourceById,
    gapReasonsByMeter,
    rowRefs,
    pulseId,
    setPulseId,
    invalidate,
    qc,
    user,
  };
}
