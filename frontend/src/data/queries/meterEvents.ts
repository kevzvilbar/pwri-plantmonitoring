import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface MeterEvent {
  id: string;
  plant_id: string;
  entity_type: 'locator' | 'well' | 'product';
  entity_id: string;
  event_type: 'physical_replacement' | 'multiplier_cutover';
  effective_at: string;
  old_reading_value: number | null;
  old_reading_convention: 'raw' | 'pre_multiplied' | null;
  old_meter_serial: string | null;
  new_reading_value: number | null;
  new_multiplier: number;
  new_multiplier_enabled: boolean;
  new_meter_serial: string | null;
  performed_by: string | null;
  notes: string | null;
  created_at: string;
  performer?: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  } | null;
}

export function useMeterEvents(plantId?: string, entityId?: string) {
  return useQuery({
    queryKey: ['meter-events', plantId, entityId],
    queryFn: async (): Promise<MeterEvent[]> => {
      if (!plantId) return [];
      let query = supabase
        .from('meter_events' as any)
        .select(`
          id, plant_id, entity_type, entity_id, event_type, effective_at,
          old_reading_value, old_reading_convention, old_meter_serial,
          new_reading_value, new_multiplier, new_multiplier_enabled,
          new_meter_serial, performed_by, notes, created_at,
          performer:user_profiles (first_name, last_name, email)
        `)
        .eq('plant_id', plantId)
        .order('effective_at', { ascending: false });

      if (entityId) {
        query = (query as any).eq('entity_id', entityId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as MeterEvent[];
    },
    enabled: !!plantId,
    staleTime: 5 * 60_000,
  });
}
