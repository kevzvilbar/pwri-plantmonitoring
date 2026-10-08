import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface UseTrendWaterQueriesOptions {
  metric: string;
  plantIds: string[];
  startISO: string;
  endISO: string;
  startKey: string;
  endKey: string;
  chartStaleTime: number;
  chartRefetchInterval: false | number;
  needsLocReadings: boolean;
  needsProductMeterReadings: boolean;
  needsWellReadings: boolean;
  needsRoReadings: boolean;
  needsPermeateProduction: boolean;
  locatorIdsForReadings?: string[];
  roTrainIdsForReadings?: string[];
}

export function useTrendWaterQueries({
  metric,
  plantIds,
  startISO,
  endISO,
  startKey,
  endKey,
  chartStaleTime,
  chartRefetchInterval,
  needsLocReadings,
  needsProductMeterReadings,
  needsWellReadings,
  needsRoReadings,
  needsPermeateProduction,
  locatorIdsForReadings,
  roTrainIdsForReadings,
}: UseTrendWaterQueriesOptions) {
  const supaSelect = async <T,>(table: string, cols: string) => {
    const { data, error } = await supabase.from(table as never).select(cols)
      .in('plant_id', plantIds).gte('reading_datetime', startISO).lte('reading_datetime', endISO);
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data as T[]) ?? [];
  };

  const { data: locReadings, isFetching: fetchingLoc, error: errLoc, refetch: refetchLoc } = useQuery({
    queryKey: ['trend-loc', metric, startKey, endKey, plantIds],
    queryFn: async () => {
      const locatorIds = locatorIdsForReadings ?? [];
      if (!locatorIds.length) return [];
      const { data, error } = await supabase
        .from('locator_readings')
        .select('locator_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement,norm_status,is_estimated,multiplier_at_reading')
        .in('locator_id', locatorIds)
        .gte('reading_datetime', startISO)
        .lte('reading_datetime', endISO)
        .order('reading_datetime', { ascending: true });
      if (error) throw new Error(`locator_readings: ${error.message}`);
      return (data ?? []) as any[];
    },
    enabled: plantIds.length > 0 && needsLocReadings && (locatorIdsForReadings !== undefined),
    staleTime: chartStaleTime,
    refetchInterval: chartRefetchInterval,
  });

  const { data: productReadings, isFetching: fetchingProduct, error: errProduct, refetch: refetchProduct } = useQuery({
    queryKey: ['trend-product', metric, startKey, endKey, plantIds],
    queryFn: async () => {
      const { data, error } = await supabase.from('product_meter_readings')
        .select('meter_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement,plant_id,norm_status,is_estimated,multiplier_at_reading')
        .in('plant_id', plantIds)
        .gte('reading_datetime', startISO)
        .lte('reading_datetime', endISO);
      if (error) {
        if (error.message?.includes('is_meter_replacement') || error.message?.includes('is_estimated')) {
          const { data: d2, error: e2 } = await supabase.from('product_meter_readings')
            .select('meter_id,daily_volume,current_reading,previous_reading,reading_datetime,plant_id,norm_status,multiplier_at_reading')
            .in('plant_id', plantIds)
            .gte('reading_datetime', startISO)
            .lte('reading_datetime', endISO);
          if (e2) throw new Error(`product_meter_readings: ${e2.message}`);
          return (d2 ?? []) as any[];
        }
        throw new Error(`product_meter_readings: ${error.message}`);
      }
      return (data ?? []) as any[];
    },
    enabled: plantIds.length > 0 && needsProductMeterReadings,
    staleTime: chartStaleTime,
    refetchInterval: chartRefetchInterval,
  });

  const { data: wellReadings, isFetching: fetchingWell, error: errWell, refetch: refetchWell } = useQuery({
    queryKey: ['trend-well', metric, startKey, endKey, plantIds],
    queryFn: async () => {
      type WellReadingRow = {
        well_id: string;
        current_reading: number;
        previous_reading: number | null;
        daily_volume: number | null;
        reading_datetime: string;
        is_meter_replacement?: boolean | null;
        plant_id: string;
        norm_status?: string | null;
        is_estimated?: boolean | null;
        multiplier_at_reading?: number | null;
      };
      const inWindow = await supaSelect<WellReadingRow>(
        'well_readings',
        'well_id,current_reading,previous_reading,daily_volume,reading_datetime,is_meter_replacement,plant_id,norm_status,is_estimated,multiplier_at_reading',
      );

      const { data: wellsData } = await supabase
        .from('wells')
        .select('id')
        .in('plant_id', plantIds);
      const wellIds = (wellsData ?? []).map((w) => w.id);

      const preRows: WellReadingRow[] = [];
      if (wellIds.length > 0) {
        await Promise.all(
          wellIds.map(async (wid) => {
            const { data } = await supabase
              .from('well_readings')
              .select('well_id,current_reading,previous_reading,daily_volume,reading_datetime,is_meter_replacement,plant_id,norm_status,is_estimated,multiplier_at_reading')
              .eq('well_id', wid)
              .lt('reading_datetime', startISO)
              .order('reading_datetime', { ascending: false })
              .limit(1);
            if (data?.[0]) preRows.push(data[0] as unknown as WellReadingRow);
          }),
        );
      }

      return [...preRows, ...inWindow].sort(
        (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
      );
    },
    enabled: plantIds.length > 0 && needsWellReadings,
    staleTime: chartStaleTime,
    refetchInterval: chartRefetchInterval,
  });

  const { data: roReadings, isFetching: fetchingRo, error: errRo, refetch: refetchRo } = useQuery({
    queryKey: ['trend-ro', metric, startKey, endKey, plantIds, roTrainIdsForReadings],
    queryFn: async () => {
      const trainIds = roTrainIdsForReadings ?? [];
      if (!trainIds.length) return [];

      const FULL_SELECT   = 'train_id,recovery_pct,permeate_tds,chlorine_residual_mg_l,norm_status,permeate_meter,permeate_meter_prev,permeate_meter_delta,feed_meter,feed_meter_prev,feed_meter_delta,reject_meter,reject_meter_prev,reject_meter_delta,reading_datetime,is_meter_replacement';
      const LEGACY_SELECT = 'train_id,recovery_pct,permeate_tds,permeate_meter,reading_datetime,is_meter_replacement,norm_status';
      const NEW_COLS = ['chlorine_residual_mg_l', 'permeate_meter_prev', 'permeate_meter_delta', 'feed_meter_delta', 'reject_meter_delta'];
      const isNewColError = (msg: string) => NEW_COLS.some(c => msg.includes(c));

      const { data, error } = await supabase.from('ro_train_readings')
        .select(FULL_SELECT)
        .in('train_id', trainIds)
        .gte('reading_datetime', startISO)
        .lte('reading_datetime', endISO)
        .order('reading_datetime', { ascending: true });
      if (error) {
        if (isNewColError(error.message)) {
          const { data: d2, error: e2 } = await supabase.from('ro_train_readings')
            .select(LEGACY_SELECT)
            .in('train_id', trainIds)
            .gte('reading_datetime', startISO)
            .lte('reading_datetime', endISO)
            .order('reading_datetime', { ascending: true });
          if (e2) throw new Error(`ro_train_readings: ${e2.message}`);
          return (d2 ?? []) as any[];
        }
        throw new Error(`ro_train_readings: ${error.message}`);
      }
      return (data ?? []) as any[];
    },
    enabled: plantIds.length > 0 && (needsRoReadings || needsPermeateProduction) && (roTrainIdsForReadings !== undefined),
    staleTime: chartStaleTime,
    refetchInterval: chartRefetchInterval,
  });

  return {
    locReadings, fetchingLoc, errLoc, refetchLoc,
    productReadings, fetchingProduct, errProduct, refetchProduct,
    wellReadings, fetchingWell, errWell, refetchWell,
    roReadings, fetchingRo, errRo, refetchRo,
  };
}
