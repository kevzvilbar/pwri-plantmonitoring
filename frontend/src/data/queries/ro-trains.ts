/**
 * data/queries/ro-trains.ts — RO train query functions (roadmap Phase 3).
 *
 * Types come straight from the generated Database schema so this layer can
 * never drift from the live table shape.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type ROTrainRow = Database['public']['Tables']['ro_trains']['Row'];

const RO_TRAIN_SELECT_FIELDS = `
  id, plant_id, train_number, name, unit_type, status, well_id, product_meter_id,
  feed_source_train_id, uses_em_meter, em_all_streams, em_stream_feed,
  em_stream_permeate, em_stream_reject, has_feed_meter, has_permeate_meter,
  has_reject_meter, num_cartridge_filters, num_filter_housings, num_afm,
  num_booster_pumps, num_hp_pumps, num_controllers, num_vessels,
  elements_per_vessel, reject_routing, shared_power_meter_group,
  booster_pump_targets, hpp_target_pressure_psi, filter_media_type,
  filter_housing_type, feed_meter_brand, feed_meter_size, feed_meter_serial,
  feed_meter_installed_date, permeate_meter_brand, permeate_meter_size,
  permeate_meter_serial, permeate_meter_installed_date, reject_meter_brand,
  reject_meter_size, reject_meter_serial, reject_meter_installed_date,
  created_at, updated_at
`;

/** All RO trains, optionally filtered to one plant. */
export async function fetchROTrains(plantId?: string): Promise<ROTrainRow[]> {
  let q = supabase.from('ro_trains').select(RO_TRAIN_SELECT_FIELDS).order('train_number');
  if (plantId) q = q.eq('plant_id', plantId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ROTrainRow[];
}

export type { ROTrainRow };