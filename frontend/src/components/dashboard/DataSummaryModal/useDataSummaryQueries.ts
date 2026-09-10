import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, subDays } from 'date-fns';

export interface DataSummaryQueriesOptions {
  open: boolean;
  plantIds: string[];
}

export interface DataSummaryQueriesResult {
  tab: 'both' | 'production' | 'consumption' | 'current';
  setTab: (t: 'both' | 'production' | 'consumption' | 'current') => void;
  currentSide: 'consumption' | 'production';
  setCurrentSide: (s: 'consumption' | 'production') => void;
  fromStr: string;
  setFromStr: (v: string) => void;
  toStr: string;
  setToStr: (v: string) => void;
  startISO: string;
  endISO: string;
  locators: any[];
  locatorsLoading: boolean;
  locatorIds: string[];
  directLocatorIds: Set<string>;
  consReadings: any[];
  consLoading: boolean;
  productMeters: any[];
  metersLoading: boolean;
  meterIds: string[];
  directMeterIds: Set<string>;
  prodReadings: any[];
  prodLoading: boolean;
  modalMeterConfigs: any[] | undefined;
  configLoading: boolean;
  permeateIsProductionPlantIds: string[];
  productExcludedPlantIds: Set<string>;
  configsReady: boolean;
  roTrainsMeta: any[];
  trainsLoading: boolean;
  roMeterReadings: any[];
  roLoading: boolean;
  roCurrentReadings: any[] | undefined;
  prodDataLoading: boolean;
  isLoading: boolean;
}

export function useDataSummaryQueries({ open, plantIds }: DataSummaryQueriesOptions): DataSummaryQueriesResult {
  const [tab, setTab] = useState<'both' | 'production' | 'consumption' | 'current'>('both');
  const [currentSide, setCurrentSide] = useState<'consumption' | 'production'>('consumption');

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const [fromStr, setFromStr] = useState<string>(format(subDays(new Date(), 6), 'yyyy-MM-dd'));
  const [toStr,   setToStr]   = useState<string>(todayStr);

  const startISO = new Date(fromStr + 'T00:00:00').toISOString();
  const endISO   = new Date(toStr   + 'T23:59:59').toISOString();

  const { data: locators, isLoading: locatorsLoading } = useQuery({
    queryKey: ['dsm-locators', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const { data } = await supabase
        .from('locators').select('id,name,plant_id,default_input_mode,is_derived')
        .in('plant_id', plantIds).eq('status', 'Active');
      return data ?? [];
    },
    enabled: open && plantIds.length > 0,
    staleTime: 30_000,
    refetchInterval: open ? 30_000 : false,
  });

  const locatorIds = useMemo(() => (locators ?? []).map((l) => l.id), [locators]);

  const directLocatorIds = useMemo(
    () => new Set(
      (locators ?? [])
        .filter((l) => l.default_input_mode === 'direct' || l.is_derived === true)
        .map((l) => l.id),
    ),
    [locators],
  );

  const { data: consReadings, isLoading: consLoading } = useQuery({
    queryKey: ['dsm-cons-readings', locatorIds, fromStr, toStr],
    queryFn: async () => {
      if (!locatorIds.length) return [];
      const { data } = await supabase
        .from('locator_readings_clean')
        .select('locator_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement,is_estimated')
        .in('locator_id', locatorIds)
        .gte('reading_datetime', startISO)
        .lte('reading_datetime', endISO)
        .order('reading_datetime', { ascending: true });
      return data ?? [];
    },
    enabled: open && locatorIds.length > 0,
    refetchInterval: open ? 30_000 : false,
  });

  const { data: productMeters, isLoading: metersLoading } = useQuery({
    queryKey: ['dsm-product-meters', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const { data } = await supabase.from('product_meters')
        .select('id,name,plant_id,is_derived').in('plant_id', plantIds);
      return data ?? [];
    },
    enabled: open && plantIds.length > 0,
    refetchInterval: open ? 30_000 : false,
  });

  const meterIds = useMemo(() => (productMeters ?? []).map((m) => m.id), [productMeters]);

  const directMeterIds = useMemo(
    () => new Set((productMeters ?? []).filter((m) => m.is_derived === true).map((m) => m.id)),
    [productMeters],
  );

  const { data: prodReadings, isLoading: prodLoading } = useQuery({
    queryKey: ['dsm-prod-readings', meterIds, fromStr, toStr],
    queryFn: async () => {
      if (!meterIds.length) return [];
      const { data } = await supabase.from('product_meter_readings')
        .select('meter_id,daily_volume,current_reading,previous_reading,reading_datetime,is_meter_replacement,is_estimated')
        .in('meter_id', meterIds)
        .gte('reading_datetime', startISO)
        .lte('reading_datetime', endISO)
        .order('reading_datetime', { ascending: true });
      return data ?? [];
    },
    enabled: open && meterIds.length > 0,
    refetchInterval: open ? 30_000 : false,
  });

  const { data: modalMeterConfigs, isLoading: configLoading } = useQuery({
    queryKey: ['dsm-meter-configs', plantIds],
    queryFn: async () => {
      if (!plantIds.length) return [];
      const { data } = await supabase.from('plant_meter_config')
        .select('plant_id,permeate_is_production,config')
        .in('plant_id', plantIds);
      return data ?? [];
    },
    enabled: open && plantIds.length > 0,
    staleTime: 30_000,
  });

  const permeateIsProductionPlantIds = useMemo(
    () => (modalMeterConfigs ?? [])
      .filter((c) => {
        const cfg = c.config as Record<string, unknown> | null;
        return c.permeate_is_production === true || cfg?.permeate_is_production === true;
      })
      .map((c) => c.plant_id),
    [modalMeterConfigs],
  );

  const productExcludedPlantIds = useMemo(
    () => new Set<string>(
      (modalMeterConfigs ?? [])
        .filter((c) => {
          const cfg = c.config as Record<string, unknown> | null;
          return cfg?.ro_production_source === 'permeate' &&
            (c.permeate_is_production === true || cfg?.permeate_is_production === true);
        })
        .map((c) => c.plant_id),
    ),
    [modalMeterConfigs],
  );

  const configsReady = !configLoading && modalMeterConfigs !== undefined;

  const { data: roTrainsMeta, isLoading: trainsLoading } = useQuery({
    queryKey: ['dsm-ro-trains', permeateIsProductionPlantIds],
    queryFn: async () => {
      if (!permeateIsProductionPlantIds.length) return [];
      const { data } = await supabase
        .from('ro_trains')
        .select('id,train_number,plant_id')
        .in('plant_id', permeateIsProductionPlantIds)
        .order('train_number');
      return data ?? [];
    },
    enabled: open && permeateIsProductionPlantIds.length > 0,
    refetchInterval: open ? 30_000 : false,
  });

  const { data: roMeterReadings, isLoading: roLoading } = useQuery({
    queryKey: ['dsm-ro-readings', permeateIsProductionPlantIds, fromStr, toStr],
    queryFn: async () => {
      if (!permeateIsProductionPlantIds.length) return [];
      const { data } = await supabase
        .from('ro_train_readings')
        .select('train_id,permeate_meter_delta,reading_datetime,is_estimated')
        .in('plant_id', permeateIsProductionPlantIds)
        .not('permeate_meter_delta', 'is', null)
        .gt('permeate_meter_delta', 0)
        .gte('reading_datetime', startISO)
        .lte('reading_datetime', endISO);
      return data ?? [];
    },
    enabled: open && permeateIsProductionPlantIds.length > 0,
    staleTime: 30_000,
    refetchInterval: open ? 30_000 : false,
  });

  const { data: roCurrentReadings } = useQuery({
    queryKey: ['dsm-ro-current', permeateIsProductionPlantIds, fromStr, toStr],
    queryFn: async () => {
      if (!permeateIsProductionPlantIds.length) return [];
      const { data } = await supabase
        .from('ro_train_readings')
        .select('train_id,permeate_meter,reading_datetime')
        .in('plant_id', permeateIsProductionPlantIds)
        .not('permeate_meter', 'is', null)
        .gte('reading_datetime', startISO)
        .lte('reading_datetime', endISO);
      return data ?? [];
    },
    enabled: open && (tab === 'current' || tab === 'production') && permeateIsProductionPlantIds.length > 0,
  });

  const prodDataLoading = !configsReady || metersLoading || prodLoading || roLoading || trainsLoading;
  const isLoading = tab === 'consumption'
    ? (locatorsLoading || consLoading)
    : tab === 'production'
      ? prodDataLoading
      : tab === 'current'
        ? (locatorsLoading || consLoading || prodDataLoading)
        : (locatorsLoading || consLoading || prodDataLoading);

  return {
    tab, setTab, currentSide, setCurrentSide,
    fromStr, setFromStr, toStr, setToStr,
    startISO, endISO,
    locators: locators ?? [], locatorsLoading, locatorIds, directLocatorIds,
    consReadings: consReadings ?? [], consLoading,
    productMeters: productMeters ?? [], metersLoading, meterIds, directMeterIds,
    prodReadings: prodReadings ?? [], prodLoading,
    modalMeterConfigs, configLoading,
    permeateIsProductionPlantIds, productExcludedPlantIds, configsReady,
    roTrainsMeta: roTrainsMeta ?? [], trainsLoading, roMeterReadings: roMeterReadings ?? [], roLoading, roCurrentReadings,
    prodDataLoading, isLoading,
  };
}
