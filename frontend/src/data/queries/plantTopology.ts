/**
 * data/queries/plantTopology.ts — Plant topology query functions.
 *
 * Roadmap Phase 3: the data-access layer. Pure query functions for
 * plant topology data (wells, RO trains, locators, product meters, power config, links).
 * Components wrap them with React Query via the hooks in src/data/hooks/.
 */
import { supabase } from '@/integrations/supabase/client';

/** Well data for topology */
export interface TopoWell {
  id: string;
  name: string;
  status: string;
  has_power_meter: boolean;
}

/** RO train data for topology */
export interface TopoRoTrain {
  id: string;
  train_number: number;
  name: string;
  status: string;
  shared_power_meter_group: string | null;
  num_afm: number;
  num_booster_pumps: number;
  num_hp_pumps: number;
  num_cartridge_filters: number;
  num_controllers: number;
  filter_media_type: string | null;
  filter_housing_type: string | null;
  unit_type: string | null;
  feed_source_train_id: string | null;
  reject_routing: string | null;
}

/** Locator data for topology */
export interface TopoLocator {
  id: string;
  name: string;
  status: string;
  product_meter_id: string | null;
}

/** Product meter data for topology */
export interface TopoProductMeter {
  id: string;
  name: string;
  status: string;
}

/** Plant power config */
export interface TopoPowerConfig {
  solar_meter_count: number;
  solar_meter_names: string[];
  grid_meter_count: number;
  grid_meter_names: string[];
}

/** Plant meter config */
export interface TopoMeterConfig {
  config: any;
  permeate_is_production: boolean;
}

/** Saved topology links */
export interface TopoLink {
  from_id: string;
  to_id: string;
}

/** Complete topology data response */
export interface TopologyData {
  wells: TopoWell[];
  roTrains: TopoRoTrain[];
  locators: TopoLocator[];
  productMeters: TopoProductMeter[];
  powerCfg: TopoPowerConfig | null;
  meterCfg: TopoMeterConfig | null;
  savedLinks: TopoLink[];
}

/** Fetch all topology data for a plant */
export async function fetchTopologyData(plantId: string): Promise<TopologyData> {
  if (!plantId) throw new Error('Plant ID required');

  const [wellsRes, roRes, locRes, prodRes, powerCfgRes, meterCfgRes] = await Promise.all([
    supabase.from('wells').select('id,name,status,has_power_meter').eq('plant_id', plantId).order('name'),
    supabase.from('ro_trains').select(
      'id,train_number,name,status,shared_power_meter_group,' +
      'num_afm,num_booster_pumps,num_hp_pumps,num_cartridge_filters,num_controllers,' +
      'filter_media_type,filter_housing_type,' +
      'unit_type,feed_source_train_id,reject_routing'
    ).eq('plant_id', plantId).order('train_number'),
    supabase.from('locators').select('id,name,status,product_meter_id').eq('plant_id', plantId).order('name'),
    supabase.from('product_meters').select('id,name,status').eq('plant_id', plantId).order('name'),
    supabase.from('plant_power_config')
      .select('solar_meter_count,solar_meter_names,grid_meter_count,grid_meter_names')
      .eq('plant_id', plantId).maybeSingle(),
    supabase.from('plant_meter_config')
      .select('config,permeate_is_production')
      .eq('plant_id', plantId).maybeSingle(),
  ]);

  // Check for errors
  if (wellsRes.error) throw wellsRes.error;
  if (roRes.error) throw roRes.error;
  if (locRes.error) throw locRes.error;
  if (prodRes.error) throw prodRes.error;
  if (powerCfgRes.error) throw powerCfgRes.error;
  if (meterCfgRes.error) throw meterCfgRes.error;

  // Fetch saved links
  let savedLinks: TopoLink[] = [];
  try {
    const { data: linkRows } = await supabase.from('plant_topology_links')
      .select('from_id,to_id').eq('plant_id', plantId);
    if (linkRows?.length) savedLinks = linkRows;
  } catch {
    // Links are optional, continue without them
  }

  return {
    wells:         (wellsRes.data ?? []) as unknown as TopoWell[],
    roTrains:      (roRes.data    ?? []) as unknown as TopoRoTrain[],
    locators:      (locRes.data   ?? []) as unknown as TopoLocator[],
    productMeters: (prodRes.data  ?? []) as unknown as TopoProductMeter[],
    powerCfg:      powerCfgRes.data as unknown as TopoPowerConfig | null,
    meterCfg:      meterCfgRes.data as unknown as TopoMeterConfig | null,
    savedLinks,
  };
}

/** Fetch topology links */
export async function fetchTopologyLinks(plantId: string): Promise<TopoLink[]> {
  const { data, error } = await supabase.from('plant_topology_links')
    .select('from_id,to_id').eq('plant_id', plantId);
  if (error) throw error;
  return (data ?? []) as unknown as TopoLink[];
}

/** Fetch individual components for fine-grained caching */
export async function fetchWellsForTopology(plantId: string): Promise<TopoWell[]> {
  const { data, error } = await supabase.from('wells').select('id,name,status,has_power_meter').eq('plant_id', plantId).order('name');
  if (error) throw error;
  return (data ?? []) as unknown as TopoWell[];
}

export async function fetchRoTrainsForTopology(plantId: string): Promise<TopoRoTrain[]> {
  const { data, error } = await supabase.from('ro_trains').select(
    'id,train_number,name,status,shared_power_meter_group,' +
    'num_afm,num_booster_pumps,num_hp_pumps,num_cartridge_filters,num_controllers,' +
    'filter_media_type,filter_housing_type,' +
    'unit_type,feed_source_train_id,reject_routing'
  ).eq('plant_id', plantId).order('train_number');
  if (error) throw error;
  return (data ?? []) as unknown as TopoRoTrain[];
}

export async function fetchLocatorsForTopology(plantId: string): Promise<TopoLocator[]> {
  const { data, error } = await supabase.from('locators').select('id,name,status,product_meter_id').eq('plant_id', plantId).order('name');
  if (error) throw error;
  return (data ?? []) as unknown as TopoLocator[];
}

export async function fetchProductMetersForTopology(plantId: string): Promise<TopoProductMeter[]> {
  const { data, error } = await supabase.from('product_meters').select('id,name,status').eq('plant_id', plantId).order('name');
  if (error) throw error;
  return (data ?? []) as unknown as TopoProductMeter[];
}

export async function fetchPowerConfigForTopology(plantId: string): Promise<TopoPowerConfig | null> {
  const { data, error } = await supabase.from('plant_power_config')
    .select('solar_meter_count,solar_meter_names,grid_meter_count,grid_meter_names')
    .eq('plant_id', plantId).maybeSingle();
  if (error) throw error;
  return data as unknown as TopoPowerConfig | null;
}

export async function fetchMeterConfigForTopology(plantId: string): Promise<TopoMeterConfig | null> {
  const { data, error } = await supabase.from('plant_meter_config')
    .select('config,permeate_is_production')
    .eq('plant_id', plantId).maybeSingle();
  if (error) throw error;
  return data as unknown as TopoMeterConfig | null;
}