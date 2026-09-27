import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useROTrainsForPlant } from '@/hooks/useROTrains';
import { supabase } from '@/integrations/supabase/client';
import { usePlants } from '@/hooks/usePlants';
import { useAuth } from '@/hooks/useAuth';

export function useTrainsListData(plantId: string) {
  const { isManager, isAdmin, user, activeOperator } = useAuth();
  const { data: plants } = usePlants();
  const plant = plants?.find((p) => p.id === plantId);

  const { data: trains } = useROTrainsForPlant(plantId);

  const trainIdsKey = (trains ?? []).map((t: any) => t.id).join(',');
  const { data: recentTrainIds } = useQuery<string[]>({
    queryKey: ['ro-trains-recent', plantId, trainIdsKey],
    queryFn: async () => {
      const ids = (trains ?? []).map((t: any) => t.id);
      if (!ids.length) return [];
      const ONE_HOUR_MS = 60 * 60 * 1000;
      const oneHourAgo = new Date(Date.now() - ONE_HOUR_MS).toISOString();
      const { data } = await supabase
        .from('ro_train_readings')
        .select('train_id')
        .in('train_id', ids)
        .gte('reading_datetime', oneHourAgo);
      return (data ?? []).map((r: any) => r.train_id as string);
    },
    enabled: (trains ?? []).length > 0,
  });

  const runningTrainIds = useMemo(() => {
    if (!recentTrainIds) return new Set<string>();
    if (recentTrainIds instanceof Set) return recentTrainIds;
    if (Array.isArray(recentTrainIds)) return new Set(recentTrainIds);
    if (typeof recentTrainIds === 'object') return new Set(Object.keys(recentTrainIds));
    return new Set<string>();
  }, [recentTrainIds]);

  const { data: trainMeterReplacements } = useQuery({
    queryKey: ['ro-train-meter-replacements', plantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ro_train_meter_replacements' as any)
        .select('*, replacer:user_profiles!ro_train_meter_replacements_replaced_by_fkey(first_name,last_name)')
        .eq('plant_id', plantId)
        .order('replacement_date', { ascending: false });
      if (error) return [];
      return (data ?? []) as any[];
    },
  });
  const latestTrainReplacement = useMemo(() => {
    const map: Record<string, any> = {};
    for (const r of trainMeterReplacements ?? []) {
      const key = `${r.train_id}:${r.meter_type}`;
      if (!map[key]) map[key] = r;
    }
    return map;
  }, [trainMeterReplacements]);

  const deriveTrainStatus = (t: any): 'Running' | 'Maintenance' | 'Offline' => {
    if (t.status === 'Maintenance') return 'Maintenance';
    if (runningTrainIds.has(t.id)) return 'Running';
    return 'Offline';
  };

  const effectiveMediaType = (t: any) => t.filter_media_type ?? plant?.filter_media_type ?? 'AFM';
  const effectiveFilterType = (t: any) => t.filter_housing_type ?? plant?.filter_housing_type ?? 'Cartridge Filter';

  return {
    plant, trains, recentTrainIds, trainMeterReplacements, latestTrainReplacement,
    deriveTrainStatus, effectiveMediaType, effectiveFilterType,
    isManager, isAdmin, user, activeOperator,
  };
}
