import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { usePlantMeterConfig } from '@/pages/plants/shared';

export interface PretreatmentData {
  train: any;
  prevFeedMeter: number | null;
  prevPermMeter: number | null;
  prevRejMeter: number | null;
  prevPowerMeter: number | null;
  autoDurationMin: number | null;
  feedCurr: number;
  permCurr: number;
  rejCurr: number;
  avgFeedFlowRate: number | null;
  avgPermFlowRate: number | null;
  avgRejFlowRate: number | null;
  prevMeterEndByUnit: Record<number, number | null>;
  meterCfg: any;
  latestStatusLog: any;
  siblingTrains: any[];
}

export function usePretreatmentData(
  plantId: string,
  trainId: string,
  roValues: Record<string, string>,
  isSynchronized: boolean,
) {
  const { data: meterCfg } = usePlantMeterConfig(plantId);

  // Trains for the selected plant
  const { data: trains } = useQuery({
    queryKey: ['trains', plantId],
    enabled: !!plantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ro_trains' as any)
        .select('*, plants!inner(*)')
        .eq('plant_id', plantId)
        .order('name');
      if (error) throw error;
      return data as any[];
    },
  });
  const train = trains?.find((t: any) => t.id === trainId) ?? null;
  const siblingTrains = trains?.filter((t: any) => t.id !== trainId) ?? [];

  // Previous readings (feed, permeate, reject, power meters)
  const { data: prevReadings } = useQuery({
    queryKey: ['ro-prev', trainId],
    enabled: !!trainId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ro_train_readings' as any)
        .select('feed_meter_delta, permeate_meter_delta, reject_meter_delta, feed_meter_curr, permeate_meter_curr, reject_meter_curr, power_meter_curr, reading_datetime')
        .eq('train_id', trainId)
        .order('reading_datetime', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const prevFeedMeter = prevReadings?.feed_meter_curr ?? null;
  const prevPermMeter = prevReadings?.permeate_meter_curr ?? null;
  const prevRejMeter = prevReadings?.reject_meter_curr ?? null;
  const prevPowerMeter = prevReadings?.power_meter_curr ?? null;

  // Auto-duration: minutes since last reading
  const lastReadingTime = prevReadings?.reading_datetime;
  const autoDurationMin = lastReadingTime
    ? Math.max(0, (Date.now() - new Date(lastReadingTime).getTime()) / 60000)
    : null;
  // Average flow rates (10-day rolling)
  const { data: avgFlowRates } = useQuery({
    queryKey: ['ro-spark', trainId],
    enabled: !!trainId,
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 10);
      const { data, error } = await supabase
        .from('ro_train_readings' as any)
        .select('reading_datetime, feed_meter, permeate_meter, reject_meter')
        .eq('train_id', trainId)
        .gte('reading_datetime', since.toISOString())
        .order('reading_datetime', { ascending: true });
      if (error) throw error;
      return data as any[];
    },
  });

  const avgFeedFlowRate = avgFlowRates?.length
    ? avgFlowRates.reduce((sum: number, r: any) => sum + ((r as any).feed_meter ?? 0), 0) /
      avgFlowRates.filter((r: any) => (r as any).feed_meter != null).length
    : null;
  const avgPermFlowRate = avgFlowRates?.length
    ? avgFlowRates.reduce((sum: number, r: any) => sum + ((r as any).permeate_meter ?? 0), 0) /
      avgFlowRates.filter((r: any) => (r as any).permeate_meter != null).length
    : null;
  const avgRejFlowRate = avgFlowRates?.length
    ? avgFlowRates.reduce((sum: number, r: any) => sum + ((r as any).reject_meter ?? 0), 0) /
      avgFlowRates.filter((r: any) => (r as any).reject_meter != null).length
    : null;

  // Previous meter end by unit (for AFM/MMF)
  const { data: prevUnitReadings } = useQuery({
    queryKey: ['ro-prev', trainId, 'units'],
    enabled: !!trainId && isSynchronized,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ro_pretreatment_readings' as any)
        .select('afm_meter_end_by_unit')
        .eq('train_id', trainId)
        .order('reading_datetime', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });
  const prevMeterEndByUnit = prevUnitReadings?.afm_meter_end_by_unit ?? {};

  // Train status log
  const { data: latestStatusLog } = useQuery({
    queryKey: ['train-latest-status-log', trainId],
    enabled: !!trainId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('train_status_log')
        .select('id, train_id, plant_id, status, reason, confirmed_by, confirmed_at')
        .eq('train_id', trainId)
        .order('confirmed_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error || !data) return null;

      let operatorInfo: { username?: string | null; full_name?: string | null } | null = null;
      if (data.confirmed_by) {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('username, first_name, last_name')
          .eq('id', data.confirmed_by)
          .maybeSingle();
        if (profile) {
          const fn = [profile.first_name, profile.last_name].filter(Boolean).join(' ');
          operatorInfo = {
            username: profile.username ? `@${profile.username}` : null,
            full_name: fn || profile.username || 'Operator',
          };
        }
      }
      return { ...data, operator: operatorInfo };
    },
    staleTime: 10_000,
  });

  // Current meter values
  const num = (s: string) => s ? +s : NaN;
  const feedCurr = num(roValues.feed_meter_curr);
  const permCurr = num(roValues.permeate_meter_curr);
  const rejCurr = num(roValues.reject_meter_curr);

  return {
    train,
    prevFeedMeter,
    prevPermMeter,
    prevRejMeter,
    prevPowerMeter,
    autoDurationMin,
    feedCurr,
    permCurr,
    rejCurr,
    avgFeedFlowRate,
    avgPermFlowRate,
    avgRejFlowRate,
    prevMeterEndByUnit,
    meterCfg,
    latestStatusLog,
    siblingTrains,
  };
}