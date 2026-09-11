import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Auto-flag RO trains as Offline when no readings have been logged in >= 2 hours.
 * Checks both RO Train and Pre-Treatment logs for activity.
 * Returns the list of trains needing operator confirmation to remain Running.
 */
export const AUTO_OFFLINE_THRESHOLD_HOURS = 2;

export interface TrainGap {
  train_id: string;
  train_number: number;
  plant_id: string;
  last_reading_at: string | null;
  hours_gap: number;
  current_status: string;
}

export function shouldAutoFlagTrainOffline(hoursGap: number, currentStatus: string): boolean {
  return hoursGap >= AUTO_OFFLINE_THRESHOLD_HOURS && currentStatus === 'Running';
}

export function useTrainAutoOffline(plantIds: string[]) {
  const qc = useQueryClient();
  const { data: gaps } = useQuery({
    queryKey: ['train-gaps', plantIds],
    queryFn: async (): Promise<TrainGap[]> => {
      if (!plantIds.length) return [];
      const { data: trains, error: trainsErr } = await supabase
        .from('ro_trains')
        .select('id,train_number,plant_id,status')
        .in('plant_id', plantIds);
      if (trainsErr) throw trainsErr;
      if (!trains?.length) return [];

      const since = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
      const trainIds = trains.map((t) => t.id);

      const [roRecentRes, preRecentRes] = await Promise.all([
        supabase
          .from('ro_train_readings')
          .select('train_id,reading_datetime')
          .in('train_id', trainIds)
          .gte('reading_datetime', since)
          .order('reading_datetime', { ascending: false }),
        supabase
          .from('ro_pretreatment_readings')
          .select('train_id,reading_datetime')
          .in('train_id', trainIds)
          .gte('reading_datetime', since)
          .order('reading_datetime', { ascending: false }),
      ]);
      if (roRecentRes.error) throw roRecentRes.error;
      if (preRecentRes.error) throw preRecentRes.error;

      const lastBy = new Map<string, string>();
      const updateLatest = (r: { train_id: string; reading_datetime: string | null }) => {
        if (!r.reading_datetime) return;
        const curr = lastBy.get(r.train_id);
        if (!curr || new Date(r.reading_datetime).getTime() > new Date(curr).getTime()) {
          lastBy.set(r.train_id, r.reading_datetime);
        }
      };
      (roRecentRes.data ?? []).forEach(updateLatest);
      (preRecentRes.data ?? []).forEach(updateLatest);

      const now = Date.now();
      return trains.map((t: any) => {
        const last = lastBy.get(t.id) ?? null;
        const hours = last ? (now - new Date(last).getTime()) / 1000 / 60 / 60 : Infinity;
        return {
          train_id: t.id, train_number: t.train_number, plant_id: t.plant_id,
          last_reading_at: last, hours_gap: hours, current_status: t.status,
        };
      }).filter((g) => shouldAutoFlagTrainOffline(g.hours_gap, g.current_status));
    },
    enabled: plantIds.length > 0,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  // Auto-mark stale trains Offline (operator must confirm to bring back Running)
  useEffect(() => {
    if (!gaps?.length) return;
    (async () => {
      let flaggedAny = false;
      for (const g of gaps) {
        const { error } = await supabase.from('ro_trains').update({ status: 'Offline' }).eq('id', g.train_id);
        if (error) {
          console.warn('[useTrainAutoOffline] Failed to auto-flag train offline', g.train_id, error);
          continue;
        }
        await supabase.from('train_status_log').insert({
          train_id: g.train_id,
          plant_id: g.plant_id,
          status: 'Offline',
          reason: `Auto-flagged: no reading for ${g.hours_gap === Infinity ? '>24' : g.hours_gap.toFixed(1)}h`,
          confirmed_at: g.last_reading_at ? new Date(g.last_reading_at).toISOString() : new Date().toISOString(),
        });
        flaggedAny = true;
      }
      if (flaggedAny) {
        qc.invalidateQueries({ queryKey: ['trains'] });
        qc.invalidateQueries({ queryKey: ['ro-trains'] });
        qc.invalidateQueries({ queryKey: ['train-latest-status-log'] });
        qc.invalidateQueries({ queryKey: ['train-status-log'] });
        qc.invalidateQueries({ queryKey: ['train-hourly-gaps'] });
      }
    })();
  }, [gaps, qc]);

  return gaps ?? [];
}
