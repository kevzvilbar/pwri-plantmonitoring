/**
 * data/queries/plantTopology.ts — Plant topology query functions.
 *
 * Roadmap Phase 3: the data-access layer. Pure query functions for
 * plant topology data (wells, RO trains, locators, product meters, power config, links).
 * Components wrap them with React Query via the hooks in src/data/hooks/.
 */
import { supabase } from '@/integrations/supabase/client';
import type { TopologyConfigPayload } from '../mutations/plantTopology';

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
  /** RO array geometry — 0 means "not configured" and is omitted from labels */
  num_vessels?: number;
  elements_per_vessel?: number;
}

/** One column of a plant's process line (plant_process_stages) */
export interface TopoProcessStage {
  stage_key: string;
  label: string;
  node_type: string;
  scope: string;
  sort_order: number;
  detail: string | null;
  wrap_cols: number | null;
}

/** A tank in the plant's product-water bank (product_tanks) */
export interface TopoProductTank {
  id: string;
  name: string;
  tank_number: number;
  status: string;
  capacity_m3: number | null;
  product_meter_id: string | null;
}

/** A chemical injection point (dosing_points) */
export interface TopoDosingPoint {
  id: string;
  chemical: string;
  label: string | null;
  injects_into_stage_key: string;
  pump_hp: number | null;
  status: string;
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
  /** null = plant has no template, so the default process line order applies */
  processStages: TopoProcessStage[] | null;
  productTanks: TopoProductTank[];
  dosingPoints: TopoDosingPoint[];
  savedLinks: TopoLink[];
  topologyConfig: TopologyConfigPayload | null;
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
/**
 * Topology extensions (process stage templates, product tank banks, dosing
 * points, RO vessel geometry) landed in 20260916000001. They are optional by
 * design — a plant with none of them renders exactly as it did before — so a
 * project that hasn't applied that migration yet must still load its topology
 * rather than erroring out on a missing relation. Every one of these reads
 * degrades to empty instead of throwing.
 */
async function fetchOptional<T>(run: () => any, fallback: T): Promise<T> {
  try {
    const { data, error } = await run();
    if (error) return fallback;
    return (data ?? fallback) as T;
  } catch {
    return fallback;
  }
}

async function fetchBlendingWellIds(plantId: string): Promise<Set<string>> {
  const { data, error } = await (supabase.from('blending_wells' as any) as any)
    .select('well_id').eq('plant_id', plantId);
  if (error) return new Set(); // table/RLS hiccup — fall back to no blending wells rather than throw
  return new Set((data ?? []).map((r: any) => r.well_id));
}

/** Fetch all topology data for a plant */
export async function fetchTopologyData(plantId: string): Promise<TopologyData> {
  if (!plantId) throw new Error('Plant ID required');

  const [wellsRes, roRes, locRes, prodRes, powerCfgRes, meterCfgRes, blendingIds,
         processStages, productTanks, dosingPoints, vesselRows, topologyConfig] = await Promise.all([
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
    fetchOptional<TopoProcessStage[] | null>(
      () => (supabase.from('plant_process_stages' as any) as any)
        .select('stage_key,label,node_type,scope,sort_order,detail,wrap_cols')
        .eq('plant_id', plantId).order('sort_order'),
      null),
    fetchOptional<TopoProductTank[]>(
      () => (supabase.from('product_tanks' as any) as any)
        .select('id,name,tank_number,status,capacity_m3,product_meter_id')
        .eq('plant_id', plantId).order('tank_number'),
      []),
    fetchOptional<TopoDosingPoint[]>(
      () => (supabase.from('dosing_points' as any) as any)
        .select('id,chemical,label,injects_into_stage_key,pump_hp,status')
        .eq('plant_id', plantId),
      []),
    // Vessel geometry is read separately rather than added to the ro_trains
    // select above: that select throws on error, and an unmigrated database
    // would take the whole topology down with it over two cosmetic columns.
    fetchOptional<{ id: string; num_vessels: number; elements_per_vessel: number }[]>(
      () => (supabase.from('ro_trains' as any) as any)
        .select('id,num_vessels,elements_per_vessel').eq('plant_id', plantId),
      []),
    fetchOptional<TopologyConfigPayload | null>(
      async () => {
        const { data, error } = await (supabase.from('plant_topology_config' as any) as any)
          .select('custom_nodes,custom_columns,position_overrides,column_widths,palette_items')
          .eq('plant_id', plantId)
          .maybeSingle();
        if (error || !data) return { data: null, error };
        return {
          data: {
            customNodes: data.custom_nodes ?? [],
            customColumns: data.custom_columns ?? [],
            positionOverrides: data.position_overrides ?? {},
            columnWidths: data.column_widths ?? {},
            paletteItems: data.palette_items ?? [],
          },
          error: null,
        };
      },
      null),
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

  const vesselById = new Map(vesselRows.map((v) => [v.id, v]));
  const roTrains = ((roRes.data ?? []) as unknown as TopoRoTrain[]).map((r) => ({
    ...r,
    num_vessels:         vesselById.get(r.id)?.num_vessels ?? 0,
    elements_per_vessel: vesselById.get(r.id)?.elements_per_vessel ?? 0,
  }));

  return {
    wells,
    roTrains,
    locators:      (locRes.data   ?? []) as unknown as TopoLocator[],
    productMeters: (prodRes.data  ?? []) as unknown as TopoProductMeter[],
    powerCfg:      powerCfgRes.data as unknown as TopoPowerConfig | null,
    meterCfg:      meterCfgRes.data as unknown as TopoMeterConfig | null,
    processStages,
    productTanks,
    dosingPoints,
    savedLinks,
    topologyConfig,
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
    fetchOptional<TopoProcessStage[] | null>(
      () => (supabase.from('plant_process_stages' as any) as any)
        .select('stage_key,label,node_type,scope,sort_order,detail,wrap_cols')
        .eq('plant_id', plantId).order('sort_order'),
      null),
    fetchOptional<TopoProductTank[]>(
      () => (supabase.from('product_tanks' as any) as any)
        .select('id,name,tank_number,status,capacity_m3,product_meter_id')
        .eq('plant_id', plantId).order('tank_number'),
      []),
    fetchOptional<TopoDosingPoint[]>(
      () => (supabase.from('dosing_points' as any) as any)
        .select('id,chemical,label,injects_into_stage_key,pump_hp,status')
        .eq('plant_id', plantId),
      []),
    // Vessel geometry is read separately rather than added to the ro_trains
    // select above: that select throws on error, and an unmigrated database
    // would take the whole topology down with it over two cosmetic columns.
    fetchOptional<{ id: string; num_vessels: number; elements_per_vessel: number }[]>(
      () => (supabase.from('ro_trains' as any) as any)
        .select('id,num_vessels,elements_per_vessel').eq('plant_id', plantId),
      []),
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