import { supabase } from '@/integrations/supabase/client';

export interface MeterWorkflowParams {
  plantId: string;
  entityType: 'locator' | 'well' | 'product';
  entityId: string;
  eventType: 'physical_replacement' | 'multiplier_cutover';
  effectiveAt: string; // ISO datetime
  oldReadingValue: number | null;
  oldReadingConvention?: 'raw' | 'pre_multiplied' | null;
  oldMeterSerial?: string | null;
  newReadingValue: number | null;
  newMultiplier: number;
  newMultiplierEnabled: boolean;
  newMeterSerial?: string | null;
  performedBy: string | null;
  notes?: string | null;
}

export async function submitMeterMultiplierWorkflow(params: MeterWorkflowParams): Promise<{ error: Error | null }> {
  try {
    const {
      plantId,
      entityType,
      entityId,
      eventType,
      effectiveAt,
      oldReadingValue,
      oldReadingConvention,
      oldMeterSerial,
      newReadingValue,
      newMultiplier,
      newMultiplierEnabled,
      newMeterSerial,
      performedBy,
      notes,
    } = params;

    const client = supabase as any;

    // 1. Audit event insert
    const { error: eventErr } = await client.from('meter_events').insert({
      plant_id: plantId,
      entity_type: entityType,
      entity_id: entityId,
      event_type: eventType,
      effective_at: effectiveAt,
      old_reading_value: oldReadingValue,
      old_reading_convention: oldReadingConvention ?? (eventType === 'multiplier_cutover' ? 'pre_multiplied' : 'raw'),
      old_meter_serial: oldMeterSerial ?? null,
      new_reading_value: newReadingValue,
      new_multiplier: newMultiplier,
      new_multiplier_enabled: newMultiplierEnabled,
      new_meter_serial: newMeterSerial ?? null,
      performed_by: performedBy,
      notes: notes || null,
    });

    if (eventErr) throw eventErr;

    // 2. Update entity table
    const entityTable = entityType === 'locator' ? 'locators' : entityType === 'well' ? 'wells' : 'product_meters';
    const entityPatch: Record<string, any> = {
      meter_multiplier: newMultiplier,
      multiplier_enabled: newMultiplierEnabled,
    };
    if (newMeterSerial !== undefined && newMeterSerial !== null) {
      entityPatch.meter_serial = newMeterSerial;
    }

    const { error: entityErr } = await client
      .from(entityTable)
      .update(entityPatch)
      .eq('id', entityId);

    if (entityErr) throw entityErr;

    // 3. Write reset-boundary reading row
    if (newReadingValue !== null) {
      const readingTable =
        entityType === 'locator'
          ? 'locator_readings'
          : entityType === 'well'
          ? 'well_readings'
          : 'product_meter_readings';
      const foreignKey =
        entityType === 'locator'
          ? 'locator_id'
          : entityType === 'well'
          ? 'well_id'
          : 'meter_id';

      const effectiveMult = newMultiplierEnabled ? newMultiplier : 1;

      // Check if a reading within ±1 minute exists
      const winFrom = new Date(new Date(effectiveAt).getTime() - 60_000).toISOString();
      const winTo = new Date(new Date(effectiveAt).getTime() + 60_000).toISOString();

      const { data: existing } = await client
        .from(readingTable)
        .select('id')
        .eq(foreignKey, entityId)
        .gte('reading_datetime', winFrom)
        .lte('reading_datetime', winTo)
        .limit(1)
        .maybeSingle();

      if (existing?.id) {
        const { error: updateReadingErr } = await client
          .from(readingTable)
          .update({
            current_reading: newReadingValue,
            reading_datetime: effectiveAt,
            is_meter_replacement: true,
            multiplier_at_reading: effectiveMult,
            daily_volume: 0,
            remarks: notes
              ? `[Reset Boundary: ${eventType}] ${notes}`
              : `Reset Boundary: ${eventType === 'physical_replacement' ? 'Physical Replacement' : 'Multiplier Cutover'}`,
          })
          .eq('id', existing.id);

        if (updateReadingErr) throw updateReadingErr;
      } else {
        const { error: insertReadingErr } = await client
          .from(readingTable)
          .insert({
            [foreignKey]: entityId,
            plant_id: plantId,
            current_reading: newReadingValue,
            reading_datetime: effectiveAt,
            is_meter_replacement: true,
            multiplier_at_reading: effectiveMult,
            daily_volume: 0,
            recorded_by: performedBy,
            remarks: notes
              ? `[Reset Boundary: ${eventType}] ${notes}`
              : `Reset Boundary: ${eventType === 'physical_replacement' ? 'Physical Replacement' : 'Multiplier Cutover'}`,
          });

        if (insertReadingErr) throw insertReadingErr;
      }
    }

    return { error: null };
  } catch (err: any) {
    return { error: err instanceof Error ? err : new Error(String(err?.message || err)) };
  }
}
