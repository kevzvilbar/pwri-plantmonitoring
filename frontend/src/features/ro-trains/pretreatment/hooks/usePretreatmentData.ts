import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { usePlantMeterConfig } from '@/pages/plants/shared';
import { TWO_HOURS_MS } from '@/lib/autoOfflineThreshold';
import { computeROMeterAverageRates } from '@/lib/roReadingGuards';

export interface PretreatmentData {
  trains?: any[];
  train: any;
  prevFeedMeter: number | null;
  prevPermMeter: number | null;
  prevRejMeter: number | null;
  prevPowerMeter: number | null;
  autoDurationMin: number | null;
  lastReadingTime: string | null;
  isPastTwoHoursMissing: boolean;
  isPastHourMissing?: boolean;
  isEffectivelyOffline: boolean;
  isStatusLoading: boolean;
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
  const { config: meterCfg } = usePlantMeterConfig(plantId);

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
  const { data: prevReadings, isLoading: isPrevReadingsLoading } = useQuery({
    queryKey: ['ro-prev', trainId],
    enabled: !!trainId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ro_train_readings')
        .select('feed_meter_delta, permeate_meter_delta, reject_meter_delta, feed_meter, permeate_meter, reject_meter, power_meter_reading_kwh, reading_datetime')
        .eq('train_id', trainId)
        .order('reading_datetime', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: prevPretreatReadings, isLoading: isPrevPretreatLoading } = useQuery({
    queryKey: ['ro-pretreat-prev-dt', trainId],
    enabled: !!trainId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ro_pretreatment_readings')
        .select('reading_datetime')
        .eq('train_id', trainId)
        .order('reading_datetime', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const prevFeedMeter = prevReadings?.feed_meter ?? null;
  const prevPermMeter = prevReadings?.permeate_meter ?? null;
  const prevRejMeter = prevReadings?.reject_meter ?? null;
  const prevPowerMeter = prevReadings?.power_meter_reading_kwh ?? null;

  // Auto-duration: minutes since last reading (from either RO or Pretreatment)
  const roTime = prevReadings?.reading_datetime ? new Date(prevReadings.reading_datetime).getTime() : 0;
  const preTime = prevPretreatReadings?.reading_datetime ? new Date(prevPretreatReadings.reading_datetime).getTime() : 0;
  const maxTime = Math.max(roTime, preTime);
  const lastReadingTime = maxTime > 0
    ? (maxTime === preTime ? prevPretreatReadings!.reading_datetime : prevReadings!.reading_datetime)
    : (prevReadings?.reading_datetime ?? null);

  const autoDurationMin = lastReadingTime
    ? Math.max(0, (Date.now() - new Date(lastReadingTime).getTime()) / 60000)
    : null;
  // Shared 2h staleness threshold (lib/autoOfflineThreshold.ts) — this used
  // to be an inline two-hour millisecond literal; it must agree with the
  // auto-offline flagger or the operator sees a locked Offline form while
  // train cards still read Running (or vice versa).
  const isPastTwoHoursMissing = !lastReadingTime || (Date.now() - new Date(lastReadingTime).getTime() >= TWO_HOURS_MS);
  const isEffectivelyOffline = train
    ? (train.status === 'Offline' || (train.status !== 'Maintenance' && isPastTwoHoursMissing))
    : false;
  // True while we still don't know the train's real last-reading time. The caller should
  // avoid locking in an Online/Offline default from isEffectivelyOffline until this settles,
  // since prevReadings/prevPretreatReadings resolve independently of the `trains` query.
  const isStatusLoading = !!trainId && (isPrevReadingsLoading || isPrevPretreatLoading);
  // Average flow rates (10-day rolling)
  // Key is deliberately NOT ['ro-spark', trainId]: Overview.tsx caches a different
  // shape under ['ro-spark', trainIds.join(',')], which is the very same key for a
  // single-train plant. The extra segment keeps the two apart while the
  // ['ro-spark'] prefix invalidations elsewhere still match.
  const { data: avgFlowRates } = useQuery({
    queryKey: ['ro-spark', 'meter-avg-10d', trainId],
    enabled: !!trainId,
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 10);
      const { data, error } = await supabase
        .from('ro_train_readings' as any)
        .select('reading_datetime, feed_meter, permeate_meter, reject_meter, norm_status')
        .eq('train_id', trainId)
        .gte('reading_datetime', since.toISOString())
        .order('reading_datetime', { ascending: true });
      if (error) throw error;
      return data as any[];
    },
  });

  // The *_meter columns are cumulative totalizer values — convert to per-pair
  // flow rates (m³/hr) before averaging; never average the raw readings.
  const avgRates = computeROMeterAverageRates(avgFlowRates ?? [], 10);
  const avgFeedFlowRate = avgRates.feed;
  const avgPermFlowRate = avgRates.permeate;
  const avgRejFlowRate = avgRates.reject;

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
    trains,
    train,
    prevFeedMeter,
    prevPermMeter,
    prevRejMeter,
    prevPowerMeter,
    autoDurationMin,
    lastReadingTime,
    isPastTwoHoursMissing,
    isPastHourMissing: isPastTwoHoursMissing,
    isEffectivelyOffline,
    isStatusLoading,
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