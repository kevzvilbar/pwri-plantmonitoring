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
  is_blending_well: boolean;
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
  has_feed_meter: boolean;
  has_permeate_meter: boolean;
  has_reject_meter: boolean;
  uses_em_meter: boolean;
  em_all_streams: boolean;
  em_stream_feed: boolean;
  em_stream_permeate: boolean;
  em_stream_reject: boolean;
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

/**
 * Wells are tagged as blending via the `blending_wells` table (see
 * Plants → Wells → "Blending" toggle, WellsList/useWellsList.ts:toggleBlending)
 * — NOT via the `wells.is_blending_well` column, which no UI has ever written
 * to (it reads false for every well in the database). buildTopology() decides
 * the raw-tank-bypass link purely off `TopoWell.is_blending_well`, so both
 * fetchers below resolve it from the real tag table and fold it onto the
 * well rows, rather than trusting the dead column.
 */
async function fetchBlendingWellIds(plantId: string): Promise<Set<string>> {
  const { data, error } = await (supabase.from('blending_wells' as any) as any)
    .select('well_id').eq('plant_id', plantId);
  if (error) return new Set(); // table/RLS hiccup — fall back to no blending wells rather than throw
  return new Set((data ?? []).map((r: any) => r.well_id));
}

/** Fetch all topology data for a plant */
export async function fetchTopologyData(plantId: string): Promise<TopologyData> {
  if (!plantId) throw new Error('Plant ID required');

  const [wellsRes, roRes, locRes, prodRes, powerCfgRes, meterCfgRes, blendingIds] = await Promise.all([
    supabase.from('wells').select('id,name,status,has_power_meter,is_blending_well').eq('plant_id', plantId).order('name'),
    supabase.from('ro_trains').select(
      'id,train_number,name,status,shared_power_meter_group,' +
      'num_afm,num_booster_pumps,num_hp_pumps,num_cartridge_filters,num_controllers,' +
      'filter_media_type,filter_housing_type,' +
      'unit_type,feed_source_train_id,reject_routing,' +
      'has_feed_meter,has_permeate_meter,has_reject_meter,' +
      'uses_em_meter,em_all_streams,em_stream_feed,em_stream_permeate,em_stream_reject'
    ).eq('plant_id', plantId).order('train_number'),
    supabase.from('locators').select('id,name,status,product_meter_id').eq('plant_id', plantId).order('name'),
    supabase.from('product_meters').select('id,name,status').eq('plant_id', plantId).order('name'),
    supabase.from('plant_power_config')
      .select('solar_meter_count,solar_meter_names,grid_meter_count,grid_meter_names')
      .eq('plant_id', plantId).maybeSingle(),
    supabase.from('plant_meter_config')
      .select('config,permeate_is_production')
      .eq('plant_id', plantId).maybeSingle(),
    fetchBlendingWellIds(plantId),
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

  const wells = ((wellsRes.data ?? []) as unknown as TopoWell[]).map((w) => ({
    ...w,
    is_blending_well: w.is_blending_well || blendingIds.has(w.id),
  }));

  return {
    wells,
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
  const [{ data, error }, blendingIds] = await Promise.all([
    supabase.from('wells').select('id,name,status,has_power_meter,is_blending_well').eq('plant_id', plantId).order('name'),
    fetchBlendingWellIds(plantId),
  ]);
  if (error) throw error;
  return ((data ?? []) as unknown as TopoWell[]).map((w) => ({
    ...w,
    is_blending_well: w.is_blending_well || blendingIds.has(w.id),
  }));
}

export async function fetchRoTrainsForTopology(plantId: string): Promise<TopoRoTrain[]> {
  const { data, error } = await supabase.from('ro_trains').select(
    'id,train_number,name,status,shared_power_meter_group,' +
    'num_afm,num_booster_pumps,num_hp_pumps,num_cartridge_filters,num_controllers,' +
    'filter_media_type,filter_housing_type,' +
    'unit_type,feed_source_train_id,reject_routing,' +
    'has_feed_meter,has_permeate_meter,has_reject_meter,' +
    'uses_em_meter,em_all_streams,em_stream_feed,em_stream_permeate,em_stream_reject'
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