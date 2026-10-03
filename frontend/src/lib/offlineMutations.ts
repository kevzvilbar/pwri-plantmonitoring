import type { QueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type LocatorInsert = Database['public']['Tables']['locator_readings']['Insert'];
type LocatorUpdate = Database['public']['Tables']['locator_readings']['Update'];
type WellInsert = Database['public']['Tables']['well_readings']['Insert'];
type WellUpdate = Database['public']['Tables']['well_readings']['Update'];
type RoTrainInsert = Database['public']['Tables']['ro_train_readings']['Insert'];
type RoPretreatInsert = Database['public']['Tables']['ro_pretreatment_readings']['Insert'];
type GapReasonInsert = Database['public']['Tables']['reading_gap_reasons']['Insert'];

/**
 * Register mutation defaults for all offline-capable mutations.
 *
 * In TanStack Query with persistence, when mutations are paused while offline
 * and persisted to storage (IndexedDB), rehydrating the mutation cache after a
 * page refresh or mobile OS app-kill restores the mutation state (variables, key)
 * but NOT the execution function (mutationFn).
 *
 * Registering mutation defaults ensures that when `queryClient.resumePausedMutations()`
 * runs on rehydration, TanStack Query can look up the correct `mutationFn` by key prefix
 * and successfully replay the queued offline entries without silent data loss.
 */
export function registerOfflineMutationDefaults(client: QueryClient): void {
  // 1. Locator readings
  client.setMutationDefaults(['save-locator-reading'], {
    mutationFn: async ({ payload, isEdit, editId }: {
      payload: LocatorInsert | LocatorUpdate;
      isEdit: boolean;
      editId: string | null;
    }) => {
      if (isEdit && editId) {
        const { data, error } = await supabase
          .from('locator_readings')
          .update(payload as LocatorUpdate)
          .eq('id', editId)
          .select('id,norm_status,current_reading,previous_reading,daily_volume')
          .single();
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabase
        .from('locator_readings')
        .insert(payload as LocatorInsert)
        .select('id,norm_status,current_reading,previous_reading,daily_volume')
        .single();
      if (error) throw error;
      return data;
    },
  });

  // 2. Well readings
  client.setMutationDefaults(['save-well-reading'], {
    mutationFn: async ({ payload, isEdit, editId }: {
      payload: WellInsert | WellUpdate;
      isEdit: boolean;
      editId: string | null;
    }) => {
      if (isEdit && editId) {
        const { data, error } = await supabase
          .from('well_readings')
          .update(payload as WellUpdate)
          .eq('id', editId)
          .select('id,norm_status,current_reading,previous_reading,daily_volume')
          .single();
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabase
        .from('well_readings')
        .insert(payload as WellInsert)
        .select('id,norm_status,current_reading,previous_reading,daily_volume')
        .single();
      if (error) throw error;
      return data;
    },
  });

  // 3. Well power
  client.setMutationDefaults(['save-well-power'], {
    mutationFn: async ({ val, lastTodayId, customDtIso, wellId, plantId, previousMeter, userId }: {
      val: number;
      lastTodayId: string | null;
      customDtIso: string;
      wellId?: string;
      plantId?: string;
      previousMeter?: number | null;
      userId?: string | null;
    }) => {
      if (lastTodayId) {
        const { error } = await supabase.from('well_readings')
          .update({ power_meter_reading: val })
          .eq('id', lastTodayId);
        if (error) throw error;
      } else if (wellId && plantId) {
        const insertPayload: WellInsert = {
          well_id: wellId,
          plant_id: plantId,
          current_reading: previousMeter ?? 0,
          previous_reading: previousMeter ?? null,
          power_meter_reading: val,
          recorded_by: userId ?? null,
          reading_datetime: customDtIso,
        };
        const { error } = await supabase.from('well_readings').insert(insertPayload);
        if (error) throw error;
      }
    },
  });

  // 4. Well TDS
  client.setMutationDefaults(['save-well-tds'], {
    mutationFn: async ({ val, lastTodayId, customDtIso, wellId, plantId, previousMeter, userId }: {
      val: number;
      lastTodayId: string | null;
      customDtIso: string;
      wellId?: string;
      plantId?: string;
      previousMeter?: number | null;
      userId?: string | null;
    }) => {
      if (lastTodayId) {
        const { error } = await supabase.from('well_readings')
          .update({ tds_ppm: val })
          .eq('id', lastTodayId);
        if (error) throw error;
      } else if (wellId && plantId) {
        const insertPayload: WellInsert = {
          well_id: wellId,
          plant_id: plantId,
          current_reading: previousMeter ?? 0,
          previous_reading: previousMeter ?? null,
          tds_ppm: val,
          recorded_by: userId ?? null,
          reading_datetime: customDtIso,
        };
        const { error } = await supabase.from('well_readings').insert(insertPayload);
        if (error) throw error;
      }
    },
  });

  // 5. Well NTU (turbidity)
  client.setMutationDefaults(['save-well-ntu'], {
    mutationFn: async ({ val, lastTodayId, customDtIso, wellId, plantId, previousMeter, userId }: {
      val: number;
      lastTodayId: string | null;
      customDtIso: string;
      wellId?: string;
      plantId?: string;
      previousMeter?: number | null;
      userId?: string | null;
    }) => {
      if (lastTodayId) {
        const { error } = await supabase.from('well_readings')
          .update({ turbidity_ntu: val })
          .eq('id', lastTodayId);
        if (error) throw error;
      } else if (wellId && plantId) {
        const insertPayload: WellInsert = {
          well_id: wellId,
          plant_id: plantId,
          current_reading: previousMeter ?? 0,
          previous_reading: previousMeter ?? null,
          turbidity_ntu: val,
          recorded_by: userId ?? null,
          reading_datetime: customDtIso,
        };
        const { error } = await supabase.from('well_readings').insert(insertPayload);
        if (error) throw error;
      }
    },
  });

  // 6. Well Pressure
  client.setMutationDefaults(['save-well-pressure'], {
    mutationFn: async ({ val, lastTodayId, customDtIso, wellId, plantId, previousMeter, userId }: {
      val: number;
      lastTodayId: string | null;
      customDtIso: string;
      wellId?: string;
      plantId?: string;
      previousMeter?: number | null;
      userId?: string | null;
    }) => {
      if (lastTodayId) {
        const { error } = await supabase.from('well_readings')
          .update({ pressure_psi: val })
          .eq('id', lastTodayId);
        if (error) throw error;
      } else if (wellId && plantId) {
        const insertPayload: WellInsert = {
          well_id: wellId,
          plant_id: plantId,
          current_reading: previousMeter ?? 0,
          previous_reading: previousMeter ?? null,
          pressure_psi: val,
          recorded_by: userId ?? null,
          reading_datetime: customDtIso,
        };
        const { error } = await supabase.from('well_readings').insert(insertPayload);
        if (error) throw error;
      }
    },
  });

  // 7. Well Shared Power
  client.setMutationDefaults(['save-well-shared-power'], {
    mutationFn: async ({ val, primaryWellId, prevPower, customDtIso, plantId, userId }: {
      val: number;
      primaryWellId: string;
      prevPower: number | null;
      customDtIso: string;
      plantId?: string;
      userId?: string | null;
    }) => {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const { data: todayRecs, error: fetchErr } = await supabase
        .from('well_readings')
        .select('id')
        .eq('well_id', primaryWellId)
        .gte('reading_datetime', startOfDay.toISOString())
        .order('reading_datetime', { ascending: false })
        .limit(1);
      if (fetchErr) throw fetchErr;
      if (todayRecs?.length) {
        const { error } = await supabase
          .from('well_readings')
          .update({ power_meter_reading: val })
          .eq('id', todayRecs[0].id);
        if (error) throw error;
      } else if (plantId) {
        const insertPayload: WellInsert = {
          well_id: primaryWellId,
          plant_id: plantId,
          current_reading: prevPower ?? 0,
          previous_reading: prevPower ?? null,
          power_meter_reading: val,
          recorded_by: userId ?? null,
          reading_datetime: customDtIso,
        };
        const { error } = await supabase.from('well_readings').insert(insertPayload);
        if (error) throw error;
      }
    },
  });

  // 8. Well Gap Reason
  client.setMutationDefaults(['save-well-gap-reason'], {
    mutationFn: async (payload: GapReasonInsert) => {
      const { error } = await supabase
        .from('reading_gap_reasons')
        .upsert([payload], { onConflict: 'entity_type,entity_id,gap_date,meter_key' });
      if (error) throw error;
    },
  });

  // 9. RO Train Readings
  client.setMutationDefaults(['save-ro-reading'], {
    mutationFn: async (payload: RoTrainInsert) => {
      const { data, error } = await supabase
        .from('ro_train_readings')
        .insert(payload)
        .select('id,permeate_meter_delta,feed_meter_delta')
        .single();
      if (error) throw error;
      return data;
    },
  });

  // 10. RO Pretreatment Readings
  client.setMutationDefaults(['save-pretreatment-reading'], {
    mutationFn: async (payload: RoPretreatInsert) => {
      const { error } = await supabase.from('ro_pretreatment_readings').insert(payload);
      if (error) throw error;
    },
  });
}
